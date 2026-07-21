# `plan prepare` status table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `plan prepare`'s human-readable `Checks` section as a failure-first `renderStatusTable`, matching the visual treatment already used by `task finish` and `task start`, with zero change to the JSON `data.checks` contract or `exitCode`.

**Architecture:** `packages/cli/src/commands/plan-prepare.ts` keeps building `checks: string[]` exactly as today (same `checks.push(...)` calls, same order, sole source of `data.checks`). A new parallel `checkRows: StatusRow[]` array is built alongside it — one paired `checkRows.push(...)` per `checks.push(...)` — and passed as an explicit parameter into `result()`, which renders it via `renderStatusTable("Check", ["Detail"], checkRows)` instead of the current plain `lines: data.checks as string[]`. `checkRows` never enters `data`, so it cannot leak into JSON output.

**Tech Stack:** TypeScript, Node's built-in test runner (`node --test`), the existing `StatusRow`/`renderStatusTable` primitives in `packages/cli/src/ui.ts` (already used by `task-finish.ts` and `task-start.ts`).

## Global Constraints

- `data.checks` (the JSON contract) must remain byte-identical in content and order to today's output — verified by every existing `--json` test in `packages/cli/src/cli.test.ts` that reads `data.checks`, none of which may need modification.
- `exitCode` and all early-return control flow are unchanged — this is a rendering-only change.
- No change to `Execution stages`, `Context`, `Result`, or `Next` sections of the human output.
- No change to `plan-parallel.ts`, `agents-preflight.ts`, `plan-fill-commands.ts`, or the progress-reporter `phase` events already wired in `plan-prepare.ts` (`scheduling`/`preflight`/`composing`).
- Row-by-row `id`/`status`/`cells`/`reason` mapping must exactly match the table in `docs/superpowers/specs/2026-07-21-plan-prepare-status-table-design.md` — copied verbatim into Task 1 below.

---

### Task 1: Parallel `checkRows` construction + `renderStatusTable` wiring

**Files:**
- Modify: `packages/cli/src/commands/plan-prepare.ts`
- Test: `packages/cli/src/cli.test.ts` (existing `describe("plan prepare", ...)` block, starts at line 1979)

**Interfaces:**
- Consumes: `StatusRow`, `renderStatusTable` from `packages/cli/src/ui.ts` (already exported: `export type StatusRow = { id: string; status: "pass" | "warn" | "fail" | "skip"; cells: string[]; reason?: string; logPath?: string }`, `export function renderStatusTable(idHeader: string, restHeaders: string[], rows: StatusRow[]): string`).
- Produces: no new exports. `result()`'s signature changes from `(data, humanResult, next, exitCode)` to `(data, checkRows, humanResult, next, exitCode)` — this is a private, in-file function with a single caller pattern (all 5 call sites inside `planPrepareWithReporter`), so this is a mechanical, self-contained change.

This is the only task in this plan — the change is a single, self-contained file with no cross-task interfaces to hand off.

#### Step 1: Write the failing tests

Two of the existing tests in `describe("plan prepare", ...)` assert on human-mode output. Extend them with assertions that only pass once the new table (with reason lines) exists — the current plain-string output does not contain reason text, so these assertions fail against today's code.

In `packages/cli/src/cli.test.ts`, find the test `"still disposes the reporter and stops after scheduling when there is a cycle"` (around line 2109). Its body currently ends with:

```ts
        const prepared = await planPrepareCommand("plan.json", {
          target: "codex",
          out: "ready.json",
          reporter: recording.reporter,
        });
        assert.equal(prepared.exitCode, 1);
        assert.deepEqual(recording.events, [{ type: "phase", name: "scheduling" }]);
        assert.equal(recording.disposeCount(), 1);
```

Add two assertions right after `assert.equal(prepared.exitCode, 1);`:

```ts
        assert.equal(prepared.exitCode, 1);
        assert.match(prepared.human ?? "", /Unschedulable groups/);
        assert.match(prepared.human ?? "", /circular dependencies block scheduling/);
        assert.deepEqual(recording.events, [{ type: "phase", name: "scheduling" }]);
        assert.equal(recording.disposeCount(), 1);
```

