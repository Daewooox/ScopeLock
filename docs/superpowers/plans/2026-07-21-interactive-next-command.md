# Interactive "run the suggested next command" prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a real interactive terminal, after `contract rebaseline` or `run` finishes, offer a single yes/no prompt to run the one safe, fully-formed follow-up command (`check-drift` / `report --open <path>`) instead of requiring the user to retype it — with zero behavior change everywhere else.

**Architecture:** `CommandResult` gains an optional `suggestedNext` field. The single shared dispatcher `run()` (`packages/cli/src/run.ts`) — already called by every Commander action — offers the confirmation only when `!json && suggestedNext !== undefined && real TTY && CI!=="true"`, using an injectable `{ confirm, spawnNext }` dependency pair that defaults to the real `confirmPrompt` and a real child-process spawn of the built CLI. Only `rebaseline.ts` and `run-plan.ts` populate `suggestedNext`; every other command is untouched.

**Tech Stack:** TypeScript, Node's built-in test runner, Node's `node:readline/promises` (already used by `prompts.ts`) and `node:child_process` (no new dependencies).

## Global Constraints

- Exactly two commands populate `suggestedNext` in this plan: `contract rebaseline` → `check-drift`, `run` → `report --open <receiptPath>`. No other command changes.
- `--json`, non-TTY (`stdin.isTTY`/`stdout.isTTY` not both `true`), and `CI==="true"` must all suppress the prompt entirely — output byte-identical to today in every one of those cases.
- On decline, or when `confirm` throws (SIGINT/cancellation), `process.exitCode` stays exactly what the original command result said — no crash, no stack trace.
- `confirmPrompt`'s new `defaultYes` option is strictly additive: every existing caller (`task start`'s `Continue? [y/N]`) passes no `defaultYes` and its behavior is unchanged (empty answer still resolves false there).
- The spawned next command runs the same built CLI binary as a real child process (`stdio: "inherit"`) — not an in-process function call — so its behavior is indistinguishable from the user typing it themselves.
- No change to any command's existing prose `Next` line text, `CommandResult.data`, or the exit-code contract (`0`/`1`/`2`).

---

### Task 1: `run.ts` + `prompts.ts` core mechanism

**Files:**
- Modify: `packages/cli/src/run.ts` (full file)
- Modify: `packages/cli/src/prompts.ts` (the `PromptOptions` type and `confirmPrompt` function)
- Test: `packages/cli/src/run.test.ts` (new file)

**Interfaces:**
- Consumes: `confirmPrompt(message: string, options?: PromptOptions): Promise<boolean>` from `./prompts.js` (extended in this task).
- Produces (used verbatim by Tasks 2 and 3):
  - `export type SuggestedNext = { label: string; argv: string[] }`
  - `CommandResult`'s new optional field `suggestedNext?: SuggestedNext`
  - `run(action, opts, deps?)` — the third parameter is optional, so every existing call site (`run(() => xCommand(options), jsonOf(command))`, unchanged in `index.ts`) keeps compiling and behaving exactly as before.

#### Step 1: Write the failing tests

Create `packages/cli/src/run.test.ts`:

```ts
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, type CommandResult } from "./run.js";

let previousStdinTty: boolean | undefined;
let previousStdoutTty: boolean | undefined;
let previousCi: string | undefined;
let previousExitCode: number | undefined;

beforeEach(() => {
  previousStdinTty = process.stdin.isTTY;
  previousStdoutTty = process.stdout.isTTY;
  previousCi = process.env.CI;
  previousExitCode = process.exitCode;
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: previousStdinTty, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: previousStdoutTty, configurable: true });
  if (previousCi === undefined) delete process.env.CI;
  else process.env.CI = previousCi;
  process.exitCode = previousExitCode;
});

function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

function okResult(suggestedNext?: CommandResult["suggestedNext"]): CommandResult {
  return { data: { ok: true }, human: "done", exitCode: 0, suggestedNext };
}

describe("run() suggested-next-command prompt", () => {
  it("spawns the suggested command when the TTY confirm accepts", async () => {
    setTty(true);
    delete process.env.CI;
    const spawnCalls: string[][] = [];
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => true,
        spawnNext: async (argv) => {
          spawnCalls.push(argv);
          return 1;
        },
      },
    );
    assert.deepEqual(spawnCalls, [["check-drift"]]);
    assert.equal(process.exitCode, 1);
  });

  it("does not spawn and keeps the original exit code when declined", async () => {
    setTty(true);
    delete process.env.CI;
    let spawned = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => false,
        spawnNext: async () => {
          spawned = true;
          return 0;
        },
      },
    );
    assert.equal(spawned, false);
    assert.equal(process.exitCode, 0);
  });

  it("never offers the prompt under --json, even with suggestedNext present", async () => {
    setTty(true);
    delete process.env.CI;
    let confirmCalled = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: true },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });

  it("never offers the prompt outside a real TTY", async () => {
    setTty(false);
    delete process.env.CI;
    let confirmCalled = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });

  it("never offers the prompt when CI=true", async () => {
    setTty(true);
    process.env.CI = "true";
    let confirmCalled = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });

  it("falls back to the original exit code when confirm throws (SIGINT/cancellation)", async () => {
    setTty(true);
    delete process.env.CI;
    let spawned = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => {
          throw new Error("cancelled");
        },
        spawnNext: async () => {
          spawned = true;
          return 0;
        },
      },
    );
    assert.equal(spawned, false);
    assert.equal(process.exitCode, 0);
  });

  it("skips the prompt entirely when suggestedNext is absent, matching today's behavior", async () => {
    setTty(true);
    delete process.env.CI;
    let confirmCalled = false;
    await run(
      async () => okResult(undefined),
      { json: false },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });
});
```

#### Step 2: Run tests to verify they fail

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -5`
Expected: FAIL — build error, `run()`'s type signature doesn't accept a third argument yet (`NextCommandDependencies` doesn't exist), and `CommandResult` has no `suggestedNext` field.

#### Step 3: Extend `prompts.ts`

In `packages/cli/src/prompts.ts`, find:

```ts
type PromptOptions = {
  suffix?: string;
  cancellationCode?: string;
  cancellationMessage?: string;
};
```

Replace with:

```ts
export type PromptOptions = {
  suffix?: string;
  cancellationCode?: string;
  cancellationMessage?: string;
  /** When true, a bare Enter (empty answer) counts as accepted. Every
   *  existing caller omits this and keeps today's default-no-on-Enter
   *  behavior unchanged. */
  defaultYes?: boolean;
};
```

Find:

```ts
export async function confirmPrompt(message: string, options: PromptOptions = {}): Promise<boolean> {
  const answer = await ask(message, options);
  return /^(y|yes)$/i.test(answer.trim());
}
```

Replace with:

```ts
export async function confirmPrompt(message: string, options: PromptOptions = {}): Promise<boolean> {
  const answer = await ask(message, options);
  const trimmed = answer.trim();
  if (trimmed.length === 0 && options.defaultYes === true) return true;
  return /^(y|yes)$/i.test(trimmed);
}
```

(`type PromptOptions` was exported here for the first time — it was previously file-private; `run.ts` needs it in Task 1's next step.)

#### Step 4: Rewrite `run.ts`

Replace the full contents of `packages/cli/src/run.ts` with:

```ts
/**
 * CLI exit-code contract (stable, relied upon by CI and agent hooks):
 *   0 - success / no violations
 *   1 - completed, violations found
 *   2 - execution error (bad input, not a repo, not implemented, ...)
 */
export type ExitCode = 0 | 1 | 2;

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

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatZodError } from "@scopelock/core";
import { confirmPrompt, type PromptOptions } from "./prompts.js";

export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function statusFor(exitCode: ExitCode): "ok" | "violations" | "error" {
  if (exitCode === 0) return "ok";
  if (exitCode === 1) return "violations";
  return "error";
}

/** Spawns the built CLI itself as a real child process (stdio inherited),
 *  so an auto-run suggested command behaves exactly like the user typing
 *  it - not a special in-process shortcut with different behavior. */
