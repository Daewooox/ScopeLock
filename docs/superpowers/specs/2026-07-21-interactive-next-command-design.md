# Interactive "run the suggested next command" prompt

## Problem

Every ScopeLock command ends its human-readable output with a `Next`
section (`renderSections`'s `{ title: "Next", lines: ... }`) — a single
line of prose, sometimes containing a literal copy-pasteable command
(`"Verify current changes: scopelock check-drift"`), sometimes pure prose
with no command at all (`"Review and commit the accepted changes"`),
sometimes a compound instruction naming a real-world action the user must
take before the next command makes sense (`"Let the agent work, then run:
scopelock task finish"`). Today the user always retypes or copies that
command by hand.

The idea explored: after a command finishes, in an interactive terminal,
offer to run the suggested next command directly — Enter/`y` to run,
anything else cancels — instead of requiring the user to type it.

## Goals

- Cut real, unnecessary typing for the narrow set of "Next" actions that
  are genuinely safe to offer immediately: a fully-formed command, needing
  no additional arguments the current command doesn't already know, and
  requiring no real-world action (editing files, an agent finishing work,
  external installs) between now and running it.
- Zero behavior change for `--json`, non-TTY (pipes/CI), and every command
  that doesn't opt in — this must be invisible outside the narrow scope.
- On decline (any answer other than accepting) or when the terminal isn't
  interactive, behavior is byte-for-byte identical to today: the existing
  prose `Next` line prints exactly as it does now, nothing else happens.

## Non-goals

- No multi-choice arrow-key picker. A single default suggested command
  with a yes/no confirmation, not a scrollable menu — full stop, this was
  explicitly decided over the picker approach.
- No offer for any `Next` line that says "review it/the file, then run"
  (`contract new` → `contract approve <path>`, `plan prepare` → `run
  <path> --yes --isolate`) or names a required real-world action first
  (`task start` → `task finish`, `setup` fix-then-rerun, `task finish`
  dirty → fix-then-rerun). These are exactly the moments ScopeLock wants a
  human to deliberately look at something before proceeding — automating
  the confirmation past that pause contradicts the product's own trust
  model. Confirmed with the maintainer: v1 ships with exactly two
  candidates (see Design).
- No recursive chaining. After the offered command runs, its own output
  is not scanned for a further suggested command — one hop, then done.
- No change to any command's `Next` prose text, `CommandResult.data`, or
  exit-code contract.

## Design

### v1 candidate commands (exhaustive, not illustrative)

After reading every command's actual `Next` line in
`packages/cli/src/commands/*.ts`, exactly two qualify as "a fully-formed
command with no real-world prerequisite action and no missing arguments":

| Source command | Suggested next | Existing prose (unchanged) |
|---|---|---|
| `contract rebaseline` (`rebaseline.ts`) | `check-drift` | `Verify current changes: scopelock check-drift` |
| `run` (`run-plan.ts`) | `report --open <receiptPath>` | `Next: scopelock report --open <receiptPath>` |

Every other command's `Next` line was checked and rejected for a specific
reason: `setup`/`task start` (target may be uninstalled, requires the
agent to actually finish work), `task finish` (requires either committing
changes yourself or fixing unexpected drift first), `check-drift` (prose
only, no command), `contract new`/`approve` (requires reviewing draft
content first, and `contract inject` needs a `--target` this command
doesn't know), `plan prepare` (requires reviewing the composed plan before
starting isolated execution - the single highest-stakes "Next" in the
whole CLI, explicitly excluded).

### `CommandResult` extension (`packages/cli/src/run.ts`)

```ts
export type SuggestedNext = {
  /** Shown before the confirmation prompt, e.g. "Verify current changes". */
  label: string;
  /** Exact argv to spawn, e.g. ["check-drift"] or ["report", "--open", path]. */
  argv: string[];
};

export type CommandResult = {
  data: unknown;
  human: string | null;
  exitCode: ExitCode;
  suggestedNext?: SuggestedNext;
};
```

Additive and optional - every existing command's `CommandResult` literal
needs no change; only `rebaseline.ts` and `run-plan.ts` add the field.

### Prompt mechanism, wired once in `run()`

`run()` (`packages/cli/src/run.ts`) is the single dispatcher every
Commander action callback already calls
(`run(() => xCommand(options), jsonOf(command))`) - the one seam that sees
every command's result, making it the natural place for one shared
implementation instead of per-command wiring.

```ts
export type NextCommandDependencies = {
  confirm?: (message: string, options: PromptOptions) => Promise<boolean>;
  spawnNext?: (argv: string[]) => Promise<ExitCode>;
};

export async function run(
  action: () => Promise<CommandResult>,
  opts: { json: boolean },
  deps: NextCommandDependencies = {},
): Promise<void> {
  // ... existing try/catch body unchanged through printing result.human ...
  if (
    !opts.json
    && result.suggestedNext !== undefined
    && process.stdin.isTTY === true
    && process.stdout.isTTY === true
    && process.env.CI !== "true"
  ) {
    const confirm = deps.confirm ?? confirmPrompt;
    const spawnNext = deps.spawnNext ?? spawnBuiltCli;
    let accepted: boolean;
    try {
      accepted = await confirm(
        `Run it now? scopelock ${result.suggestedNext.argv.join(" ")}`,
        { suffix: "[Y/n] ", defaultYes: true },
      );
    } catch {
      accepted = false; // SIGINT/cancellation during the prompt - fall through silently
    }
    if (accepted) {
      process.exitCode = await spawnNext(result.suggestedNext.argv);
      return;
    }
  }
  process.exitCode = result.exitCode;
}
```

(`spawnBuiltCli` resolves the sibling `index.js` from `run.ts`'s own
module location via `fileURLToPath(import.meta.url)`, not
`process.argv[1]`, so it works identically whether invoked as a global
bin, via `npx`, or from a local dev build, and spawns it with
`stdio: "inherit"`, returning the child's real exit code.)

### `confirmPrompt` gains an opt-in default-yes mode (`packages/cli/src/prompts.ts`)

`PromptOptions` gains `defaultYes?: boolean`. `confirmPrompt`'s existing
regex check (`/^(y|yes)$/i`) is extended: an empty (whitespace-only)
answer counts as accepted only when `defaultYes` is true. Every existing
caller (`task start`'s `Continue? [y/N]`) passes no `defaultYes`, so its
default-no-on-Enter behavior is completely unchanged - this is a strictly
additive opt-in, not a behavior change to the shared prompt.

## Error handling

- SIGINT during the confirmation prompt: `confirmPrompt` already turns
  this into a thrown `CliError`; `run()` catches it and falls through to
  "not accepted" - the original command's exit code stands, nothing
  crashes, no scary stack trace for a plain Ctrl-C.
- If the spawned next command itself fails (non-zero exit), `run()`
  propagates that exit code as `process.exitCode` - the user sees the
  child command's own real output (via `stdio: "inherit"`) explaining
  what went wrong, exactly as if they'd typed it themselves.
- `suggestedNext.argv` is always a fixed, code-authored array (never
  built from unsanitized user input) - no shell involved, no injection
  surface, matching the project's existing shell-free-argv discipline.

## Testing

- New `packages/cli/src/run.test.ts` (no such file exists today - `run.ts`
  is currently only exercised indirectly through `cli.test.ts`'s
  subprocess-level tests): injected fake `confirm`/`spawnNext` prove (a) `suggestedNext` present +
  fake-TTY + fake-confirm-accepts → `spawnNext` called with the exact
  argv, `process.exitCode` becomes the child's; (b) present + declines →
  `spawnNext` never called, `process.exitCode` is the original result's;
  (c) `--json` mode → prompt never offered regardless of `suggestedNext`,
  output byte-identical to a `suggestedNext`-less result; (d) non-TTY
  (fake `stdin.isTTY`/`stdout.isTTY` false) → prompt never offered; (e)
  fake `confirm` that throws (simulating SIGINT) → falls through to
  original exit code, no unhandled rejection.
- `rebaseline.ts`/`run-plan.ts` unit or CLI-level tests: assert
  `result.suggestedNext` deep-equals the exact `{ label, argv }` for a
  representative success case; assert every OTHER existing test for these
  two commands (and all other commands) still passes unmodified - the
  prose `Next` text must be byte-identical to before this change.
- No test spawns a real child `scopelock` process or a real TTY - the DI
  seam in `run()` exists specifically so this feature is testable without
  either.

## Verification

- `pnpm typecheck && pnpm build && pnpm test` green.
- Manual interactive check in a real terminal (not scriptable): run
  `scopelock contract rebaseline <id>` and `scopelock run <plan> --yes`
  against a real fixture, confirm the prompt appears, Enter runs the
  suggested command with its real output, and any other keypress leaves
  the shell exactly where today's `Next:` line already puts it.
- `node packages/cli/dist/index.js check-drift` clean under this task's
  ScopeLock contract.
