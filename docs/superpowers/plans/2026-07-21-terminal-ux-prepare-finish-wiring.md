# Terminal UX Progress Wiring — plan prepare + task finish (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing progress-reporting library (Phase 1, PR #57) and the pattern Phase 2 (PR #58) established for `run` into `plan prepare` and `task finish`, plus give `task finish`'s findings table the same failure-first treatment `run`'s receipt summary already has.

**Architecture:** Exact copy of `run-plan.ts`'s DI shape: each command's options gain an optional `reporter?: ProgressReporter`; the exported function becomes a thin wrapper (`const reporter = options.reporter ?? createNoopReporter(); try { return await xWithReporter(...) } finally { reporter.dispose(); }`) around a private implementation function that does the real work and calls `reporter.emit(...)` at real control-flow boundaries. `index.ts` constructs one reporter per invocation via `createReporter(process.stdout, json)` and passes it in, exactly as it already does for `run`.

**Tech Stack:** TypeScript, `node:test`/`node:assert/strict`, the `packages/cli/src/progress/**` library from Phase 1/2. No new runtime dependency.

## Global Constraints

- Both commands' actual work is fast and mostly synchronous (schedule computation, filesystem probes, git status/diff parsing, HTML rendering) — neither has a `run`-style multi-task/multi-wave loop. Do not invent `task-start`/`task-done`/`check-start`/`check-done` events for either command; only coarse `phase` events at real control-flow boundaries, verified against the current source before this plan was written.
- `ProgressEvent`'s `phase.name` union gains exactly five new literal members: `"scheduling"`, `"preflight"`, `"composing"` (for `plan prepare`), `"checking-drift"`, `"rendering-report"` (for `task finish`). This is an additive extension of an already-shipped type (Phase 2 already extended `task-done`/`check-done` the same way) — no existing member is removed or renamed.
- `plan prepare`'s existing `checks: string[]` / `data.checks` JSON field is NOT restructured in this plan. Only `task finish`'s existing `renderTable` findings table (Allowed/Blocked/Outside/High risk — already cleanly structured counts+paths, a direct fit for `renderStatusTable`) gets the failure-first treatment. `plan prepare`'s `checks` array is a short informational preflight list built incrementally across several early-return branches; restructuring it into `StatusRow`s is real, separable follow-up work, not folded into this plan to keep it a reviewable size — noted explicitly so it isn't mistaken for an oversight.
- No new runtime dependency. No emoji. No change to any exit code, to `plan prepare`'s or `task finish`'s existing `data` JSON shape (except `task finish`'s `human` text, which was never a documented/stable machine-readable contract), or to `--json` output (reporter is always `NoopReporter` when `--json` is set, exactly as `run` already does).
- `reporter.dispose()` must be called exactly once per invocation, including when the command throws before completing (mirror `run-plan.ts`'s exact try/finally shape — verified at `packages/cli/src/commands/run-plan.ts:1720-1727`).
- Test convention: this plan hoists the existing `recordingReporter()` helper (currently a local function inside `describe("run", ...)` at `packages/cli/src/cli.test.ts:2548-2563`) to module scope so `describe("plan prepare", ...)` and the existing `describe("guided task start", ...)` block (which already contains every current `taskFinishCommand` test — verified by reading the file; there is no separate "task finish" describe block today) can reuse it without duplication. Do not leave a second copy behind in the `run` describe block, and do not create a new `describe("task finish", ...)` block — add the new tests to the existing one.

---

## Prerequisites (before Task 1)

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/terminal-progress-prepare-finish

node packages/cli/dist/index.js contract new \
  --id terminal-progress-prepare-finish \
  --task "Wire progress reporters into plan prepare and task finish; give task finish's findings table failure-first treatment - no task start wizard, no Guided review screen, no core/MCP/hooks/receipt-schema/scheduler changes" \
  --planned "packages/cli/src/index.ts" \
  --planned "packages/cli/src/commands/plan-prepare.ts" \
  --planned "packages/cli/src/commands/task-finish.ts" \
  --planned "packages/cli/src/cli.test.ts" \
  --planned "packages/cli/src/progress/types.ts" \
  --planned "packages/cli/src/ui.ts" \
  --planned "docs/reference.md" \
  --planned "CHANGELOG.md" \
  --forbidden "packages/cli/src/commands/task-start.ts" \
  --forbidden "packages/core/**" \
  --forbidden "packages/mcp/**" \
  --forbidden ".github/workflows/**" \
  --agent claude \
  --out .scopelock/drafts/terminal-progress-prepare-finish.json

node packages/cli/dist/index.js contract approve \
  .scopelock/drafts/terminal-progress-prepare-finish.json
```

Note this plan's own `packages/cli/src/ui.test.ts` and `packages/cli/src/progress/live-panel-reporter.ts`/`line-reporter.ts` are deliberately NOT in the planned list: no task in this plan adds a test to `ui.test.ts` (only `task-finish.ts` consumes the already-shipped `renderStatusTable`/`StatusRow`, it doesn't change them), and the two reporter implementation files only need touching if Task 1 Step 2 discovers an exhaustive `switch` over `phase.name` in either — if that happens, stop and extend the contract's planned paths before editing either file, rather than editing outside scope.

---

### Task 1: Extend phase names + hoist the recording-reporter test helper

**Files:**
- Modify: `packages/cli/src/progress/types.ts`
- Modify: `packages/cli/src/cli.test.ts`

**Interfaces:**
- Produces (used by Tasks 2-3): `ProgressEvent`'s `phase` variant now accepts `"validating" | "promoting" | "cleaning-up" | "scheduling" | "preflight" | "composing" | "checking-drift" | "rendering-report"`.
- Produces (used by Tasks 2-3's tests): a module-scope `recordingReporter(): { events: ProgressEvent[]; disposeCount: () => number; reporter: ProgressReporter }` in `cli.test.ts`, usable from any `describe` block.

- [ ] **Step 1: Extend the phase name union**

Open `packages/cli/src/progress/types.ts`. Change:

```ts
  | { type: "phase"; name: "validating" | "promoting" | "cleaning-up" }
```

to:

```ts
  | {
      type: "phase";
      name:
        | "validating"
        | "promoting"
        | "cleaning-up"
        | "scheduling"
        | "preflight"
        | "composing"
        | "checking-drift"
        | "rendering-report";
    }
```

- [ ] **Step 2: Verify existing progress tests still typecheck and pass**

Run: `pnpm --filter @scopelock/cli build && node --test 'packages/cli/dist/progress/*.test.js'`
Expected: PASS, same counts as before (this is a superset-widening of a literal union; no existing code references an invalid member, so nothing should break). If TypeScript complains anywhere, it means some other file has an exhaustive `switch` over `phase.name` that needs a new case — check `packages/cli/src/progress/line-reporter.ts` and `live-panel-reporter.ts` specifically; if either has a `switch (event.name)` (not just printing the string), add the new cases there too, matching the existing style for `"validating"`/`"promoting"`/`"cleaning-up"`.

- [ ] **Step 3: Hoist `recordingReporter` to module scope**

Open `packages/cli/src/cli.test.ts`. Find the current definition inside `describe("run", () => { ... })` (search for `function recordingReporter()`). Cut it out of that `describe` block and paste it at module scope, near the top of the file, right after the last top-level `import` statement and before the first `describe(...)` call. The function body is unchanged:

```ts
function recordingReporter(): {
  events: ProgressEvent[];
  disposeCount: () => number;
  reporter: ProgressReporter;
} {
  const events: ProgressEvent[] = [];
  let disposed = 0;
  return {
    events,
    disposeCount: () => disposed,
    reporter: {
      emit(event) { events.push(event); },
      dispose() { disposed += 1; },
    },
  };
}
```

`ProgressEvent`/`ProgressReporter` are already imported at the top of `cli.test.ts` (`import type { ProgressEvent, ProgressReporter } from "./progress/types.js";`) — no import changes needed.

- [ ] **Step 4: Run the full CLI suite to confirm the hoist didn't break anything**

Run: `pnpm --filter @scopelock/cli build && pnpm --filter @scopelock/cli test 2>&1 | tail -15`
Expected: PASS, identical total count to before this task (pure refactor, no new tests yet — this task adds no new test cases, it only relocates one existing helper and widens one type).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/progress/types.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): add plan-prepare/task-finish phase names, hoist recording-reporter helper"
```

---

### Task 2: Wire `task finish` (reporter + failure-first findings table)

**Files:**
- Modify: `packages/cli/src/commands/task-finish.ts`
- Modify: `packages/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: `ProgressReporter`, `ProgressEvent` (Task 1), `createNoopReporter` (Phase 1, `packages/cli/src/progress/noop-reporter.ts`), `renderStatusTable`/`StatusRow` (Phase 1, `packages/cli/src/ui.ts`), `recordingReporter` (Task 1, `cli.test.ts`).
- Produces (used by Task 4): `taskFinishCommand(options: { out?: string; open?: boolean; cwd?: string; reporter?: ProgressReporter }): Promise<CommandResult>` — same exported name and return type as today, one new optional field.

- [ ] **Step 1: Write the failing tests**

Open `packages/cli/src/cli.test.ts` and find the existing `it("finishes with attention for blocked and outside-scope changes", ...)` test (search for it — it already builds a fixture with one blocked path and one outside-scope path). Add two new tests right after it, inside the same `describe` block that contains the existing `taskFinishCommand` tests (search for `taskFinishCommand({ cwd: dir })` to find the right block):

```ts
  it("emits checking-drift then rendering-report phases and disposes the reporter", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "app.ts"), "export const value = 1;\n");
      commitFixture(dir, "task fixture");
      assert.equal((await taskStartCommand({
        description: "phase events",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "phase-events-finish",
        yes: true,
        interactive: false,
        cwd: dir,
      }, { setup: readySetup })).exitCode, 0);

      const recording = recordingReporter();
      const finished = await taskFinishCommand({ cwd: dir, reporter: recording.reporter });
      assert.equal(finished.exitCode, 0);
      assert.deepEqual(recording.events, [
        { type: "phase", name: "checking-drift" },
        { type: "phase", name: "rendering-report" },
      ]);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("disposes the reporter even when there is no active contract", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const recording = recordingReporter();
      await assert.rejects(
        taskFinishCommand({ cwd: dir, reporter: recording.reporter }),
        /no active task/,
      );
      assert.equal(recording.disposeCount(), 1);
      assert.deepEqual(recording.events, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

Then find the existing `it("finishes with attention for blocked and outside-scope changes", ...)` test and add these assertions at the end of its `try` block, right before the closing brace (after the existing `assert.equal(summary.blocked, 1);` line — read the current file to find the exact spot, the test continues a little further with an `outside` assertion too, add after that):

```ts
      assert.match(finished.human ?? "", /Blocked changes/);
      assert.match(finished.human ?? "", /changes touched forbidden paths/);
      assert.match(finished.human ?? "", /Outside scope/);
      assert.match(finished.human ?? "", /changes fell outside the approved scope/);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `taskFinishCommand` does not accept a `reporter` option (type error), and/or the new `human`-text assertions don't match today's plain `renderTable` output (no "changes touched forbidden paths" text exists yet).

- [ ] **Step 3: Implement the wiring and the failure-first table**

Replace the full contents of `packages/cli/src/commands/task-finish.ts` with:

```ts
import {
  classifyPath,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  scopelockPaths,
  type DriftReport,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections, renderStatusTable, type StatusRow } from "../ui.js";
import { checkDriftCommand } from "./check-drift.js";
import { reportCommand } from "./report.js";
import { createNoopReporter } from "../progress/noop-reporter.js";
import type { ProgressReporter } from "../progress/types.js";

type TaskFinishOptions = {
  out?: string;
  open?: boolean;
  cwd?: string;
  reporter?: ProgressReporter;
};

async function taskFinishWithReporter(
  options: TaskFinishOptions,
  reporter: ProgressReporter,
): Promise<CommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = findRepoRoot(cwd);
  if (root === null) throw new CliError("NOT_A_GIT_REPO", "task finish must run inside a git repository");

  const paths = scopelockPaths(root);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError("NO_ACTIVE_CONTRACT", "no active task; start one with `scopelock task start`");
  }
  const contract = await loadContract(paths, activeId);
  reporter.emit({ type: "phase", name: "checking-drift" });
  const checked = await checkDriftCommand({}, root);
  const { reportPath, report } = checked.data as { reportPath: string; report: DriftReport };
  reporter.emit({ type: "phase", name: "rendering-report" });
  const rendered = await reportCommand(reportPath, { out: options.out, open: options.open }, root);
  const htmlPath = (rendered.data as { reportPath: string }).reportPath;

  const groups = { planned: [] as string[], forbidden: [] as string[], outside: [] as string[] };
  for (const file of report.changedFiles) groups[classifyPath(file, contract.scope)].push(file.path);
  const highRisk = report.violations.filter((violation) => violation.type === "high_risk_file").length;
  const statusRows: StatusRow[] = [
    {
      id: "Allowed changes",
      status: "pass",
      cells: [String(groups.planned.length), groups.planned.join(", ") || "none"],
    },
    {
      id: "Blocked changes",
      status: groups.forbidden.length > 0 ? "fail" : "pass",
      cells: [String(groups.forbidden.length), groups.forbidden.join(", ") || "none"],
      reason: groups.forbidden.length > 0 ? "changes touched forbidden paths" : undefined,
    },
    {
      id: "Outside scope",
      status: groups.outside.length > 0 ? "warn" : "pass",
      cells: [String(groups.outside.length), groups.outside.join(", ") || "none"],
      reason: groups.outside.length > 0 ? "changes fell outside the approved scope" : undefined,
    },
    {
      id: "High risk",
      status: highRisk > 0 ? "fail" : "pass",
      cells: [String(highRisk), highRisk > 0 ? "review the drift report" : "none"],
      reason: highRisk > 0 ? "sensitive files changed" : undefined,
    },
  ];
  const table = renderStatusTable("Finding", ["Count", "Paths"], statusRows);
  const clean = report.violations.length === 0;

  return {
    data: {
      contractId: activeId,
      reportPath,
      htmlPath,
      opened: options.open === true,
      report,
      summary: {
        allowed: groups.planned.length,
        blocked: groups.forbidden.length,
        outside: groups.outside.length,
        highRisk,
      },
    },
    human: renderSections([
      { title: "Context", lines: `Task boundary  ${activeId}` },
      { title: "Checks", lines: [table, "Tests executed  no (ScopeLock checked contract evidence only)"] },
      {
        title: "Result",
        lines: [
          clean ? "Cleared" : `Attention required: ${report.violations.length} violation${report.violations.length === 1 ? "" : "s"}`,
          `Drift report  ${reportPath}`,
          `Flight Report ${htmlPath}`,
          `Browser       ${options.open === true ? "opened" : "not opened"}`,
        ],
      },
      {
        title: "Next",
        lines: clean
          ? "Review and commit the accepted changes"
          : "Fix unexpected changes, then run: scopelock task finish",
      },
    ]),
    exitCode: clean ? 0 : 1,
  };
}

export async function taskFinishCommand(
  options: TaskFinishOptions = {},
): Promise<CommandResult> {
  const reporter = options.reporter ?? createNoopReporter();
  try {
    return await taskFinishWithReporter(options, reporter);
  } finally {
    reporter.dispose();
  }
}
```

This is a full-file replacement: the only behavioral changes from the current file are (a) the `reporter` option and its two `phase` emissions, and (b) swapping the `renderTable(["Finding","Count","Paths"], [...])` call for the `renderStatusTable("Finding", ["Count","Paths"], statusRows)` call built from the same `groups`/`highRisk` values the current code already computes. Everything else (imports besides the `renderTable`→`renderStatusTable` swap, the `data` shape, exit code logic) is unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && pnpm --filter @scopelock/cli test 2>&1 | tail -15`
Expected: PASS, full suite green, including the two new tests and the extended assertions on the existing "attention" test.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/task-finish.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): wire progress reporter and failure-first table into task finish"
```

---

### Task 3: Wire `plan prepare` (reporter + phase events, no table restructuring)

**Files:**
- Modify: `packages/cli/src/commands/plan-prepare.ts`
- Modify: `packages/cli/src/cli.test.ts`

**Interfaces:**
- Consumes: `ProgressReporter`, `ProgressEvent` (Task 1), `createNoopReporter` (Phase 1), `recordingReporter` (Task 1).
- Produces (used by Task 4): `planPrepareCommand(planPath: string, options: PlanPrepareOptions): Promise<CommandResult>` — same exported name/signature, `PlanPrepareOptions` gains one new optional field `reporter?: ProgressReporter`.

- [ ] **Step 1: Write the failing tests**

`describe("plan prepare", ...)` in `packages/cli/src/cli.test.ts` currently drives `planPrepareCommand` only through `runCli` (subprocess), not direct import — this task adds the first direct-import tests for it, so first add the import. Near the top of `cli.test.ts`, alongside the existing `import { taskFinishCommand } from "./commands/task-finish.js";`, add:

```ts
import { planPrepareCommand } from "./commands/plan-prepare.js";
```

The block already has two local helpers your new tests must reuse exactly as they exist today (verified by reading the current file — do not redefine them):
- `writeContract(dir, id, planned, read?)` — creates and approves a draft contract, returns the contract's repo-relative path as the string `` `.scopelock/contracts/${id}.json` ``.
- `fakeCodexEnv(dir)` — returns a `NodeJS.ProcessEnv` whose `PATH` makes a fake `codex` executable discoverable (writes a shim under `dir` or a temp bin dir); every existing successful-preparation test passes this env to `runCli(dir, args, env)` as a subprocess environment.

Your two new tests call `planPrepareCommand` directly (in-process) rather than through `runCli`, because they need to pass a `reporter` object across the call — that cannot cross a subprocess boundary. Since `findAgentExecutable` inside `planPrepareCommand` reads the *current process*'s `process.env.PATH` (not a per-call env parameter), apply `fakeCodexEnv`'s returned `PATH` to `process.env.PATH` directly for the duration of the call, saving and restoring it exactly like the `process.chdir` save/restore below. Add these two tests inside `describe("plan prepare", () => { ... })`, near the other tests in that block:

```ts
  it("emits scheduling, preflight, and composing phases and disposes the reporter", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "phase-events-plan",
        tasks: [{ id: "a", contract, command: "echo must-be-replaced" }],
      }));
      const env = await fakeCodexEnv(dir);
      const previousCwd = process.cwd();
      const previousPath = process.env.PATH;
      process.chdir(dir);
      process.env.PATH = env.PATH;
      try {
        const recording = recordingReporter();
        const prepared = await planPrepareCommand("plan.json", {
          target: "codex",
          out: "ready.json",
          validationCwd: ".",
          validationCommand: [process.execPath],
          reporter: recording.reporter,
        });
        assert.equal(prepared.exitCode, 0, prepared.human);
        assert.deepEqual(recording.events, [
          { type: "phase", name: "scheduling" },
          { type: "phase", name: "preflight" },
          { type: "phase", name: "composing" },
        ]);
        assert.equal(recording.disposeCount(), 1);
      } finally {
        process.chdir(previousCwd);
        process.env.PATH = previousPath;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still disposes the reporter and stops after scheduling when there is a cycle", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const a = await writeContract(dir, "a", ["a.txt"], ["b.txt"]);
      const b = await writeContract(dir, "b", ["b.txt"], ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "cycle-plan",
        tasks: [{ id: "a", contract: a }, { id: "b", contract: b }],
      }));
      const previousCwd = process.cwd();
      process.chdir(dir);
      try {
        const recording = recordingReporter();
        const prepared = await planPrepareCommand("plan.json", {
          target: "codex",
          out: "ready.json",
          reporter: recording.reporter,
        });
        assert.equal(prepared.exitCode, 1);
        assert.deepEqual(recording.events, [{ type: "phase", name: "scheduling" }]);
        assert.equal(recording.disposeCount(), 1);
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

The second test never reaches the `preflight` phase because `plan-prepare.ts` returns early (with the schedule's unschedulable-cycle result) before the `reporter.emit({ type: "phase", name: "preflight" })` call — it needs no `fakeCodexEnv`/`PATH` handling at all, since it never reaches agent-executable discovery.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `planPrepareCommand` does not accept a `reporter` option (type error) and/or no `phase` events are emitted yet.

- [ ] **Step 3: Implement the wiring**

Open `packages/cli/src/commands/plan-prepare.ts`. Add to the imports:

```ts
import { createNoopReporter } from "../progress/noop-reporter.js";
import type { ProgressReporter } from "../progress/types.js";
```

Add `reporter?: ProgressReporter;` to the `PlanPrepareOptions` type (alongside the existing `acceptanceChecks?: string[];` field).

Rename the current `export async function planPrepareCommand(planPath, options)` to a private `async function planPrepareWithReporter(planPath: string, options: PlanPrepareOptions, reporter: ProgressReporter): Promise<CommandResult>` (drop the `export`, add the `reporter` parameter), and add exactly three `reporter.emit(...)` calls at these three points in its body (do not change anything else in the function):

1. Immediately after the `outputPath === inputPath` check, before the `const scheduled = await planParallelCommand(...)` line:
   ```ts
   reporter.emit({ type: "phase", name: "scheduling" });
   ```
2. Immediately after the `if (schedule.cycles.length > 0) { ... return result(...); }` block (i.e., right before `const executablePath = findAgentExecutable(target);`):
   ```ts
   reporter.emit({ type: "phase", name: "preflight" });
   ```
3. Immediately after the environment-not-ready early return (`if (!executable.found || (workspace !== null && workspace.summary.violationsCount > 0)) { ... return result(...); }`), right before `const composed = await planFillCommandsCommand(...)`:
   ```ts
   reporter.emit({ type: "phase", name: "composing" });
   ```

Then add the new public wrapper at the bottom of the file (after the renamed private function):

```ts
export async function planPrepareCommand(
  planPath: string,
  options: PlanPrepareOptions,
): Promise<CommandResult> {
  const reporter = options.reporter ?? createNoopReporter();
  try {
    return await planPrepareWithReporter(planPath, options, reporter);
  } finally {
    reporter.dispose();
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && pnpm --filter @scopelock/cli test 2>&1 | tail -15`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/plan-prepare.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): wire progress reporter phase events into plan prepare"
```

---

### Task 4: Wire `index.ts` and update docs

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `docs/reference.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `createReporter` (already imported in `index.ts` from Phase 2, `packages/cli/src/progress/create-reporter.js`), `planPrepareCommand`, `taskFinishCommand` (Tasks 2-3, unchanged import paths).

- [ ] **Step 1: Wire `plan prepare`'s registration**

Open `packages/cli/src/index.ts`. Find the `plan.command("prepare")...action(...)` block (search for `planPrepareCommand(planPath, {`). Immediately before the `planPrepareCommand(planPath, {` call, inside the same arrow function body, add:

```ts
        const reporter = createReporter(process.stdout, jsonOf(command));
```

Then add `reporter,` as a new property inside the object literal passed to `planPrepareCommand(planPath, { ...options, ..., reporter })` (alongside the existing `validationChecks`/`acceptanceChecks` fields already being spread in there).

- [ ] **Step 2: Wire `task finish`'s registration**

In the same file, find:

```ts
task
  .command("finish")
  .description("check the active task and create its Flight Report")
  .option("--out <path>", "write HTML report to this path")
  .option("--open", "open the generated report in the default browser")
  .option("--json", "print machine-readable JSON")
  .action((options: { out?: string; open?: boolean }, command: Command) =>
    run(() => taskFinishCommand(options), jsonOf(command)),
  );
```

Replace the `.action(...)` callback with:

```ts
  .action((options: { out?: string; open?: boolean }, command: Command) => {
    const json = jsonOf(command);
    const reporter = createReporter(process.stdout, json);
    return run(() => taskFinishCommand({ ...options, reporter }), json);
  });
```

- [ ] **Step 3: Run the full CLI test suite**

Run: `pnpm --filter @scopelock/cli build && pnpm --filter @scopelock/cli test 2>&1 | tail -15`
Expected: PASS, full suite green — this step only wires already-tested command functions into Commander registration, no new event-sequence behavior to unit test here (the existing `runCli`-based subprocess tests in `describe("plan prepare", ...)` and any `task finish` CLI-level tests already exercise this registration path end-to-end and should continue passing unchanged).

- [ ] **Step 4: Update documentation**

Open `docs/reference.md`. Find the section documenting `run`'s live progress output (added in Phase 2 — search for "live" or "progress" or "TTY" to find it). Add one short paragraph noting `plan prepare` and `task finish` now show the same phase-based progress (spinner on interactive TTY, flat lines in CI, silent under `--json`), following that section's existing style — do not duplicate the full TTY/CI/JSON behavior explanation, just cross-reference it and name the phases each command emits (`scheduling`/`preflight`/`composing` for `plan prepare`; `checking-drift`/`rendering-report` for `task finish`).

Open `CHANGELOG.md`. Add one bullet under the current unreleased section, in the same terse style as the existing Phase 1/Phase 2 entries (search for the Phase 1/2 changelog lines already there to match phrasing), noting that `plan prepare` and `task finish` now report live progress the same way `run` does, and that `task finish`'s findings table now visually distinguishes blocked/outside-scope/high-risk findings from clean ones.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts docs/reference.md CHANGELOG.md
git commit -m "feat(cli): wire plan prepare and task finish into Commander with live progress"
```

---

## Final verification (run once, after Task 4)

- [ ] **Full package check**

```bash
pnpm --filter @scopelock/cli typecheck
pnpm --filter @scopelock/cli build
pnpm --filter @scopelock/cli test 2>&1 | tail -20
```

Expected: typecheck clean, build clean, full suite green with no regressions in any existing test (`run`, `plan prepare`, `task finish`, `task start`, and every `progress/*` and `ui.test.ts` file).

- [ ] **Repo-wide gate**

```bash
pnpm typecheck && pnpm build && pnpm test
node packages/cli/dist/index.js check-drift
git diff --check
```

Expected: all green, `check-drift` reports zero violations under this task's approved ScopeLock contract, diff has no whitespace errors.

## Out of scope for this plan (tracked for a future phase)

- `plan prepare`'s own `checks: string[]` list is not restructured into `StatusRow`s (see Global Constraints — a separable follow-up, not silently dropped).
- The Guided wizard `Step N of M` headers and `renderStatusTable`-based review screen in `task-start.ts` — that is Phase 4, a separate PR, after this plan merges.
- No change to `run-plan.ts` (Phase 2's own file) beyond what it already has.
