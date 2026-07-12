# Running agents in parallel

You've split a big task into smaller subtasks and want two or more coding
agents working at the same time, in the same repo. Left to themselves,
concurrent agents step on each other: two of them touch the same file, one's
half-finished edit corrupts the other's context, and you end up debugging a
merge conflict instead of reviewing two clean diffs.

ScopeLock's scheduler (`scopelock plan-parallel`) removes the guesswork: it
takes each subtask's approved **scope contract** (the same contract you'd
use for a single agent) and computes, deterministically and without an LLM,
which subtasks can safely run at the same time and which must wait. "Safely"
has a precise meaning here - see [Safety invariant](#safety-invariant) below.

This guide walks the whole chain end to end with a real, reproducible
4-task example. Every command and every output block below was actually run
against this repo; nothing here is pseudocode. A copy of the example lives
in [`examples/parallel/`](../examples/parallel/) if you want to reproduce it
yourself in under a minute.

## The example scenario

Four subtasks, on real paths in this repo:

| Task | Planned (write) scope | Read scope |
|---|---|---|
| `t1-core` | `packages/core/src/schedule/**` | - |
| `t2-cli` | `packages/cli/src/commands/**` | - |
| `t3-docs` | `memory-bank/**`, `README.md` | - |
| `t4-tests` | `packages/core/src/schedule.test.ts` | `packages/core/src/schedule/**` |

`t4-tests` is deliberately built to *read* what `t1-core` *writes* (it's
testing the scheduler code t1-core is changing) - that's the read-write
hazard this example is designed to demonstrate.

## Step 1 - scaffold and approve one contract per subtask

```bash
scopelock contract new --task "core scheduler tweaks" \
  --id t1-core --planned "packages/core/src/schedule/**" \
  --out t1-core.json

scopelock contract new --task "CLI command tweaks" \
  --id t2-cli --planned "packages/cli/src/commands/**" \
  --out t2-cli.json

scopelock contract new --task "docs updates" \
  --id t3-docs --planned "memory-bank/**" --planned "README.md" \
  --out t3-docs.json

scopelock contract new --task "scheduler tests (reads what t1-core writes)" \
  --id t4-tests --planned "packages/core/src/schedule.test.ts" \
  --read "packages/core/src/schedule/**" \
  --out t4-tests.json
```

`--read` is optional and only matters if you plan to use
`--include-read-hazards` later (Step 3). Then approve each one (this stamps
the current git baseline into the contract, so `check-drift` in Step 5 has
something to diff against):

```bash
scopelock approve t1-core.json --json
scopelock approve t2-cli.json --json
scopelock approve t3-docs.json --json
scopelock approve t4-tests.json --json
```

Real output for the first approve:

```json
{"status":"ok","data":{"contractId":"t1-core","baseline":{"headSha":"1d343ec2dd6b1fb9ad326431b204317d5bf407dc","branch":"main","capturedAt":"2026-07-07T23:06:09.146Z"},"active":true,"path":"/path/to/repo/.scopelock/contracts/t1-core.json"}}
```

Each `approve` (without `--no-activate`) makes its contract the single
*active* one, which matters for Step 4 below.

## Step 2 - write the plan

`plan.json` follows `schedulePlanSchema`: a flat list of `{ id, contract }`
pairs. `contract` paths resolve **relative to the current working
directory** (the same convention `approve <file>` uses), not relative to
`plan.json`'s own location:

```json
{
  "schemaVersion": 1,
  "planId": "parallel-workflow-example",
  "tasks": [
    { "id": "t1-core", "contract": ".scopelock/contracts/t1-core.json" },
    { "id": "t2-cli", "contract": ".scopelock/contracts/t2-cli.json" },
    { "id": "t3-docs", "contract": ".scopelock/contracts/t3-docs.json" },
    { "id": "t4-tests", "contract": ".scopelock/contracts/t4-tests.json" }
  ]
}
```

## Step 3 - compute the schedule

By default `plan-parallel` only looks at **write-write** conflicts (mode
F1). It ignores read scopes entirely unless you pass
`--include-read-hazards` (mode F2):

```bash
scopelock plan-parallel plan.json
```

Real output:

```
plan parallel-workflow-example
wave 1: [t1-core, t2-cli, t3-docs, t4-tests]
```

All four subtasks have disjoint *write* scopes, so F1 puts all of them in
one wave - it has no notion of `t4-tests` reading from `t1-core`'s output.
Now the same plan with read hazards turned on:

```bash
scopelock plan-parallel plan.json --include-read-hazards
```

Real output:

```
plan parallel-workflow-example
wave 1: [t1-core, t2-cli, t3-docs]
wave 2: [t4-tests]
conflicts:
  t1-core x t4-tests [read-write]: packages/core/src/schedule
```

And the `--json` form (this is what you'd script against):

```json
{"status":"ok","data":{"planId":"parallel-workflow-example","waves":[["t1-core","t2-cli","t3-docs"],["t4-tests"]],"conflicts":[{"a":"t1-core","b":"t4-tests","kind":"read-write","witness":"packages/core/src/schedule"}],"cycles":[]}}
```

### Reading the output

- **Wave**: a batch of task ids that can run at the same time. Waves run in
  order - everything in wave 1 finishes (or at least commits its writes)
  before wave 2 starts.
- **Conflict**: a pairwise reason two tasks couldn't share a wave.
  `kind` is `"write-write"` (both would write overlapping paths - a hard
  mutual-exclusion) or `"read-write"` (one writes what the other reads - an
  ordering constraint, only checked with `--include-read-hazards`).
- **Witness**: a concrete path that is claimed by both sides of the
  conflict - e.g. `packages/core/src/schedule` above is a real path that
  matches both `t1-core`'s write glob and `t4-tests`'s read glob (see
  [Safety invariant](#safety-invariant)). Witnesses are what make a conflict
  explainable instead of just "trust the scheduler."
- **`--include-read-hazards`**: opt-in. Without it, only write-write
  conflicts are considered (F1) - the read/write ordering constraint above
  simply isn't checked, and everything ends up in one wave. This is the
  right default when you don't care about read staleness (e.g. independent
  features); turn it on when a subtask's correctness depends on another's
  output already existing.
- **`cycles`**: non-empty only when `--include-read-hazards` finds a
  dependency loop that makes the plan unschedulable (Step 3b, below). Empty
  in ordinary F1 use and in any F2 plan without a deadlock.

## Step 3b - what a deadlock looks like

Two tasks that read what the other writes can never be ordered - a genuine
read-write cycle. Built the same way as above (`t5-cycle-a` writes
`src/a.ts` and reads `src/b.ts`; `t5-cycle-b` is the mirror image):

```bash
scopelock plan-parallel cycle-plan.json --include-read-hazards
```

Real output:

```
plan cycle-example
error: unschedulable (read-write deadlock) - serialize or redesign contracts:
  stuck group: [t5-cycle-a, t5-cycle-b]
conflicts:
  t5-cycle-a x t5-cycle-b [read-write]: src/a.ts
  t5-cycle-b x t5-cycle-a [read-write]: src/b.ts
```

```bash
$ echo $?
1
```

The `--json` form keeps `waves` and `cycles` under the same keys either way
(`cycles` is simply non-empty, `waves` only lists the tasks that *were*
successfully scheduled before the deadlock was found):

```json
{"status":"violations","data":{"planId":"cycle-example","waves":[],"conflicts":[{"a":"t5-cycle-a","b":"t5-cycle-b","kind":"read-write","witness":"src/a.ts"},{"a":"t5-cycle-b","b":"t5-cycle-a","kind":"read-write","witness":"src/b.ts"}],"cycles":[["t5-cycle-a","t5-cycle-b"]]}}
```

Note: a "stuck group" is everything that got swept up by the deadlock, not
necessarily only the tasks in the literal cycle - a task that merely reads
from a cycle member is equally unschedulable, since its writer never
finishes either. The `cycles` JSON key never changes shape or meaning; only
the human-readable wording distinguishes "cycle" from "unschedulable group."

**What to do about it:** the contracts as written cannot be parallelized.
Either serialize the affected tasks (run them one after another instead of
concurrently) or redesign the scopes so the mutual read dependency goes away
(e.g. extract the shared bit both tasks need into a third, earlier task -
exactly like `t4-tests` reading `t1-core`'s output above, but without the
cycle back the other way).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | a schedule was produced (`cycles` is empty) |
| `1` | unschedulable - `cycles` is non-empty; see Step 3b |
| `2` | bad input - missing/invalid plan file, missing/invalid contract file, duplicate task ids |

## Step 4 - hand each wave's tasks to their agents

`export-prompt` and `inject-contract` only ever act on the single **active**
contract (the one your last `approve` call activated, or whichever contract
you've pointed `.scopelock/active` at) - there's currently no
`--contract <id>` flag to target a specific one directly. In practice, for
each task in the wave you're about to launch, `approve` (or otherwise
activate) that task's contract right before generating its prompt:

```bash
scopelock export-prompt --target codex
```

Real output (for `t1-core`, right after approving it):

```
# ScopeLock Contract: t1-core

Target: Codex CLI

## Task
Parallel-workflow example: core scheduler tweaks

## Approved Scope
- packages/core/src/schedule/**

## Forbidden
- No explicit forbidden path patterns.

## Required Tests
- No explicit test requirement.

## Assumptions
- No recorded assumptions.

## Open Questions
- No open questions.

## Final Instruction
Stay inside the approved scope, run the required tests when relevant, and stop to ask when the change appears to require forbidden or unapproved files.
```

`inject-contract --target <id>` does the same, but writes the block into
`AGENTS.md`/`CLAUDE.md` (wrapped in `<!-- SCOPELOCK CONTRACT BEGIN/END -->`
markers) instead of printing it - useful when the target harness reads its
instructions from a file rather than stdin. Hand this contract to that
task's agent (as a prompt, or by pointing it at the injected doc file), then
move to the next task in the wave and repeat.

Wave 1 has three tasks (`t1-core`, `t2-cli`, `t3-docs`) with disjoint
scopes - by construction (Step 3), none of their agents can collide even
running fully concurrently. Only start wave 2 (`t4-tests`) once wave 1's
writes have actually landed, since `t4-tests` reads them.

For a headless Codex workflow, ScopeLock can compose each task's contract into
an explicit argv command and write a separate plan for review:

```bash
scopelock plan fill-commands plan.json --target codex --out enriched-plan.json
scopelock run --plan enriched-plan.json --yes
```

To prevent an agent's rejected workspace changes from touching the repository
you are using, run the same reviewable plan in isolated mode:

```bash
scopelock run --plan enriched-plan.json --yes --isolate --receipt receipt.json
scopelock report --open receipt.json
```

ScopeLock creates one temporary task worktree per runnable task. Accepted
patches are staged in an integration worktree at the end of each execution
step, so later tasks see earlier accepted output. Forbidden, outside-scope,
symlink, gitlink, oversized, conflicting, or failed task results are not
staged. After rechecking the original clean `HEAD`, ScopeLock applies one
aggregate patch to the user tree and records the result in receipt v5.

For Cursor, keep automatic `plan fill-commands --target cursor` disabled for
now: a composed plan could be executed later without isolation. A manually
reviewed Cursor headless argv command can be used with `run --isolate`; the
release probe verified that a mixed planned+forbidden Cursor patch is rejected
as a whole and leaves the user tree unchanged.

Existing commands are preserved unless `--force` is passed. The original plan
is not changed, and `run` still executes only the commands visible in the
enriched file.

## Step 5 - verify after the fact

For each task, `check-drift` against its own contract confirms the agent
stayed in scope. In a scratch repo, approving `t1-core` and then simulating
an agent's work:

```bash
scopelock check-drift --json
```

Clean run, no changes yet:

```json
{"status":"ok","data":{"reportPath":"...","report":{"schemaVersion":1,"contractId":"t1-core","checkedAt":"2026-07-07T23:08:02.975Z","repoMode":"normal","repoState":{"kind":"clean"},"changedFiles":[],"violations":[]}}}
```

After the agent edits a file inside its approved scope, still clean:

```json
{"status":"ok","data":{"reportPath":"...","report":{"schemaVersion":1,"contractId":"t1-core","checkedAt":"2026-07-07T23:08:03.064Z","repoMode":"normal","repoState":{"kind":"clean"},"changedFiles":[{"path":"packages/core/src/schedule/existing.ts","previousPath":null,"status":"modified","stage":"unstaged","isBinary":false,"insertions":0,"deletions":0,"sizeBytes":0}],"violations":[]}}}
```

And after it strays into `t2-cli`'s lane (`packages/cli/src/commands/**`),
`check-drift` catches it (exit `1`):

```json
{"status":"violations","data":{"reportPath":"...","report":{"schemaVersion":1,"contractId":"t1-core","checkedAt":"2026-07-07T23:08:03.153Z","repoMode":"normal","repoState":{"kind":"clean"},"changedFiles":[{"path":"packages/cli/src/commands/existing.ts","previousPath":null,"status":"modified","stage":"unstaged","isBinary":false,"insertions":0,"deletions":0,"sizeBytes":0},{"path":"packages/core/src/schedule/existing.ts","previousPath":null,"status":"modified","stage":"unstaged","isBinary":false,"insertions":0,"deletions":0,"sizeBytes":0}],"violations":[{"type":"outside_scope","path":"packages/cli/src/commands/existing.ts","message":"changed outside approved scope: packages/cli/src/commands/existing.ts - revert it, or extend the approved scope"}]}}}
```

This is the same `check-drift` you'd run for a single agent - running N of
them in parallel doesn't need a different verification step, just one
`check-drift` per task's contract.

## Safety invariant

Within a single wave, every pair of tasks is guaranteed to have
**non-intersecting write scopes** - that's the entire mechanism, not a
side effect. `plan-parallel` builds a conflict graph from pairwise glob
intersection and colors it so that no two same-colored (same-wave) tasks
share an edge; the coloring is what produces the wave partition in the
first place. This was measured directly, not just asserted, in the M4
mini-experiment (`memory-bank/plans/orchestration-m4-experiment.md`): H1
(0 write-collisions within any wave) and H4 (the kill-criterion - two
agents writing one file in the same wave - never fired) both passed on a
real scenario.

Just as important: every witness path `plan-parallel` reports is verified
against **`picomatch`** - the exact same glob matcher the runtime hook gate
(`scopelock hook gate`, wired into Claude Code's `PreToolUse` / Cursor's
`afterFileEdit`) uses to allow or deny a live edit. There's no separate
"scheduler dialect" of globs that could disagree with what actually gets
enforced at runtime - if the scheduler says two globs intersect at path X,
`hook gate` will match X against both the same way. The scheduler's
guarantee and the runtime backstop are drawing from the same ground truth.

## What this doesn't cover (yet)

- **Real multi-agent timing.** The `orchestration-m5-validation.md` H3
  measurement is a proxy (synthetic per-task delay), not actual agents. A
  live multi-agent timed run is future work.
- **Automatic invocation for every harness.** `plan fill-commands` supports
  Codex and a restricted, live-verified Claude Code profile. Cursor headless
  writes exist, but remain disabled until ScopeLock can prove scoped pre-write
  denial or validate an isolated worktree before promotion.