async function spawnBuiltCli(argv: string[]): Promise<ExitCode> {
  const cliEntry = join(dirname(fileURLToPath(import.meta.url)), "index.js");
  return await new Promise<ExitCode>((resolve) => {
    const child = spawn(process.execPath, [cliEntry, ...argv], { stdio: "inherit" });
    child.on("error", () => resolve(2));
    child.on("exit", (code) => {
      resolve(code === 0 ? 0 : code === 1 ? 1 : 2);
    });
  });
}

export type NextCommandDependencies = {
  confirm?: (message: string, options: PromptOptions) => Promise<boolean>;
  spawnNext?: (argv: string[]) => Promise<ExitCode>;
};

export async function run(
  action: () => Promise<CommandResult>,
  opts: { json: boolean },
  deps: NextCommandDependencies = {},
): Promise<void> {
  try {
    const result = await action();
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ status: statusFor(result.exitCode), data: result.data })}\n`,
      );
    } else if (result.human !== null) {
      process.stdout.write(`${result.human}\n`);
    }

    if (
      !opts.json
      && result.suggestedNext !== undefined
      && process.stdin.isTTY === true
      && process.stdout.isTTY === true
      && process.env.CI !== "true"
    ) {
      const confirm = deps.confirm ?? confirmPrompt;
      const spawnNext = deps.spawnNext ?? spawnBuiltCli;
      let accepted = false;
      try {
        accepted = await confirm(
          `Run it now? scopelock ${result.suggestedNext.argv.join(" ")}`,
          { suffix: "[Y/n] ", defaultYes: true },
        );
      } catch {
        accepted = false;
      }
      if (accepted) {
        process.exitCode = await spawnNext(result.suggestedNext.argv);
        return;
      }
    }

    process.exitCode = result.exitCode;
  } catch (error) {
    const zodMessage = formatZodError(error);
    const code =
      error instanceof CliError
        ? error.code
        : zodMessage !== null
          ? "INVALID_INPUT"
          : "UNEXPECTED";
    const message =
      zodMessage ?? (error instanceof Error ? error.message : String(error));
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ status: "error", error: { code, message } })}\n`,
      );
    } else {
      process.stderr.write(`error [${code}]: ${message}\n`);
    }
    process.exitCode = 2;
  }
}
```

Note on module structure: `run.ts` now imports from `./prompts.js`, and `prompts.ts` already imports `CliError` from `./run.js` — this is a circular import, used only inside function bodies on both sides (never at module top-level evaluation), which Node's ESM loader resolves correctly. If `pnpm build` reports a real circular-dependency error (unlikely for this pattern), stop and report back rather than restructuring around it blind.

#### Step 5: Run tests to verify they pass

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/run.test.js`
Expected: PASS (7/7).

#### Step 6: Run the full CLI suite

Run: `node --test 'packages/cli/dist/**/*.test.js'`
Expected: PASS, no regressions — in particular every existing `prompts.ts`/`task start` confirm-flow test must still pass unmodified (the `defaultYes` addition is inert unless explicitly opted into).

#### Step 7: Commit

```bash
git add packages/cli/src/run.ts packages/cli/src/prompts.ts packages/cli/src/run.test.ts
git commit -m "feat(cli): add interactive suggested-next-command prompt mechanism"
```

---

### Task 2: `contract rebaseline` → `check-drift`

**Files:**
- Modify: `packages/cli/src/commands/rebaseline.ts`
- Test: `packages/cli/src/cli.test.ts` (adds to the existing `describe("cli end-to-end", () => { ... })` block, which starts at line 675 and already contains `"rebaseline repairs a stale baseline so check-drift works again"` at line 973 — add the new test as a sibling `it(...)` inside that same block, immediately after that existing test)

