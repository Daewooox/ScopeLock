# Terminal UX Guided Wizard — task start steps + warning table (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `task start`'s interactive wizard `Step N of M` progress headers and upgrade its review screen so broad-scope/sensitive-file warnings visually dominate, using the same progress-reporting library Phases 1-3 already shipped.

**Architecture:** Same DI shape as `run`/`plan prepare`/`task finish`: `TaskStartOptions` gains `reporter?: ProgressReporter`; the exported `taskStartCommand` becomes a thin wrapper around a private `taskStartWithReporter`. Three coarse `step` events mark `task start`'s three real phases. `step` events already `flush()` any live rows and print one plain line (Phase 1's `LivePanelReporter` design) — they do not drive an ongoing spinner, so they are safe to interleave with `task start`'s blocking interactive `question`/`confirm` prompts, which a live-redrawing panel would otherwise conflict with.

**Tech Stack:** TypeScript, `node:test`/`node:assert/strict`, the `packages/cli/src/progress/**` library (Phase 1-3, unchanged in this plan) and `renderStatusTable` (Phase 1, already used by `task finish` since Phase 3).

## Global Constraints

- `task finish` already got `phase` events and a `renderStatusTable` findings table in Phase 3 (PR #60) — it has no further work in this plan. `task finish` has no interactive prompts and no natural multi-step wizard shape, so it does not get `step` events; forcing them on would be inventing structure that isn't there. This scoping decision is deliberate, not an oversight.
- `task start` gets exactly 3 `step` events, matching its 3 real phases visible in the current source (verified before writing this plan): (1) `"Describe and scope the task"` — before the interactive `ask`/`askMany` sequence; (2) `"Review and approve"` — before building the draft contract and review screen; (3) `"Connect the agent"` — before environment setup/hook injection. The early-return path (draft declined) legitimately never reaches step 3 — do not force it to.
- `data.warnings` (the JSON-visible field, both on the "declined" early return and the final success return) stays exactly `string[]` with its existing two message formats — unchanged. Only the **human-readable** review screen's warning presentation changes, via a parallel `StatusRow[]` built from the same two conditions.
- No new runtime dependency, no emoji, no exit-code changes, no `data` JSON shape changes anywhere.
- `reporter.dispose()` fires exactly once per invocation on every path (approved, declined, and any thrown error), mirroring `run-plan.ts`/`plan-prepare.ts`/`task-finish.ts`'s established try/finally shape.
- One existing test's assertion is a **required** update, not optional: `describe("guided task start", ...)` → `it("warns when the allowed scope covers at least half of tracked files", ...)` currently asserts the exact literal string `Broad scope: 1/2 tracked files (50%)`. Once the warning display moves to `renderStatusTable`, that sentence is split across a row `id` ("Broad scope") and a separate reason line ("1/2 tracked files (50%)", no longer prefixed with "Broad scope: ") — the assertion must be updated to match both pieces separately, not deleted or weakened.

---

## Prerequisites (before Task 1)

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/terminal-progress-guided-wizard

node packages/cli/dist/index.js contract new \
  --id terminal-progress-guided-wizard \
  --task "Add Step N of M progress headers to task start and a failure-first warning table to its review screen - task finish already has phase events and a status table from Phase 3, no further work there" \
  --planned "packages/cli/src/index.ts" \
  --planned "packages/cli/src/commands/task-start.ts" \
  --planned "packages/cli/src/cli.test.ts" \
  --planned "docs/reference.md" \
  --planned "CHANGELOG.md" \
  --forbidden "packages/cli/src/commands/task-finish.ts" \
  --forbidden "packages/cli/src/commands/plan-prepare.ts" \
  --forbidden "packages/cli/src/commands/run-plan.ts" \
  --forbidden "packages/cli/src/progress/**" \
  --forbidden "packages/cli/src/ui.ts" \
  --forbidden "packages/core/**" \
  --forbidden "packages/mcp/**" \
  --forbidden ".github/workflows/**" \
  --agent claude \
  --out .scopelock/drafts/terminal-progress-guided-wizard.json

node packages/cli/dist/index.js contract approve \
  .scopelock/drafts/terminal-progress-guided-wizard.json
```

`packages/cli/src/progress/**` and `packages/cli/src/ui.ts` are forbidden on purpose: this plan is pure consumption of what Phases 1-3 already shipped (`ProgressEvent`'s `step` variant, `createNoopReporter`, `renderStatusTable`, `StatusRow`) — nothing in the library itself needs to change. If a task in this plan seems to need a library change, stop and treat that as a signal the plan has a gap, rather than editing outside scope.

---

### Task 1: Wire `task start`'s reporter, step events, and warning table

**Files:**
- Modify: `packages/cli/src/commands/task-start.ts`
- Modify: `packages/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: `ProgressReporter`, `createNoopReporter` (already shipped, Phase 1), `renderStatusTable`/`StatusRow` (already shipped, Phase 1), `recordingReporter` (already shipped at module scope, Phase 3).
- Produces (used by Task 2): `taskStartCommand(options: TaskStartOptions, dependencies?: TaskStartDependencies): Promise<CommandResult>` — same exported name/return type, `TaskStartOptions` gains one new optional field `reporter?: ProgressReporter`.

- [ ] **Step 1: Write the failing tests, including the one required existing-test update**

Open `packages/cli/src/cli.test.ts`. Find `describe("guided task start", () => { ... })` (search for it — it already defines a local `readySetup` fixture used by every test in this block; reuse it, do not redefine it).

First, find `it("warns when the allowed scope covers at least half of tracked files", ...)` inside that block and replace its one assertion line:

```ts
      assert.match(result.human ?? "", /Broad scope: 1\/2 tracked files \(50%\)/);
```

with:

```ts
      assert.match(result.human ?? "", /Broad scope/);
      assert.match(result.human ?? "", /1\/2 tracked files \(50%\)/);
```

Then add these two new tests anywhere else in the same `describe("guided task start", ...)` block:

```ts
  it("emits three review steps and disposes the reporter on approval", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const recording = recordingReporter();
      const result = await taskStartCommand({
        description: "step events task",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "step-events-task",
        yes: true,
        interactive: false,
        cwd: dir,
        reporter: recording.reporter,
      }, { setup: readySetup });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(recording.events, [
        { type: "step", index: 1, total: 3, label: "Describe and scope the task" },
        { type: "step", index: 2, total: 3, label: "Review and approve" },
        { type: "step", index: 3, total: 3, label: "Connect the agent" },
      ]);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops after step 2 and still disposes when approval is declined", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const recording = recordingReporter();
      const result = await taskStartCommand({
        description: "declined step events task",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "declined-step-events-task",
        interactive: true,
        cwd: dir,
        reporter: recording.reporter,
      }, { confirm: async () => false, setup: readySetup });
      assert.equal(result.exitCode, 0);
      assert.equal((result.data as { approved: boolean }).approved, false);
      assert.deepEqual(recording.events, [
        { type: "step", index: 1, total: 3, label: "Describe and scope the task" },
        { type: "step", index: 2, total: 3, label: "Review and approve" },
      ]);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `taskStartCommand` does not accept a `reporter` option (type error), and the updated "warns when..." assertion won't match today's `Warning   Broad scope: ...` plain-line format.

- [ ] **Step 3: Implement the wiring**

Replace the full contents of `packages/cli/src/commands/task-start.ts` with:

```ts
import { access } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import {
  HARNESSES,
  agentIdSchema,
  buildRepoManifest,
  findRepoRoot,
  matchesAny,
  scopelockPaths,
  writeJsonAtomic,
  type AgentId,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections, renderStatusTable, type StatusRow } from "../ui.js";
import { approveCommand } from "./approve.js";
import { contractNewCommand } from "./contract-new.js";
import { initCommand } from "./init.js";
import { injectContractCommand } from "./inject-contract.js";
import { setupCommand } from "./setup.js";
import { createNoopReporter } from "../progress/noop-reporter.js";
import type { ProgressReporter } from "../progress/types.js";

export type TaskStartOptions = {
  description?: string;
  agent?: string;
  allow: string[];
  block: string[];
  context: string[];
  test: string[];
  id?: string;
  yes?: boolean;
  inject?: boolean;
  interactive: boolean;
  cwd?: string;
  reporter?: ProgressReporter;
};

type TaskStartDependencies = {
  question?: (message: string) => Promise<string>;
  confirm?: (message: string) => Promise<boolean>;
  setup?: typeof setupCommand;
};

function splitAnswer(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function normalizePath(input: string, tracked: Set<string>): string {
  let path = input.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (
    path.length === 0 ||
    path.startsWith("!") ||
    isAbsolute(path) ||
    /^[A-Za-z]:\//.test(path) ||
    path.split("/").includes("..")
  ) {
    throw new CliError("INVALID_SCOPE_PATH", `scope path must stay inside the repository: ${input}`);
  }
  if (path === ".") return "**";
  if (
    /[*?\[\]{}()]/.test(path) ||
    tracked.has(path) ||
    extname(path).length > 0 ||
    /(^|\/)\.env(?:\.|$)/.test(path)
  ) return path;
  return `${path}/**`;
}

export function compileScopeInputs(inputs: string[], trackedFiles: string[]): string[] {
  const tracked = new Set(trackedFiles);
  return [...new Set(inputs.map((input) => normalizePath(input, tracked)))];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function taskStartWithReporter(
  options: TaskStartOptions,
  dependencies: TaskStartDependencies,
  reporter: ProgressReporter,
): Promise<CommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = findRepoRoot(cwd);
  if (root === null) throw new CliError("NOT_A_GIT_REPO", "task start must run inside a git repository");

  reporter.emit({ type: "step", index: 1, total: 3, label: "Describe and scope the task" });

  const question = dependencies.question;
  const ask = async (message: string, current: string | undefined): Promise<string> => {
    if (current?.trim()) return current.trim();
    if (!options.interactive || question === undefined) return "";
    return (await question(message)).trim();
  };
  const askMany = async (message: string, current: string[]): Promise<string[]> => {
    if (current.length > 0) return current;
    if (!options.interactive || question === undefined) return [];
    return splitAnswer(await question(message));
  };

  const description = await ask("Describe the task in one line", options.description);
  const agentText = await ask("Agent (codex, claude, or cursor)", options.agent);
  const allow = await askMany("Paths the agent may change (comma-separated)", options.allow);
  const block = await askMany("Paths the agent must not change (comma-separated, blank for none)", options.block);
  const context = await askMany(
    "Task context the agent may need to read (comma-separated, advisory; blank for none)",
    options.context,
  );
  const tests = await askMany("Required test types (comma-separated, for example unit)", options.test);
  const missing = [
    description.length === 0 ? "description" : null,
    agentText.length === 0 ? "--agent" : null,
    allow.length === 0 ? "--allow" : null,
    tests.length === 0 ? "--test" : null,
  ].filter((value): value is string => value !== null);
  if (missing.length > 0) {
    throw new CliError(
      "TASK_INPUT_REQUIRED",
      `task start needs ${missing.join(", ")}; run \`scopelock task start --help\` for the non-interactive form`,
    );
  }

  const agent = agentIdSchema.parse(agentText);
  const manifest = buildRepoManifest(root);
  const planned = compileScopeInputs(allow, manifest.files);
  const forbidden = compileScopeInputs(block, manifest.files);
  const read = compileScopeInputs(context, manifest.files);
  const covered = manifest.files.filter((file) => matchesAny(file, planned));
  const coverage = manifest.files.length === 0 ? 0 : covered.length / manifest.files.length;
  const risky = manifest.riskyPaths.filter((file) => matchesAny(file, planned));
  const warnings = [
    coverage >= 0.5
      ? `Broad scope: ${covered.length}/${manifest.files.length} tracked files (${Math.round(coverage * 100)}%)`
      : null,
    risky.length > 0 ? `Sensitive files included: ${risky.join(", ")}` : null,
  ].filter((value): value is string => value !== null);
  const warningRows: StatusRow[] = [
    ...(coverage >= 0.5
      ? [{
          id: "Broad scope",
          status: "warn" as const,
          cells: [] as string[],
          reason: `${covered.length}/${manifest.files.length} tracked files (${Math.round(coverage * 100)}%)`,
        }]
      : []),
    ...(risky.length > 0
      ? [{ id: "Sensitive files", status: "warn" as const, cells: [] as string[], reason: risky.join(", ") }]
      : []),
  ];

  reporter.emit({ type: "step", index: 2, total: 3, label: "Review and approve" });

  await initCommand(root);
  const draftResult = await contractNewCommand({
    task: description,
    id: options.id,
    planned,
    forbidden,
    read,
    agent: [agent],
    test: tests,
  }, root);
  const contract = (draftResult.data as { contract: { id: string } }).contract;
  const draftPath = join(scopelockPaths(root).draftsDir, `${contract.id}.json`);
  if (await exists(draftPath)) {
    throw new CliError("DRAFT_EXISTS", `draft already exists: ${draftPath}; pass a unique --id`);
  }
  await writeJsonAtomic(draftPath, contract);

  const review = [
    `Task      ${description}`,
    `Agent     ${HARNESSES[agent].label}`,
    `May edit  ${planned.join(", ")}`,
    `Blocked   ${forbidden.length > 0 ? forbidden.join(", ") : "none"}`,
    `Context   ${read.length > 0 ? `${read.join(", ")} (advisory, not read containment)` : "none"}`,
    `Tests     ${tests.join(", ")}`,
    `Coverage  ${covered.length}/${manifest.files.length} tracked files; future matching files are included`,
    `Draft     ${draftPath}`,
    ...(warningRows.length > 0 ? [renderStatusTable("Warning", [], warningRows)] : []),
  ];

  let approved = options.yes === true;
  if (!approved && options.interactive) {
    if (dependencies.confirm === undefined) {
      throw new CliError("INTERACTIVE_REQUIRED", "task approval confirmation handler is unavailable");
    }
    approved = await dependencies.confirm(`${review.join("\n")}\n\nApprove this task boundary?`);
  }
  if (!approved) {
    if (!options.interactive) {
      throw new CliError(
        "TASK_APPROVAL_REQUIRED",
        `draft saved at ${draftPath}; review it, then run: scopelock contract approve ${JSON.stringify(draftPath)}`,
      );
    }
    return {
      data: { draftPath, approved: false, agent, warnings },
      human: renderSections([
        { title: "Review", lines: review },
        { title: "Result", lines: "Draft saved; task boundary was not approved\nAgent started  no" },
        { title: "Next", lines: `Review it, then run: scopelock contract approve ${JSON.stringify(draftPath)}` },
      ]),
      exitCode: 0,
    };
  }

  reporter.emit({ type: "step", index: 3, total: 3, label: "Connect the agent" });

  const approval = await approveCommand(draftPath, { activate: true }, root);
  const setup = dependencies.setup ?? setupCommand;
  const environment = await setup({
    targets: [agent],
    mode: "warn",
    interactive: false,
    cwd: root,
  });
  const target = (environment.data as {
    targets: Array<{ id: AgentId; executable: string | null; hook: { installed: boolean; capabilities: { confidence: string } } }>;
  }).targets.find((entry) => entry.id === agent);
  const environmentReady = environment.exitCode === 0 && target !== undefined && target.executable !== null;
  const targetFile = join(root, HARNESSES[agent].docFile);

  let inject = options.inject === true;
  if (!inject && options.interactive && environmentReady) {
    if (dependencies.confirm === undefined) {
      throw new CliError("INTERACTIVE_REQUIRED", "instruction injection confirmation handler is unavailable");
    }
    inject = await dependencies.confirm(
      `Place the approved task boundary in ${targetFile}?\nExisting content outside the ScopeLock block is preserved.`,
    );
  }
  let injection: CommandResult | null = null;
  if (inject && environmentReady) injection = await injectContractCommand({ target: agent }, root);

  const readiness = !environmentReady
    ? `Attention: ${HARNESSES[agent].label} CLI was not found or setup needs attention`
    : target?.hook.installed
      ? `Ready; hook confidence ${target.hook.capabilities.confidence}`
      : "Ready with drift detection; no active write hook";
  const resultLines = [
    "Approved  yes, active baseline captured",
    `Environment  ${readiness}`,
    `Instructions  ${injection === null ? "not changed" : `updated ${HARNESSES[agent].docFile}`}`,
    "Agent started  no",
    "Tests executed no",
    "OS sandbox     no",
  ];

  return {
    data: {
      draftPath,
      approved: true,
      approval: approval.data,
      agent,
      environment: environment.data,
      environmentReady,
      injection: injection?.data ?? null,
      warnings,
    },
    human: renderSections([
      { title: "Review", lines: review },
      { title: "Checks", lines: resultLines },
      { title: "Result", lines: environmentReady ? "Task boundary is ready" : "Task boundary approved; environment needs attention" },
      { title: "Next", lines: environmentReady ? "Let the agent work, then run: scopelock task finish" : `Install ${HARNESSES[agent].label}, then run: scopelock setup --target ${agent}` },
    ]),
    exitCode: environmentReady ? 0 : 1,
  };
}

export async function taskStartCommand(
  options: TaskStartOptions,
  dependencies: TaskStartDependencies = {},
): Promise<CommandResult> {
  const reporter = options.reporter ?? createNoopReporter();
  try {
    return await taskStartWithReporter(options, dependencies, reporter);
  } finally {
    reporter.dispose();
  }
}
```

This is a full-file replacement. The only behavioral changes from the current file are: (a) the `reporter` option and its three `step` emissions; (b) the parallel `warningRows`/`renderStatusTable` block appended to `review` instead of the old `...warnings.map((warning) => \`Warning   ${warning}\`)` tail — `warnings` itself (the plain-string array used in `data`) is untouched. Everything else (imports besides the two new ones, control flow, `data` shapes, exit codes) is unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && pnpm --filter @scopelock/cli test 2>&1 | tail -15`
Expected: PASS, full suite green, including the two new tests and the corrected "warns when..." assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/task-start.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): add step headers and failure-first warnings to task start"
```

---

### Task 2: Wire `index.ts` and update docs

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `docs/reference.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `createReporter` (already imported in `index.ts` since Phase 2), `taskStartCommand` (Task 1, unchanged import path).

- [ ] **Step 1: Wire `task start`'s registration**

Open `packages/cli/src/index.ts`. Find the `task.command("start")...action(...)` block (search for `taskStartCommand(`). Its current action body is:

```ts
      const json = jsonOf(command);
      const interactive = !json.json && process.stdin.isTTY === true && process.stdout.isTTY === true;
      return run(
        () => taskStartCommand(
          {
            description,
            ...options,
            context: [...options.context, ...options.read],
            interactive,
          },
          {
            question: questionPrompt,
            confirm: (message) => confirmPrompt(message, {
              suffix: "Continue? [y/N] ",
              cancellationCode: "TASK_START_CANCELLED",
              cancellationMessage: "task start cancelled before the next mutation",
            }),
          },
        ),
        json,
      );
```

Add a `reporter` line right after computing `interactive`, and add `reporter,` to the object literal passed as `taskStartCommand`'s first argument:

```ts
      const json = jsonOf(command);
      const interactive = !json.json && process.stdin.isTTY === true && process.stdout.isTTY === true;
      const reporter = createReporter(process.stdout, json);
      return run(
        () => taskStartCommand(
          {
            description,
            ...options,
            context: [...options.context, ...options.read],
            interactive,
            reporter,
          },
          {
            question: questionPrompt,
            confirm: (message) => confirmPrompt(message, {
              suffix: "Continue? [y/N] ",
              cancellationCode: "TASK_START_CANCELLED",
              cancellationMessage: "task start cancelled before the next mutation",
            }),
          },
        ),
        json,
      );
```

- [ ] **Step 2: Run the full CLI test suite**

Run: `pnpm --filter @scopelock/cli build && pnpm --filter @scopelock/cli test 2>&1 | tail -15`
Expected: PASS, full suite green — this step only wires an already-tested command function into Commander registration.

- [ ] **Step 3: Update documentation**

Open `docs/reference.md`. Find the section documenting live progress output added in Phase 2/3 (search for "live" or "progress" or "TTY" — it already names `run`'s and, after Phase 3, `plan prepare`'s/`task finish`'s phases). Add one short sentence noting `task start`'s interactive wizard now shows `Step N of M` headers for its three phases (name them: "Describe and scope the task", "Review and approve", "Connect the agent"), and that broad-scope/sensitive-file warnings on the review screen now visually stand out from the rest of the summary. Match the existing section's terse style — do not re-explain the TTY/CI/JSON behavior already documented there.

Open `CHANGELOG.md`. Add one bullet under the current unreleased section, in the same terse style as the existing Phase 1/2/3 entries (search for them to match phrasing), noting `task start` now shows step progress and that scope warnings are visually distinguished on the review screen.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts docs/reference.md CHANGELOG.md
git commit -m "feat(cli): wire task start into Commander with step progress"
```

---

## Final verification (run once, after Task 2)

- [ ] **Full package check**

```bash
pnpm --filter @scopelock/cli typecheck
pnpm --filter @scopelock/cli build
pnpm --filter @scopelock/cli test 2>&1 | tail -20
```

Expected: typecheck clean, build clean, full suite green with no regressions in any existing test (`run`, `plan prepare`, `task finish`, `guided task start`, and every `progress/*` and `ui.test.ts` file).

- [ ] **Repo-wide gate**

```bash
pnpm typecheck && pnpm build && pnpm test
node packages/cli/dist/index.js check-drift
git diff --check
```

Expected: all green, `check-drift` reports zero violations under this task's approved ScopeLock contract, diff has no whitespace errors.

## Out of scope for this plan

- `task finish` — already complete since Phase 3 (phase events + `renderStatusTable`), no changes here.
- The Guided review screen's non-warning fields (Task/Agent/May edit/Blocked/Context/Tests/Coverage/Draft) stay as plain text lines, not converted to a `StatusRow` table — they're heterogeneous key-value data, not a uniform multi-column table like `task finish`'s findings or a list of same-shaped warnings; forcing them into `renderStatusTable`'s shape would be an awkward fit for no real readability gain.
- Multi-contract-aware top-level `check-drift` (a real product gap found during the earlier real multi-agent pilot) — separate project.
- `plan prepare`'s own `checks: string[]` restructuring into `StatusRow`s (deferred explicitly in Phase 3) — separate follow-up.
- External beta pilot — after this phase merges, not part of implementation work.
