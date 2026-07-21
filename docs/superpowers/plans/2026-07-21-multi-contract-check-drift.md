# Multi-contract-aware top-level `check-drift` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `run`'s end-of-run drift check multi-contract-aware so a multi-task `run` no longer reports every other task's legitimately-approved changes as false-positive `outside_scope` violations, while leaving every existing single-contract code path (standalone `scopelock check-drift`, `task finish`) completely unchanged.

**Architecture:** A new `buildMultiContractDriftReport` function in `packages/core/src/drift/engine.ts` classifies each changed file against the union of several contracts' scopes (planned-if-any wins over forbidden-if-any wins over outside), kept entirely separate from the existing single-contract `buildDriftReport`. `checkDriftCommand` gains an optional `contractIds?: string[]` parameter that, when supplied, loads and verifies every named contract, requires them to share one approval baseline, and calls the new multi-contract report builder — the existing no-argument behavior is preserved byte-for-byte. `run-plan.ts`'s single internal drift-check call site is updated to pass every task's own contract id, since it already has them loaded in `taskContracts`.

**Tech Stack:** TypeScript, Zod (schema), Node's built-in test runner, the existing `classifyPath`/`highRiskViolations`/`missingTestsViolation` primitives in `packages/core/src/rules/`.

## Global Constraints