**Interfaces:**
- Consumes from Task 1: `CommandResult["suggestedNext"]` (the type is inferred from `run.ts`'s export; `rebaseline.ts` already imports `type CommandResult` from `../run.js`, no new import needed beyond that).
- Produces: nothing consumed by Task 3 (independent command).

#### Step 1: Write the failing test

In `packages/cli/src/cli.test.ts`, find the import line `import { runPlanCommand } from "./commands/run-plan.js";` and add a sibling import right after it:

```ts
import { runPlanCommand } from "./commands/run-plan.js";
import { rebaselineCommand } from "./commands/rebaseline.js";
```

Find the test `"rebaseline repairs a stale baseline so check-drift works again"` (around line 973). Immediately after it (before `"rebaseline exits 2 with CONTRACT_NOT_FOUND for an unknown id"`), add:

```ts
  it("suggests check-drift as the next command after a successful rebaseline", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      const draftPath = join(tmpdir(), `sl-rebase-suggest-${Date.now()}.json`);
      assert.equal(
        runCli(dir, ["contract", "new", "--task", "scoped change", "--planned", "src/**", "--out", draftPath]).status,
        0,
      );
      assert.equal(runCli(dir, ["--json", "approve", draftPath]).status, 0);
      const activeId = JSON.parse(
        await readFile(join(dir, ".scopelock", "active"), "utf8"),
      ) as string;

      process.chdir(dir);
      const result = await rebaselineCommand(activeId);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(result.suggestedNext, { label: "Verify current changes", argv: ["check-drift"] });
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
```

#### Step 2: Run the test to verify it fails

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "suggests check-drift as the next command"`
Expected: FAIL — `result.suggestedNext` is `undefined`, doesn't match the expected object.

#### Step 3: Implement the change

In `packages/cli/src/commands/rebaseline.ts`, find the `return` statement at the end of `rebaselineCommand`:

```ts
  return {
    data: {
      contractId: id,
      baseline: rebaselined.baseline,
      path: savedPath,
      sealPath,
    },
    human: renderSections([
      { title: "Context", lines: `Task boundary  ${id}` },
      { title: "Result", lines: [`Baseline updated  ${sha}`, `Contract          ${savedPath}`] },
      { title: "Next", lines: "Verify current changes: scopelock check-drift" },
    ]),
    exitCode: 0,
  };
```

Replace with:

```ts
  return {
    data: {
      contractId: id,
      baseline: rebaselined.baseline,
      path: savedPath,
      sealPath,
    },
    human: renderSections([
      { title: "Context", lines: `Task boundary  ${id}` },
      { title: "Result", lines: [`Baseline updated  ${sha}`, `Contract          ${savedPath}`] },
      { title: "Next", lines: "Verify current changes: scopelock check-drift" },
    ]),
    exitCode: 0,
    suggestedNext: { label: "Verify current changes", argv: ["check-drift"] },
  };
```

(The `Next` prose line is untouched — `suggestedNext` is a new sibling field, not a replacement.)

#### Step 4: Run the test to verify it passes

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "suggests check-drift as the next command"`
Expected: PASS.

#### Step 5: Run the full CLI suite

Run: `node --test 'packages/cli/dist/**/*.test.js'`
Expected: PASS — in particular the existing `"rebaseline repairs a stale baseline..."` and `"rebaseline exits 2 with CONTRACT_NOT_FOUND..."` tests (both `--json`-based, via `runCli`) must pass with zero assertion changes, since `suggestedNext` never appears in the JSON envelope (`run()`'s `--json` branch only serializes `result.data`).

#### Step 6: Commit

```bash
git add packages/cli/src/commands/rebaseline.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): suggest check-drift after a successful contract rebaseline"
```

---

### Task 3: `run` → `report --open <receiptPath>` + final verification

**Files:**
- Modify: `packages/cli/src/commands/run-plan.ts` (the final `return` statement of `runPlanWithReporter`, near the end of the file)
- Test: `packages/cli/src/cli.test.ts` (inside `describe("run", ...)`)

**Interfaces:**
- Consumes from Task 1: `CommandResult["suggestedNext"]` (same as Task 2 — `run-plan.ts` already imports `type CommandResult` from `../run.js`).
- Produces: nothing (final task).

#### Step 1: Write the failing test

In `packages/cli/src/cli.test.ts`, inside `describe("run", ...)`, immediately after the test `"reports concurrent direct-task lifecycle without serializing a wave"` (the one using `runPlanCommand` in-process with `process.chdir`, confirmed present around line 3075-3143), add:

```ts
  it("suggests opening the Flight Report as the next command after a successful run", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "suggest-report",
        tasks: [{
          id: "a",
          contract: "a.json",
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt', 'a')"],
        }],
      }));
      process.chdir(dir);

      const result = await runPlanCommand({
        plan: "plan.json",
        yes: true,
        checkDrift: false,
        receipt: "receipt.json",
      });

      assert.equal(result.exitCode, 0);
      const receiptPath = (result.data as { receiptPath: string }).receiptPath;
      assert.deepEqual(result.suggestedNext, { label: "Open the Flight Report", argv: ["report", "--open", receiptPath] });
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });
```

#### Step 2: Run the test to verify it fails

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "suggests opening the Flight Report"`
Expected: FAIL — `result.suggestedNext` is `undefined`.

#### Step 3: Implement the change

In `packages/cli/src/commands/run-plan.ts`, find the final `return` statement of `runPlanWithReporter` (immediately before the closing brace of the function, after the `human: humanReport(...)` call):

```ts
  return {
    data: { receiptPath, receipt },
    human: humanReport(
      plan.planId,
      receiptPath,
      taskRuns,
      waves,
      graph.conflicts,
      deferred,
      drift?.status ?? "not_checked",
      environment?.status ?? "not_configured",
      isolation?.validationSetup?.status ?? (validationSetupCommand ? "not-run" : "off"),
      isolation?.validationChecks && isolation.validationChecks.length > 0
        ? isolation.validationChecks.map((check) => `${check.id}:${check.status}`).join(", ")
        : (options.isolate === true ? "not-run" : "off"),
      isolation?.finalPromotion ?? (options.isolate === true ? "not-run" : "off"),
      evidenceSummary,
    ),
    exitCode,
  };
```

Replace with:

```ts
  return {
    data: { receiptPath, receipt },
    human: humanReport(
      plan.planId,
      receiptPath,
      taskRuns,
      waves,
      graph.conflicts,
      deferred,
      drift?.status ?? "not_checked",
      environment?.status ?? "not_configured",
      isolation?.validationSetup?.status ?? (validationSetupCommand ? "not-run" : "off"),
      isolation?.validationChecks && isolation.validationChecks.length > 0
        ? isolation.validationChecks.map((check) => `${check.id}:${check.status}`).join(", ")
        : (options.isolate === true ? "not-run" : "off"),
      isolation?.finalPromotion ?? (options.isolate === true ? "not-run" : "off"),
      evidenceSummary,
    ),
    exitCode,
    suggestedNext: { label: "Open the Flight Report", argv: ["report", "--open", receiptPath] },
  };
```

(The existing `Next: scopelock report --open ...` prose line inside `humanReport`'s own output is untouched.)

#### Step 4: Run the test to verify it passes

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "suggests opening the Flight Report"`
Expected: PASS.

#### Step 5: Full repo-wide verification

```bash
cd "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
pnpm typecheck && pnpm build && pnpm test
node packages/cli/dist/index.js check-drift
git diff --check
```

Expected: all green, in particular every existing `run`/`report`/`rebaseline` test (many via `runCli` subprocess with `--json`) passes with zero assertion changes — proof the feature is invisible outside its narrow, interactive-TTY-only scope. `check-drift` clean under this branch's own ScopeLock contract.

#### Step 6: Manual interactive spot-check (not scriptable, do this once in a real terminal)

```bash
cd /tmp && rm -rf sl-interactive-demo && mkdir sl-interactive-demo && cd sl-interactive-demo
git init -q && git config user.email d@e.com && git config user.name d && git commit --allow-empty -qm init
node "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents/packages/cli/dist/index.js" contract new --task demo --id demo --planned "src/**" --out demo.json
node "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents/packages/cli/dist/index.js" contract approve demo.json
node "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents/packages/cli/dist/index.js" contract rebaseline demo
```

Expected: after the rebaseline output, a new line appears —
`Run it now? scopelock check-drift` followed by `[Y/n] `. Pressing Enter
runs `check-drift` for real and prints its own output; typing anything
else (e.g. `n`) leaves you back at the shell prompt with no further
output, exactly as today.

#### Step 7: Commit

```bash
git add packages/cli/src/commands/run-plan.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): suggest opening the Flight Report after a successful run"
```

---

## Final Verification (after Task 3)

Covered by Task 3 Step 5 (automated) and Step 6 (manual, interactive-only — cannot be scripted since it requires a real TTY, which is exactly the condition this feature is gated on).
