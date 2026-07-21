# Multi-contract-aware top-level `check-drift`

## Problem

`check-drift` (`packages/cli/src/commands/check-drift.ts`) is hard-wired to
a single active contract: it calls `getActiveContractId(paths)` (a single
JSON pointer file at `paths.activePath`, set by `contract approve`) and
builds a `DriftReport` against that one contract's scope
(`buildDriftReport`, `packages/core/src/drift/engine.ts`).

`run`'s isolated multi-task pipeline (`packages/cli/src/commands/
run-plan.ts`) already loads every task's own approved contract into
`taskContracts: Map<string, ApprovedContract>` (line ~1507) before
executing, but its final drift-check call (`checkDriftCommand({})`, line
~1622) ignores that map entirely and re-reads whichever single contract
happens to be "active" on disk at that moment (per `contract approve`'s
auto-activation of the last-approved contract). For a multi-task run, every
file legitimately claimed by any task *other* than the currently-active one
gets reported as a false-positive `outside_scope` violation.

This was documented as a known gap during Task #0081's real multi-agent
pilot (`memory-bank/plans/post-paramount-evidence-hardening-task10-
multi-agent-2026-07-20.md`): 6 `outside_scope` violations reported at the
`run`-level drift step, none of them real containment failures — the
per-task `prepareScopedPatch` check (the actual containment gate) showed
zero unapproved paths from any task. The finding is honest noise, not a
security failure, but it makes `run`'s final drift receipt unusable as a
top-line signal for multi-task plans.

## Goals

- `run`'s end-of-run drift check reports true findings only: a file is a
  violation only if it falls outside *every* task's approved scope, not
  just the one contract that happens to be "active" when `run` finishes.
- Zero behavior change for the existing single-contract paths: standalone
  `scopelock check-drift` (no flags) and `task finish` (which calls
  `checkDriftCommand` internally) are unaffected — same code path, same
  output, same schema shape as today.
- Never silently guess when contracts disagree on their approval baseline;
  fail with an actionable, specific error instead.

## Non-goals

- No new CLI flags on standalone `scopelock check-drift` (e.g. `--contract
  <id>` or `--plan <path>`). This fix is scoped to `run`'s own internal
  final drift check, which already has the full task-contract set loaded.
  A user-facing multi-contract flag for ad-hoc standalone use is explicitly
  out of scope — can be revisited later if real usage demands it.
- No change to `task-finish.ts`, which remains single-active-contract only
  (that command's model — one task in flight, reviewed and finished before
  starting the next — has no multi-contract concept to begin with).
- No change to `highRiskViolations` or `repo_state`/`repo_mode` violation
  detection — these are already global (not scoped to any one contract's
  patterns) and were not part of the reported gap.
- No change to `prepareScopedPatch`'s per-task containment check (already
  correct per Task #0081's pilot evidence — this fix addresses only the
  informational top-level receipt, not enforcement).

## Design

### `buildMultiContractDriftReport` (new, `packages/core/src/drift/engine.ts`)

A new function, separate from the existing `buildDriftReport` (which stays
untouched — zero risk to its existing single-contract callers):

```ts
export function buildMultiContractDriftReport(input: {
  contracts: ApprovedContract[];
  files: ChangedFile[];
  repoState: RepoState;
  repoMode: RepoMode;
  extraHighRiskPatterns?: string[];
  projectTypes?: ProjectType[];
  checkedAt: string;
}): DriftReport
```

**Scope classification (the actual fix):** for each changed file, classify
it against *every* contract in `input.contracts` using the existing
`classifyPath(file, contract.scope)`, then reduce the per-contract
classifications with this precedence: `planned` if any contract classifies
it `planned` (some task legitimately owns this file — not a violation,
even if another contract's `forbiddenPathPatterns` would also match it);
else `forbidden` if any contract classifies it `forbidden`; else
`outside`. This makes disjoint per-task contracts (task A forbids task B's
paths and vice versa, by design) resolve correctly — a file owned by A's
planned scope is never flagged just because B's contract forbids it.

**Missing-tests:** run `missingTestsViolation(files, contract,
projectTypes)` once per contract that declares `tests.length > 0`, collect
the non-null results, and de-duplicate by violation `type` (all
`missing_tests` violations carry the same fixed message today, so this
collapses to at most one entry in the merged report — no new message
format needed).

**High-risk / repo-state / repo-mode:** unchanged — call the same
`highRiskViolations`/repo-state/repo-mode logic used by `buildDriftReport`
once, globally, exactly as today.

**Output:** `DriftReport.contractId` is set to the first contract's id (by
the order `input.contracts` was given) for backward compatibility with
existing single-id consumers. A new optional field `contractIds?:
string[]` is added to the `driftReportSchema` (additive; `undefined` when
absent, matching every existing single-contract report byte-for-byte) and
populated with every contract id in `buildMultiContractDriftReport`'s
output.

### `checkDriftCommand` (`packages/cli/src/commands/check-drift.ts`)

New optional option: `contractIds?: string[]`.

- **When absent (default):** behavior is unchanged, byte-for-byte — same
  single active-contract path as today (`getActiveContractId`,
  `buildDriftReport`). This is what standalone `scopelock check-drift` and
  `task-finish.ts` continue to use.
- **When present and non-empty:** load every named contract via
  `loadContract`, verify approval seals on each (same
  `verifyApprovalSeal` check already run for the single-contract path),
  then require every contract's `baseline.headSha` to be identical. If any
  diverge, throw `CliError("CONTRACT_BASELINE_MISMATCH", ...)` with a
  message listing each divergent `contractId: headSha` pair and pointing
  at `scopelock contract rebaseline`. If they agree, use that shared
  baseline sha (exactly the same `collectChangedFiles(root, baselineSha,
  ...)` call as today, just with one shared sha instead of the single
  contract's own) and call `buildMultiContractDriftReport` with all loaded
  contracts.

The human-readable renderer (`humanReport` in `check-drift.ts`) is updated
to display every checked contract id in its "Context" line (joined, e.g.
`Task boundaries  a, b, c`) when `contractIds` is present, falling back to
today's single `Task boundary  <id>` line otherwise.

### `run-plan.ts` wiring

The single call site at line ~1622 changes from:

```ts
const result = await checkDriftCommand({});
```

to:

```ts
const result = await checkDriftCommand({
  contractIds: Array.from(taskContracts.values()).map((contract) => contract.id),
});
```

`taskContracts` is already fully populated by this point in the function
(loaded once per task earlier in the same function, no new I/O). This
works uniformly for both single- and multi-task plans — a one-task plan
produces a one-element `contractIds` array, which trivially satisfies the
baseline-agreement check and reduces to the same classification as
`buildDriftReport` would have produced, so single-task `run` behavior is
unchanged in substance even though it now goes through the new code path.

### `report.ts` (HTML drift report)

`report.ts`'s heading (`<h1>${escapeHtml(report.contractId)}: ...`) is
updated to prefer `report.contractIds` (joined with `", "`) when present,
falling back to `report.contractId` otherwise — mirroring the same
fallback pattern as `check-drift.ts`'s human renderer.

## Error handling

- `CONTRACT_BASELINE_MISMATCH`: thrown by `checkDriftCommand` when
  `contractIds` is given and the loaded contracts' `baseline.headSha`
  values are not all identical. Message lists every `contractId: headSha`
  pair and suggests `scopelock contract rebaseline`.
- Every other existing error path (`NO_ACTIVE_CONTRACT`,
  `APPROVAL_INTEGRITY_ERROR`, `NO_BASELINE`, `BASELINE_NOT_FOUND`) is
  unchanged for the default (no `contractIds`) path. The multi-contract
  path reuses `APPROVAL_INTEGRITY_ERROR` per-contract (fails on the first
  contract whose seal doesn't verify) and `BASELINE_NOT_FOUND` if the
  shared baseline commit doesn't exist in history.

## Testing

- Unit tests for `buildMultiContractDriftReport` in the existing
  `packages/core/src/drift.test.ts` (which already covers
  `buildDriftReport`): a file planned by
  contract A but forbidden by contract B classifies as `planned`, not
  `forbidden`; a file unclaimed by any contract classifies as `outside`; a
  file forbidden by at least one contract and planned by none classifies
  as `forbidden`; two contracts both declaring `tests` with no test file
  changed produce exactly one `missing_tests` violation, not two.
- `checkDriftCommand` tests in `packages/cli/src/cli.test.ts`: passing
  `contractIds` with matching baselines succeeds and reports zero false
  positives for files split across the contracts' disjoint planned scopes;
  passing `contractIds` with a divergent baseline throws
  `CONTRACT_BASELINE_MISMATCH` with both contract ids named in the
  message; omitting `contractIds` entirely is byte-identical to today's
  existing single-contract test coverage (regression guard — no existing
  test's assertions should need to change).
- An integration-level test or manual repro reproducing Task #0081's
  original pilot scenario (two tasks with disjoint planned scopes, `run
  --isolate` with a real multi-task plan) confirming the final drift
  receipt now reports zero violations instead of N false-positive
  `outside_scope` entries.

## Verification

- `pnpm typecheck && pnpm build && pnpm test` all green, including every
  existing `check-drift`/`task-finish`/`run` test (none of their
  assertions should need to change, since the default `contractIds`-absent
  path is untouched).
- `node packages/cli/dist/index.js check-drift` (no flags) clean under
  this task's own ScopeLock contract — proves the single-contract default
  path still works correctly for ScopeLock's own dogfooding workflow.
- Manually re-run (or reconstruct) Task #0081's Task 10 multi-agent pilot
  scenario and confirm the run-level drift receipt no longer reports the 6
  false-positive `outside_scope` violations.