- Zero behavior change for the existing single-contract paths: standalone `scopelock check-drift` (no `contractIds`) and `task-finish.ts` (which calls `checkDriftCommand()` with no `contractIds`) must produce byte-identical output to today, verified by every existing test needing zero assertion changes.
- No new CLI flags on standalone `scopelock check-drift` — this fix is scoped entirely to `run`'s internal call site, which already has the task-contract set loaded.
- Never silently guess a shared baseline when contracts disagree — fail with an actionable, specific `CliError` naming every divergent contract id and baseline sha.
- `DriftReport`'s schema change must be purely additive (`contractIds?: string[]`) — `contractId` (singular) stays required and is set to the first contract's id for backward compatibility with existing consumers (`report.ts`'s HTML heading, `check-drift.ts`'s human renderer).
- Scope classification precedence: `planned` if any contract classifies a file `planned` (even if another contract's `forbiddenPathPatterns` also matches it) → else `forbidden` if any contract classifies it `forbidden` → else `outside`.
- `missing_tests` violations are de-duplicated by violation `type` across contracts (at most one `missing_tests` entry in a multi-contract report, even if several contracts declare `tests`).
- `highRiskViolations`, `repo_state`, and `repo_mode` violation detection are unchanged — these are already global, not scoped to any one contract.

---

### Task 1: `buildMultiContractDriftReport` + additive `DriftReport` schema field

**Files:**
- Modify: `packages/core/src/schemas/drift.ts:59-65` (the `driftReportSchema` object)
- Modify: `packages/core/src/drift/engine.ts` (add new function, existing `buildDriftReport` untouched)
- Test: `packages/core/src/drift.test.ts`

**Interfaces:**
- Consumes: `classifyPath(file: ChangedFile, scope: ContractScope): "forbidden" | "outside" | "planned"` (`packages/core/src/rules/path-rules.ts`, unchanged), `highRiskViolations(files, extraPatterns): DriftViolation[]` and `missingTestsViolation(files, contract, projectTypes): DriftViolation | null` (`packages/core/src/rules/`, unchanged).
- Produces: `export function buildMultiContractDriftReport(input: { contracts: ApprovedContract[]; files: ChangedFile[]; repoState: RepoState; repoMode: RepoMode; extraHighRiskPatterns?: string[]; projectTypes?: ProjectType[]; checkedAt: string }): DriftReport` — re-exported automatically via `packages/core/src/index.ts`'s existing `export * from "./drift/engine.js"`, no import-list change needed there. `DriftReport` (from `driftReportSchema`) gains an optional `contractIds?: string[]` field, consumed by Task 2 and Task 3.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/drift.test.ts`, add a new `describe` block. This file already has a `contract(overrides)` helper (defaults: `id: "contract-1"`, `scope.plannedPathPatterns: ["src/**"]`, `scope.forbiddenPathPatterns: ["src/auth/**"]`, `tests: [{ type: "unit", command: "pnpm test", required: true }]`) and a `changed(path)` helper — reuse both. Add this block right after the existing `describe("rules and engine", ...)` block closes (after the `it("builds a drift report with outside scope, high-risk and repo state violations", ...)` test, before `describe("review fixes R1/R2", ...)`):

```ts
describe("multi-contract drift", () => {
  it("treats a file planned by one contract as planned even if another contract forbids it", () => {
    const a = contract({
      id: "a",
      scope: { plannedPathPatterns: ["a/**"], forbiddenPathPatterns: [], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const b = contract({
      id: "b",
      scope: { plannedPathPatterns: ["b/**"], forbiddenPathPatterns: ["a/**"], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const report = buildMultiContractDriftReport({
      contracts: [a, b],
      files: [changed("a/file.ts")],
      repoState: { kind: "clean" },
      repoMode: "normal",
      checkedAt: "2026-07-21T00:00:00.000Z",
    });
    assert.deepEqual(report.violations, []);
  });

  it("flags a file unclaimed by any contract as outside_scope", () => {
    const a = contract({
      id: "a",
      scope: { plannedPathPatterns: ["a/**"], forbiddenPathPatterns: [], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const b = contract({
      id: "b",
      scope: { plannedPathPatterns: ["b/**"], forbiddenPathPatterns: [], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const report = buildMultiContractDriftReport({
      contracts: [a, b],
      files: [changed("c/file.ts")],
      repoState: { kind: "clean" },
      repoMode: "normal",
      checkedAt: "2026-07-21T00:00:00.000Z",
    });
    assert.deepEqual(report.violations.map((v) => v.type), ["outside_scope"]);
  });

  it("flags a file forbidden by at least one contract and planned by none as forbidden_path", () => {
    const a = contract({
      id: "a",
      scope: { plannedPathPatterns: ["a/**"], forbiddenPathPatterns: ["secrets/**"], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const b = contract({
      id: "b",
      scope: { plannedPathPatterns: ["b/**"], forbiddenPathPatterns: [], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const report = buildMultiContractDriftReport({
      contracts: [a, b],
      files: [changed("secrets/key.txt")],
      repoState: { kind: "clean" },
      repoMode: "normal",
      checkedAt: "2026-07-21T00:00:00.000Z",
    });
    assert.deepEqual(report.violations.map((v) => v.type), ["forbidden_path"]);
  });

  it("de-duplicates missing_tests across multiple contracts that both declare tests", () => {
    const a = contract({ id: "a" });
    const b = contract({ id: "b" });
    const report = buildMultiContractDriftReport({
      contracts: [a, b],
      files: [changed("src/file.ts")],
      repoState: { kind: "clean" },
      repoMode: "normal",
      checkedAt: "2026-07-21T00:00:00.000Z",
    });
    assert.deepEqual(report.violations.map((v) => v.type), ["missing_tests"]);
  });

  it("sets contractId to the first contract and lists every id in contractIds", () => {
    const a = contract({
      id: "a",
      scope: { plannedPathPatterns: ["**"], forbiddenPathPatterns: [], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const b = contract({
      id: "b",
      scope: { plannedPathPatterns: ["**"], forbiddenPathPatterns: [], allowAllPaths: false, readPathPatterns: [] },
      tests: [],
    });
    const report = buildMultiContractDriftReport({
      contracts: [a, b],
      files: [],
      repoState: { kind: "clean" },
      repoMode: "normal",
      checkedAt: "2026-07-21T00:00:00.000Z",
    });
    assert.equal(report.contractId, "a");
    assert.deepEqual(report.contractIds, ["a", "b"]);
  });
});
```

Add `buildMultiContractDriftReport` to this test file's existing import list from `"./index.js"` (find the `import { buildDriftReport, changedSinceBaseline, classifyPath, ... } from "./index.js";` block near the top and add `buildMultiContractDriftReport,` alphabetically after `buildDriftReport,`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scopelock/core build && node --test packages/core/dist/drift.test.js --test-name-pattern "multi-contract drift"`
Expected: FAIL — `buildMultiContractDriftReport is not a function` (or a TypeScript build error, since the function doesn't exist yet).

- [ ] **Step 3: Add the additive schema field**

In `packages/core/src/schemas/drift.ts`, find:

```ts
export const driftReportSchema = z.object({
  schemaVersion: z.literal(DRIFT_REPORT_SCHEMA_VERSION),
  contractId: z.string().min(1),
  checkedAt: z.iso.datetime(),
  repoMode: repoModeSchema.default("normal"),
  repoState: repoStateSchema.default({ kind: "clean" }),
  changedFiles: z.array(changedFileSchema).default([]),
  violations: z.array(driftViolationSchema).default([]),
});
```

Replace with:

```ts
export const driftReportSchema = z.object({
  schemaVersion: z.literal(DRIFT_REPORT_SCHEMA_VERSION),
  contractId: z.string().min(1),
  contractIds: z.array(z.string().min(1)).min(1).optional(),
  checkedAt: z.iso.datetime(),
  repoMode: repoModeSchema.default("normal"),
  repoState: repoStateSchema.default({ kind: "clean" }),
  changedFiles: z.array(changedFileSchema).default([]),
  violations: z.array(driftViolationSchema).default([]),
});
```

(`export type DriftReport = z.infer<typeof driftReportSchema>;` further down the file needs no change — it derives the new optional field automatically.)

- [ ] **Step 4: Implement `buildMultiContractDriftReport`**

In `packages/core/src/drift/engine.ts`, the file currently ends with the existing `buildDriftReport` function. Leave that function completely unchanged, and append this new function after it:

```ts
export function buildMultiContractDriftReport(input: {
  contracts: ApprovedContract[];
  files: ChangedFile[];
  repoState: RepoState;
  repoMode: RepoMode;
  extraHighRiskPatterns?: string[];
  projectTypes?: ProjectType[];
  checkedAt: string;
}): DriftReport {
  const violations: DriftViolation[] = [];

  for (const file of input.files) {
    const classifications = input.contracts.map((contract) => classifyPath(file, contract.scope));
    const classification = classifications.includes("planned")
      ? "planned"
      : classifications.includes("forbidden")
        ? "forbidden"
        : "outside";
    if (classification === "forbidden") {
      violations.push({
        type: "forbidden_path",
        path: file.path,
        message: `forbidden path changed: ${file.path} - revert it, or explicitly approve a new contract`,
      });
    }
    if (classification === "outside") {
      violations.push({
        type: "outside_scope",
        path: file.path,
        message: `changed outside approved scope: ${file.path} - revert it, or extend the approved scope`,
      });
    }
  }

  violations.push(
    ...highRiskViolations(input.files, input.extraHighRiskPatterns ?? []),
  );

  const missingTestsTypesSeen = new Set<string>();
  for (const contract of input.contracts) {
    const missingTests = missingTestsViolation(
      input.files,
      contract,
      input.projectTypes ?? ["generic"],
    );
    if (missingTests !== null && !missingTestsTypesSeen.has(missingTests.type)) {
      missingTestsTypesSeen.add(missingTests.type);
      violations.push(missingTests);
    }
  }

  if (input.repoState.kind !== "clean") {
    violations.push({
      type: "repo_state",
      path: null,
      message: `repository is in ${input.repoState.kind} state - finish or abort it before drift checks`,
    });
  }
  if (input.repoMode === "degraded") {
    violations.push({
      type: "repo_mode",
      path: null,
      message:
        "repository has too many changed files; ScopeLock used degraded checks",
    });
  }

  const contractIds = input.contracts.map((contract) => contract.id);

  return {
    schemaVersion: DRIFT_REPORT_SCHEMA_VERSION,
    contractId: contractIds[0],
    contractIds,
    checkedAt: input.checkedAt,
    repoMode: input.repoMode,
    repoState: input.repoState,
    changedFiles: input.files,
    violations,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @scopelock/core build && node --test packages/core/dist/drift.test.js --test-name-pattern "multi-contract drift"`
Expected: PASS (all 5 new tests).

- [ ] **Step 6: Run the full core test suite**

Run: `pnpm --filter @scopelock/core build && node --test 'packages/core/dist/**/*.test.js'`
Expected: PASS, same or greater test count than before this task, zero existing assertion changes needed.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schemas/drift.ts packages/core/src/drift/engine.ts packages/core/src/drift.test.ts
git commit -m "feat(core): add multi-contract drift report builder"
```

---

### Task 2: `checkDriftCommand`'s `contractIds` option + `CONTRACT_BASELINE_MISMATCH`

**Files:**
- Modify: `packages/cli/src/commands/check-drift.ts` (full file)
- Test: `packages/cli/src/cli.test.ts` (new `describe("check-drift", ...)` block)

**Interfaces:**
- Consumes: `buildMultiContractDriftReport` from Task 1 (`@scopelock/core`), the existing `loadContract`, `verifyApprovalSeal`, `collectChangedFiles`, `commitExists`, `driftReportFileName`, `writeJsonAtomic`, `scopelockConfigSchema`, `scopelockPaths`, `getActiveContractId` (all unchanged, all already imported in this file).
- Produces: `checkDriftCommand(options: { base?: string; contractIds?: string[] } = {}, cwd?: string): Promise<CommandResult>` — the new `contractIds` field is what Task 3's `run-plan.ts` wiring passes.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/src/cli.test.ts`, add `checkDriftCommand` to the existing import list. Find:

```ts
import { taskFinishCommand } from "./commands/task-finish.js";
```

Add right after it:

```ts
import { taskFinishCommand } from "./commands/task-finish.js";
import { checkDriftCommand } from "./commands/check-drift.js";
```

`CliError` is needed for the second test's `instanceof` check. It lives in `./run.js`, not `@scopelock/core`. Add a new import line right after the `"./commands/check-drift.js"` import you just added:

```ts
import { CliError } from "./run.js";
```

Add a new top-level `describe` block. Place it immediately after the `describe("run", ...)` block's closing `});` (the block ends with the `it("renders escaped drift evidence without fabricating run fields", ...)` test — find its closing `});` followed by a blank line, then insert this new block there):

```ts
describe("check-drift", () => {
  async function writeContract(
    dir: string,
    file: string,
    id: string,
    planned: string[],
    forbidden: string[] = [],
  ): Promise<void> {
    const res = runCli(dir, [
      "contract", "new", "--task", id, "--id", id,
      ...planned.flatMap((glob) => ["--planned", glob]),
      ...forbidden.flatMap((glob) => ["--forbidden", glob]),
      "--out", file,
    ]);
    assert.equal(res.status, 0, res.stderr);
    const approved = runCli(dir, ["approve", file]);
    assert.equal(approved.status, 0, approved.stdout || approved.stderr);
  }

  it("classifies a file as planned when any contract claims it, even if another forbids it", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a/**"]);
      await writeContract(dir, join(dir, "b.json"), "b", ["b/**"], ["a/**"]);
      await mkdir(join(dir, "a"), { recursive: true });
      await writeFile(join(dir, "a", "file.ts"), "content");
      const result = await checkDriftCommand({ contractIds: ["a", "b"] }, dir);
      assert.equal(result.exitCode, 0, result.human ?? "");
      const report = (result.data as { report: { violations: unknown[] } }).report;
      assert.deepEqual(report.violations, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws CONTRACT_BASELINE_MISMATCH when contracts do not share a baseline", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a/**"]);
      commitFixture(dir, "advance baseline before approving b");
      await writeContract(dir, join(dir, "b.json"), "b", ["b/**"]);
      await assert.rejects(
        checkDriftCommand({ contractIds: ["a", "b"] }, dir),
        (error: unknown) =>
          error instanceof CliError
          && error.code === "CONTRACT_BASELINE_MISMATCH"
          && /rebaseline/.test(error.message)
          && error.message.includes("a:")
          && error.message.includes("b:"),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the single active contract when contractIds is omitted", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a/**"]);
      const result = await checkDriftCommand({}, dir);
      assert.equal(result.exitCode, 0, result.human ?? "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "check-drift"`
Expected: FAIL — `checkDriftCommand` doesn't accept `contractIds` yet (TypeScript build error) and `CliError` code `CONTRACT_BASELINE_MISMATCH` doesn't exist.

- [ ] **Step 3: Implement the `contractIds` option**

Replace the full contents of `packages/cli/src/commands/check-drift.ts` with:

```ts
import {
  buildDriftReport,
  buildMultiContractDriftReport,
  collectChangedFiles,
  commitExists,
  driftReportFileName,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  scopelockConfigSchema,
  scopelockPaths,
  writeJsonAtomic,
  verifyApprovalSeal,
  type ApprovedContract,
} from "@scopelock/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

async function loadConfig(paths: ReturnType<typeof scopelockPaths>) {
  try {
    const raw = await readFile(paths.configPath, "utf8");
    return scopelockConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return scopelockConfigSchema.parse({ schemaVersion: 1 });
    }
    throw error;
  }
}

function humanReport(contractIds: string[], reportPath: string, report: {
  violations: { type: string; message: string }[];
}) {
  const byType = new Map<string, string[]>();
  for (const violation of report.violations) {
    byType.set(violation.type, [
      ...(byType.get(violation.type) ?? []),
      violation.message,
    ]);
  }
  const violations = [...byType.entries()]
    .map(
      ([type, messages]) =>
        `${type}\n${messages.map((m) => `  - ${m}`).join("\n")}`,
    )
    .join("\n");
  const clean = report.violations.length === 0;
  return renderSections([
    {
      title: "Context",
      lines: contractIds.length > 1
        ? `Task boundaries  ${contractIds.join(", ")}`
        : `Task boundary  ${contractIds[0]}`,
    },
    { title: "Checks", lines: clean ? "No drift detected" : violations },
    {
      title: "Result",
      lines: [
        clean ? "Cleared" : `Attention required: ${report.violations.length} violation${report.violations.length === 1 ? "" : "s"}`,
        `Drift report  ${reportPath}`,
      ],
    },
    {
      title: "Next",
      lines: clean
        ? "Review and commit the accepted changes"
        : "Review the report and revert or approve the unexpected changes",
    },
  ]);
}

async function checkDriftMultiContract(
  root: string,
  paths: ReturnType<typeof scopelockPaths>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  contractIds: string[],
  base: string | undefined,
): Promise<CommandResult> {
  const contracts: ApprovedContract[] = [];
  for (const id of contractIds) {
    const contract = await loadContract(paths, id);
    const seal = await verifyApprovalSeal(root, contract);
    if (!seal.ok) {
      throw new CliError("APPROVAL_INTEGRITY_ERROR", seal.detail);
    }
    contracts.push(contract);
  }

  const baselineShas = new Set(contracts.map((contract) => contract.baseline?.headSha ?? null));
  if (baselineShas.size > 1) {
    const pairs = contracts
      .map((contract) => `${contract.id}: ${contract.baseline?.headSha ?? "none"}`)
      .join(", ");
    throw new CliError(
      "CONTRACT_BASELINE_MISMATCH",
      `contracts do not share a baseline (${pairs}); run \`scopelock contract rebaseline\` to re-anchor them to the same commit`,
    );
  }
  const baselineSha = base ?? contracts[0].baseline?.headSha ?? null;
  if (baselineSha === null) {
    throw new CliError(
      "NO_BASELINE",
      "active contracts have no baseline; approve them with `scopelock contract approve <file>`",
    );
  }

  if (!commitExists(root, baselineSha)) {
    throw new CliError(
      "BASELINE_NOT_FOUND",
      `baseline commit ${baselineSha} not found (history rewritten?); run \`scopelock contract rebaseline\` to re-anchor it to the current commit`,
    );
  }

  const collected = await collectChangedFiles(root, baselineSha, {
    degradedThreshold: config.degradedFileThreshold,
  });
  const checkedAt = new Date().toISOString();
  const report = buildMultiContractDriftReport({
    contracts,
    files: collected.files,
    repoState: collected.repoState,
    repoMode: collected.repoMode,
    projectTypes: config.projectTypes,
    checkedAt,
  });
  const reportPath = join(paths.reportsDir, driftReportFileName(checkedAt));
  await writeJsonAtomic(reportPath, report);

  return {
    data: { reportPath, report },
    human: humanReport(report.contractIds ?? [report.contractId], reportPath, report),
    exitCode: report.violations.length > 0 ? 1 : 0,
  };
}