Next, find the test `"detects an npm check script and refuses to guess when validation is unknown"` (around line 2367). It currently has:

```ts
      assert.equal(unknown.status, 1, unknown.stdout || unknown.stderr);
      assert.match(unknown.stdout, /not detected/);
      assert.match(unknown.stdout, /--validation-check <id> <executable>/);
```

Add one assertion after the `/not detected/` line:

```ts
      assert.equal(unknown.status, 1, unknown.stdout || unknown.stderr);
      assert.match(unknown.stdout, /not detected/);
      assert.match(unknown.stdout, /pass --validation-check to supply one/);
      assert.match(unknown.stdout, /--validation-check <id> <executable>/);
```

#### Step 2: Run the tests to verify they fail

Run:

```bash
cd "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
pnpm --filter @scopelock/cli build
node --test packages/cli/dist/cli.test.js --test-name-pattern "stops after scheduling when there is a cycle|refuses to guess when validation is unknown"
```

Expected: both tests FAIL. The cycle test fails on `assert.match(prepared.human ?? "", /circular dependencies block scheduling/)` (text does not exist yet). The validation test fails on `assert.match(unknown.stdout, /pass --validation-check to supply one/)` (text does not exist yet).

#### Step 3: Implement the parallel `checkRows` array and `renderStatusTable` wiring

In `packages/cli/src/commands/plan-prepare.ts`:

**3a. Add the import.** Find the existing import from `../ui.js`:

```ts
import { renderSections } from "../ui.js";
```

Replace it with:

```ts
import { renderSections, renderStatusTable, type StatusRow } from "../ui.js";
```

**3b. Change `result()`'s signature and body.** Find:

```ts
function result(
  data: Record<string, unknown>,
  humanResult: string,
  next: string,
  exitCode: 0 | 1,
): CommandResult {
  const schedule = data.schedule as ScheduleData;
  const stages = stageLines(schedule.waves);
  return {
    data: { ...data, stages: schedule.waves, conflicts: schedule.conflicts, cycles: schedule.cycles },
    human: renderSections([
      { title: "Context", lines: [`Plan    ${schedule.planId}`, `Target  ${String(data.target)}`] },
      { title: "Execution stages", lines: stages.length > 0 ? stages : "none" },
      { title: "Checks", lines: data.checks as string[] },
      { title: "Result", lines: humanResult },
      { title: "Next", lines: next },
    ]),
    exitCode,
  };
}
```

Replace with:

```ts
function result(
  data: Record<string, unknown>,
  checkRows: StatusRow[],
  humanResult: string,
  next: string,
  exitCode: 0 | 1,
): CommandResult {
  const schedule = data.schedule as ScheduleData;
  const stages = stageLines(schedule.waves);
  return {
    data: { ...data, stages: schedule.waves, conflicts: schedule.conflicts, cycles: schedule.cycles },
    human: renderSections([
      { title: "Context", lines: [`Plan    ${schedule.planId}`, `Target  ${String(data.target)}`] },
      { title: "Execution stages", lines: stages.length > 0 ? stages : "none" },
      { title: "Checks", lines: renderStatusTable("Check", ["Detail"], checkRows) },
      { title: "Result", lines: humanResult },
      { title: "Next", lines: next },
    ]),
    exitCode,
  };
}
```

**3c. Build `checkRows` in parallel with `checks`, and pass it to every `result()` call.** Find the start of `planPrepareWithReporter`'s body where `checks` is first built:

```ts
  reporter.emit({ type: "phase", name: "scheduling" });
  const scheduled = await planParallelCommand(planPath, {
    includeReadHazards: options.readHazards !== false,
    requireApproved: true,
  });
  const schedule = scheduled.data as ScheduleData;
  const checks = [
    schedule.conflicts.length === 0
      ? "No scope overlaps found"
      : `${schedule.conflicts.length} scope overlap${schedule.conflicts.length === 1 ? "" : "s"} ordered safely`,
  ];
  const base = { target, schedule, checks };
  if (schedule.cycles.length > 0) {
    checks.push(`${schedule.cycles.length} unschedulable read-write group${schedule.cycles.length === 1 ? "" : "s"}`);
    return result(
      { ...base, preflight: null, outputPath: null },
      "Plan needs changes; no ready plan was written",
      `Adjust task boundaries, then run: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)}`,
      1,
    );
  }
```

Replace with:

```ts
  reporter.emit({ type: "phase", name: "scheduling" });
  const scheduled = await planParallelCommand(planPath, {
    includeReadHazards: options.readHazards !== false,
    requireApproved: true,
  });
  const schedule = scheduled.data as ScheduleData;
  const checks = [
    schedule.conflicts.length === 0
      ? "No scope overlaps found"
      : `${schedule.conflicts.length} scope overlap${schedule.conflicts.length === 1 ? "" : "s"} ordered safely`,
  ];
  const checkRows: StatusRow[] = [
    schedule.conflicts.length === 0
      ? { id: "Scope overlaps", status: "pass", cells: ["No overlaps found"] }
      : {
          id: "Scope overlaps",
          status: "warn",
          cells: [`${schedule.conflicts.length} ordered safely`],
          reason: "overlapping scope was reordered into separate stages",
        },
  ];
  const base = { target, schedule, checks };
  if (schedule.cycles.length > 0) {
    checks.push(`${schedule.cycles.length} unschedulable read-write group${schedule.cycles.length === 1 ? "" : "s"}`);
    checkRows.push({
      id: "Unschedulable groups",
      status: "fail",
      cells: [`${schedule.cycles.length} read-write group${schedule.cycles.length === 1 ? "" : "s"}`],
      reason: "circular dependencies block scheduling",
    });
    return result(
      { ...base, preflight: null, outputPath: null },
      checkRows,
      "Plan needs changes; no ready plan was written",
      `Adjust task boundaries, then run: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)}`,
      1,
    );
  }
```

Next, find the preflight block:

```ts
  reporter.emit({ type: "phase", name: "preflight" });
  const executablePath = findAgentExecutable(target);
  const executable = { name: target === "cursor" ? "agent" : target, found: executablePath !== null, path: executablePath };
  const hook = probeHookConfig(root, target);
  checks.push(`${HARNESSES[target].label} CLI  ${executable.found ? "found" : "not found"}`);
  checks.push(`Hook confidence  ${hook.capabilities.confidence}`);

  let workspace: AgentEnvironmentPreflightReport | null = null;
  if (options.manifest !== undefined) {
    const preflight = await agentsPreflightCommand({ manifest: options.manifest, target: [target] });
    workspace = (preflight.data as { report: AgentEnvironmentPreflightReport }).report;
    checks.push(`Rules and skills  ${workspace.summary.status}`);
  } else {
    checks.push("Rules and skills  not configured (no manifest supplied)");
  }
  const preflight = { executable, hook, workspace };
  if (!executable.found || (workspace !== null && workspace.summary.violationsCount > 0)) {
    return result(
      { ...base, preflight, outputPath: null },
      "Environment needs attention; no ready plan was written",
      !executable.found
        ? `Install ${HARNESSES[target].label}, then run: scopelock setup --target ${target}`
        : `Review fixes: scopelock agents preflight --manifest ${JSON.stringify(options.manifest)} --target ${target}`,
      1,
    );
  }
```

Replace with:

```ts
  reporter.emit({ type: "phase", name: "preflight" });
  const executablePath = findAgentExecutable(target);
  const executable = { name: target === "cursor" ? "agent" : target, found: executablePath !== null, path: executablePath };
  const hook = probeHookConfig(root, target);
  checks.push(`${HARNESSES[target].label} CLI  ${executable.found ? "found" : "not found"}`);
  checkRows.push({
    id: `${HARNESSES[target].label} CLI`,
    status: executable.found ? "pass" : "fail",
    cells: [executable.found ? "found" : "not found"],
    reason: executable.found ? undefined : "install the target agent's CLI",
  });
  checks.push(`Hook confidence  ${hook.capabilities.confidence}`);
  checkRows.push({
    id: "Hook confidence",
    status: hook.capabilities.confidence === "degraded" ? "warn" : "pass",
    cells: [hook.capabilities.confidence],
    reason: hook.capabilities.confidence === "degraded"
      ? "project trust could not be verified statically"
      : undefined,
  });

  let workspace: AgentEnvironmentPreflightReport | null = null;
  if (options.manifest !== undefined) {
    const preflight = await agentsPreflightCommand({ manifest: options.manifest, target: [target] });
    workspace = (preflight.data as { report: AgentEnvironmentPreflightReport }).report;
    checks.push(`Rules and skills  ${workspace.summary.status}`);
    checkRows.push({
      id: "Rules and skills",
      status: workspace.summary.status,
      cells: [workspace.summary.status],
      reason: workspace.summary.status !== "pass"
        ? `${workspace.summary.violationsCount} violation${workspace.summary.violationsCount === 1 ? "" : "s"} found`
        : undefined,
    });
  } else {
    checks.push("Rules and skills  not configured (no manifest supplied)");
    checkRows.push({
      id: "Rules and skills",
      status: "warn",
      cells: ["not configured"],
      reason: "no manifest supplied",
    });
  }
  const preflight = { executable, hook, workspace };
  if (!executable.found || (workspace !== null && workspace.summary.violationsCount > 0)) {
    return result(
      { ...base, preflight, outputPath: null },
      checkRows,
      "Environment needs attention; no ready plan was written",
      !executable.found
        ? `Install ${HARNESSES[target].label}, then run: scopelock setup --target ${target}`
        : `Review fixes: scopelock agents preflight --manifest ${JSON.stringify(options.manifest)} --target ${target}`,
      1,
    );
  }
```

Next, find the composing block's early return:

```ts
  reporter.emit({ type: "phase", name: "composing" });
  const composed = await planFillCommandsCommand(planPath, {
    target,
    force: true,
    executable: executablePath ?? undefined,
  });
  const composition = composed.data as { plan: SchedulePlan; unsupported: unknown[] };
  if (composed.exitCode !== 0 || composition.unsupported.length > 0) {
    return result(
      { ...base, preflight, composition, outputPath: null },
      "Agent commands could not be composed; no ready plan was written",
      "Review the unsupported tasks, then run: scopelock plan prepare",
      1,
    );
  }
```

Replace with (only the `result()` call changes — add `checkRows` as the second argument; no new check is pushed here, matching today's behavior):

```ts
  reporter.emit({ type: "phase", name: "composing" });
  const composed = await planFillCommandsCommand(planPath, {
    target,
    force: true,
    executable: executablePath ?? undefined,
  });
  const composition = composed.data as { plan: SchedulePlan; unsupported: unknown[] };
  if (composed.exitCode !== 0 || composition.unsupported.length > 0) {
    return result(
      { ...base, preflight, composition, outputPath: null },
      checkRows,
      "Agent commands could not be composed; no ready plan was written",
      "Review the unsupported tasks, then run: scopelock plan prepare",
      1,
    );
  }
```

Next, find the validation-not-detected early return:

```ts
  if (composedValidation === null) {
    checks.push("Repository validation  not detected");
    return result(
      { ...base, preflight, composition, outputPath: null },
      "Validation check is required; no ready plan was written",
      `Run again with: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)} --validation-check <id> <executable> [args...]`,
      1,
    );
  }
```

Replace with:

```ts
  if (composedValidation === null) {
    checks.push("Repository validation  not detected");
    checkRows.push({
      id: "Repository validation",
      status: "fail",
      cells: ["not detected"],
      reason: "pass --validation-check to supply one",
    });
    return result(
      { ...base, preflight, composition, outputPath: null },
      checkRows,
      "Validation check is required; no ready plan was written",
      `Run again with: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)} --validation-check <id> <executable> [args...]`,
      1,
    );
  }
```

Finally, find the success path at the end of the function:

```ts
  await writeJsonAtomic(outputPath, readyPlan);
  checks.push(`${readyPlan.tasks.length} shell-free agent command${readyPlan.tasks.length === 1 ? "" : "s"} composed`);
  if (composedValidation.setup) checks.push(`Validation setup  ${composedValidation.setup.join(" ")}`);
  if (validationCwd) checks.push(`Validation cwd  ${validationCwd}`);
  for (const check of composedValidation.checks) {
    checks.push(
      `Validation check ${check.id}  required=${check.required}` +
        `${check.cwd ? ` cwd=${check.cwd}` : ""}  ${check.command.join(" ")}`,
    );
  }
  return result(
    { ...base, preflight, plan: readyPlan, outputPath },
    `Ready plan written  ${outputPath}\nNo agent was started`,
    `Review the file, then run: scopelock run ${JSON.stringify(outputPath)} --yes --isolate`,
    0,
  );
```

Replace with:

```ts
  await writeJsonAtomic(outputPath, readyPlan);
  checks.push(`${readyPlan.tasks.length} shell-free agent command${readyPlan.tasks.length === 1 ? "" : "s"} composed`);
  checkRows.push({ id: "Agent commands", status: "pass", cells: [`${readyPlan.tasks.length} composed`] });
  if (composedValidation.setup) {
    checks.push(`Validation setup  ${composedValidation.setup.join(" ")}`);
    checkRows.push({ id: "Validation setup", status: "pass", cells: [composedValidation.setup.join(" ")] });
  }
  if (validationCwd) {
    checks.push(`Validation cwd  ${validationCwd}`);
    checkRows.push({ id: "Validation cwd", status: "pass", cells: [validationCwd] });
  }
  for (const check of composedValidation.checks) {
    checks.push(
      `Validation check ${check.id}  required=${check.required}` +
        `${check.cwd ? ` cwd=${check.cwd}` : ""}  ${check.command.join(" ")}`,
    );
    checkRows.push({
      id: `Validation check ${check.id}`,
      status: "pass",
      cells: [`required=${check.required}${check.cwd ? ` cwd=${check.cwd}` : ""} ${check.command.join(" ")}`],
    });
  }
  return result(
    { ...base, preflight, plan: readyPlan, outputPath },
    checkRows,
    `Ready plan written  ${outputPath}\nNo agent was started`,
    `Review the file, then run: scopelock run ${JSON.stringify(outputPath)} --yes --isolate`,
    0,
  );
```

#### Step 4: Run the two tests to verify they pass

```bash
cd "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
pnpm --filter @scopelock/cli build
node --test packages/cli/dist/cli.test.js --test-name-pattern "stops after scheduling when there is a cycle|refuses to guess when validation is unknown"
```

Expected: both tests PASS.

#### Step 5: Run the full `plan prepare` describe block and the full CLI suite

```bash
cd "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
node --test packages/cli/dist/cli.test.js --test-name-pattern "plan prepare"
```

Expected: all `plan prepare` tests PASS, including every test that reads `data.checks` from JSON output (these assert on the unchanged `checks: string[]` array, which this task does not touch).

Then run the complete CLI suite plus the repo-wide gate to confirm no regressions elsewhere:

```bash
pnpm typecheck && pnpm build && pnpm test
```

Expected: all pass, matching (or exceeding, from the two new assertions) the pre-task test count.

#### Step 6: Commit

```bash
git add packages/cli/src/commands/plan-prepare.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): render plan prepare checks as a failure-first status table"
```

---

## Final Verification (after Task 1)

- `pnpm typecheck && pnpm build && pnpm test` green.
- `node packages/cli/dist/index.js check-drift` clean under this task's ScopeLock contract.
- `git diff --check` clean (no trailing whitespace).
- Manually inspect one full human-mode run (`node packages/cli/dist/index.js plan prepare <plan> --target codex --out ready.json` against a real fixture, or reuse an existing test fixture) to visually confirm the table renders as expected — failing/warning rows bright with `↳ reason`, passing rows dim, matching `task finish`/`task start`'s existing look.