export async function checkDriftCommand(options: {
  base?: string;
  contractIds?: string[];
} = {}, cwd: string = process.cwd()): Promise<CommandResult> {
  const root = findRepoRoot(cwd);
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "check-drift must run inside a git repository",
    );
  }

  const paths = scopelockPaths(root);
  const config = await loadConfig(paths);

  if (options.contractIds !== undefined && options.contractIds.length > 0) {
    return checkDriftMultiContract(root, paths, config, options.contractIds, options.base);
  }

  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError(
      "NO_ACTIVE_CONTRACT",
      "no active approved contract; approve one with `scopelock contract approve <file>`",
    );
  }

  const contract = await loadContract(paths, activeId);
  const seal = await verifyApprovalSeal(root, contract);
  if (!seal.ok) {
    throw new CliError("APPROVAL_INTEGRITY_ERROR", seal.detail);
  }
  const baselineSha = options.base ?? contract.baseline?.headSha ?? null;
  if (baselineSha === null) {
    throw new CliError(
      "NO_BASELINE",
      "active contract has no baseline; approve it with `scopelock contract approve <file>`",
    );
  }

  // Catch a stale baseline (e.g. the commit was dropped by a history rewrite)
  // here, with an actionable message, instead of letting `git diff` fail with
  // a raw fatal that would surface as an opaque UNEXPECTED error.
  if (!commitExists(root, baselineSha)) {
    throw new CliError(
      "BASELINE_NOT_FOUND",
      `baseline commit ${baselineSha} not found (history rewritten?); run \`scopelock contract rebaseline\` to re-anchor it to the current commit`,
    );
  }

  const collected = await collectChangedFiles(root, baselineSha, {
    degradedThreshold: config.degradedFileThreshold,
  });
  const checkedAt = new Date().toISOString();
  const report = buildDriftReport({
    contract,
    files: collected.files,
    repoState: collected.repoState,
    repoMode: collected.repoMode,
    projectTypes: config.projectTypes,
    checkedAt,
  });
  const reportPath = join(paths.reportsDir, driftReportFileName(checkedAt));
  await writeJsonAtomic(reportPath, report);

  return {
    data: { reportPath, report },
    human: humanReport([activeId], reportPath, report),
    exitCode: report.violations.length > 0 ? 1 : 0,
  };
}
```

Note this is a full-file replacement: the single-contract path (from `const activeId = await getActiveContractId(paths);` to the end) is byte-for-byte the same logic as before this task, with only `humanReport(activeId, ...)` changed to `humanReport([activeId], ...)` to match the new array-typed `humanReport` signature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "check-drift"`
Expected: PASS (all 3 new tests).

- [ ] **Step 5: Run the full CLI test suite**

Run: `pnpm --filter @scopelock/cli build && node --test 'packages/cli/dist/**/*.test.js'`
Expected: PASS, same or greater test count than before this task. In particular, every existing test that calls `checkDriftCommand` with no `contractIds` (directly or via `taskFinishCommand`/`run --isolate`) must pass unmodified — this is the regression guard proving the default path is untouched.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/check-drift.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): add contractIds option to check-drift for multi-contract runs"
```

---

### Task 3: Wire `run-plan.ts` + `report.ts` display fallback

**Files:**
- Modify: `packages/cli/src/commands/run-plan.ts:1619-1626` (the drift-check block)
- Modify: `packages/cli/src/commands/report.ts:82-118` (`renderDriftHtml`)
- Test: `packages/cli/src/cli.test.ts` (extend the `describe("run", ...)` block with one new test; add one new test to the `describe("check-drift", ...)` block from Task 2 for the HTML fallback — actually the HTML fallback test belongs with `report.ts`, so add it as a new test inside the existing `describe("run", ...)` block near the other `report` tests, following the exact pattern of the existing `"renders escaped drift evidence without fabricating run fields"` test)

**Interfaces:**
- Consumes: `checkDriftCommand`'s new `contractIds` option (Task 2), `taskContracts: Map<string, ApprovedContract>` (already defined in `run-plan.ts`, unchanged by this task).
- Produces: no new exports — this task only wires existing pieces together.

- [ ] **Step 1: Write the failing tests**

**1a. Run-level regression test.** In `packages/cli/src/cli.test.ts`, inside `describe("run", ...)`, find the existing test `"isolates tasks, carries accepted output to later waves, and promotes once"`. Immediately after it (before the next `it(...)`), add a new test:

```ts
  it("checks drift against every task's own contract, not just the last-approved one", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "writer.json"), "writer", ["shared.txt"]);
      await writeContract(dir, join(dir, "reader.json"), "reader", ["observed.txt"], ["shared.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-multi-contract-drift",
          execution: isolatedExecution(),
          tasks: [
            {
              id: "writer",
              contract: "writer.json",
              expectsChanges: true,
              command: [process.execPath, "-e", "require('node:fs').writeFileSync('shared.txt','wave-one')"],
            },
            {
              id: "reader",
              contract: "reader.json",
              expectsChanges: true,
              command: [
                process.execPath,
                "-e",
                "const f=require('node:fs');f.writeFileSync('observed.txt',f.readFileSync('shared.txt','utf8'))",
              ],
            },
          ],
        }),
      );
      commitFixture(dir, "isolated multi-contract drift fixture");

      const receiptPath = join(dir, ".scopelock", "reports", "isolated-drift.json");
      const result = runCli(dir, [
        "--json",
        "run",
        "--yes",
        "--isolate",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.drift.status, "ok");
      const violations = receipt.drift.data.report.violations as { type: string; path: string | null }[];
      assert.deepEqual(
        violations.filter((v) => v.type === "outside_scope"),
        [],
      );
      assert.deepEqual(receipt.drift.data.report.contractIds.slice().sort(), ["reader", "writer"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

Note: unlike the existing test it follows, this one omits `--no-check-drift` deliberately — the whole point is to exercise the drift check.

**1b. `report.ts` HTML fallback test.** In the same file, inside `describe("run", ...)`, find the existing test `"renders escaped drift evidence without fabricating run fields"` (it constructs a raw `drift.json` fixture and runs `scopelock report`). Immediately after it, before the closing `});` of the `describe("run", ...)` block, add:

```ts
  it("shows every checked contract id in the drift HTML heading when contractIds is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-drift-multi-report-"));
    try {
      const driftPath = join(dir, "drift.json");
      const reportPath = join(dir, "drift.html");
      await writeFile(driftPath, JSON.stringify({
        schemaVersion: 1,
        contractId: "writer",
        contractIds: ["writer", "reader"],
        checkedAt: "2026-07-21T00:00:00.000Z",
        repoMode: "normal",
        repoState: { kind: "clean" },
        changedFiles: [],
        violations: [],
      }));

      const result = runCli(dir, ["--json", "report", driftPath, "--out", reportPath]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const html = await readFile(reportPath, "utf8");
      assert.match(html, /writer, reader/);
      assert.doesNotMatch(html, /<title>ScopeLock Drift Report - writer<\/title>/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "checks drift against every task|shows every checked contract id"`
Expected: FAIL. The first test fails because `run-plan.ts` still calls `checkDriftCommand({})` with no `contractIds`, so `receipt.drift.data.report.contractIds` is `undefined` (the single-active-contract path never sets it) and the writer task's own file may be reported as `outside_scope` depending on which contract is active. The second test fails because `report.ts` still renders `report.contractId` (`"writer"`) alone in the heading, not the joined `contractIds`.

- [ ] **Step 3: Wire `run-plan.ts`**

In `packages/cli/src/commands/run-plan.ts`, find:

```ts
  let drift: { status: "ok" | "violations" | "error"; data?: unknown; error?: string } | null = null;
  if (options.checkDrift !== false) {
    try {
      const result = await checkDriftCommand({});
      drift = { status: result.exitCode === 0 ? "ok" : "violations", data: result.data };
    } catch (error) {
      drift = { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }
```

Replace with:

```ts
  let drift: { status: "ok" | "violations" | "error"; data?: unknown; error?: string } | null = null;
  if (options.checkDrift !== false) {
    try {
      const result = await checkDriftCommand({
        contractIds: Array.from(taskContracts.values()).map((contract) => contract.id),
      });
      drift = { status: result.exitCode === 0 ? "ok" : "violations", data: result.data };
    } catch (error) {
      drift = { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }
```

- [ ] **Step 4: Wire `report.ts`**

In `packages/cli/src/commands/report.ts`, find:

```ts
function renderDriftHtml(report: DriftReport, reportPath: string): string {
  const clean = report.violations.length === 0;
  const raw = JSON.stringify(report, null, 2);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScopeLock Drift Report - ${escapeHtml(report.contractId)}</title>
```

Replace with:

```ts
function renderDriftHtml(report: DriftReport, reportPath: string): string {
  const clean = report.violations.length === 0;
  const raw = JSON.stringify(report, null, 2);
  const contractLabel = report.contractIds !== undefined && report.contractIds.length > 0
    ? report.contractIds.join(", ")
    : report.contractId;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScopeLock Drift Report - ${escapeHtml(contractLabel)}</title>
```

Then find (a few lines further down in the same function):

```ts
    <h1>${escapeHtml(report.contractId)}: <span class="${clean ? "good" : "warn"}">${clean ? "Cleared" : "Attention"}</span></h1>
```

Replace with:

```ts
    <h1>${escapeHtml(contractLabel)}: <span class="${clean ? "good" : "warn"}">${clean ? "Cleared" : "Attention"}</span></h1>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "checks drift against every task|shows every checked contract id"`
Expected: PASS.

- [ ] **Step 6: Run the full CLI test suite and the repo-wide gate**

```bash
cd "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
node --test 'packages/cli/dist/**/*.test.js'
pnpm typecheck && pnpm build && pnpm test
```

Expected: all pass, matching (or exceeding, from the new tests) the pre-task test count. In particular, every existing `run --isolate` test that does NOT pass `--no-check-drift` must still pass unmodified — this proves single-task `run` behavior is unchanged in substance even though it now goes through `checkDriftCommand`'s multi-contract path with a one-element `contractIds` array.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/run-plan.ts packages/cli/src/commands/report.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): check drift against every task's contract in a run"
```

---

## Final Verification (after Task 3)

- `pnpm typecheck && pnpm build && pnpm test` green.
- `node packages/cli/dist/index.js check-drift` (no flags) clean under this plan's own ScopeLock contract — proves the single-contract default path still works for ScopeLock's own dogfooding workflow.
- `git diff --check` clean (no trailing whitespace).
- Manually inspect one full `run --isolate` receipt with two disjoint-scope tasks (or reuse the Task 3 test fixture) to visually confirm `receipt.drift.data.report.contractIds` lists every task's contract id and reports zero false-positive `outside_scope` violations, reproducing the fix for Task #0081's original pilot finding.
