# ScopeLock `run --plan` real-agent dogfood

Date: 2026-07-10  
Status: complete  
Agent: real Codex CLI  
Repeats: K=3 after one successful diagnostic run

## Objective

Validate the thin dispatcher as a Flight Control layer, end to end:

`task contracts -> conflict graph -> safe waves -> real agents -> tests/drift -> receipt`

This experiment did not evaluate a generic runner, retries, worktrees, sessions, cloud orchestration, or an LLM planner.

## Architecture under test

Two contract levels were used:

- Per-task contracts supplied write/read scopes to the scheduler.
- One active run-level contract contained the union of allowed changes and anchored the final `check-drift`.

The six-task fixture reused the existing coordination benchmark:

| Task | Purpose | Relationship |
|---|---|---|
| `t1-math` | Add multiply + test | independent |
| `t2-strings` | Add slugify + test | independent |
| `t3-tax-8` | Change shared tax rate to 8% | write-write writer A |
| `t4-tax-9` | Change the same rate to 9% | write-write writer B, deferred |
| `t5-user-migration` | Migrate user shape | read-write writer |
| `t6-welcome-reader` | Build against current user shape | read-write reader |

Dry-run and dispatcher receipt produced the same schedule in every repeat:

```text
Wave 1: t1-math, t2-strings, t3-tax-8, t5-user-migration
Wave 2: t4-tax-9 (deferred, not launched)
Wave 3: t6-welcome-reader
```

Conflict witnesses were stable:

- `t3-tax-8` vs `t4-tax-9`: write-write at `src/pricing.mjs`.
- `t5-user-migration` -> `t6-welcome-reader`: read-write at `src/user.mjs`.

## Product defect found and fixed

The first execution hung before any agent edited files. Root cause was at the dispatcher process boundary:

- Direct benchmark execution used `stdio: ["ignore", "pipe", "pipe"]`.
- `runCommand` used Node's default child stdin pipe and never closed it.
- Non-interactive commands waiting for EOF, including this Codex flow, remained alive indefinitely.

Evidence from a minimal child process:

```text
default stdin: exitCode=null, no output
ignored stdin: exitCode=0, output=eof
```

Fix: both argv and shell command paths now use ignored stdin while preserving captured stdout/stderr. A regression test waits for EOF and writes `stdin-eof.txt`; it failed with `ETIMEDOUT` before the fix and passes after it.

## K=3 results

| Run | Violations | Unresolved conflicts | Prevented hazards | Failed tests | Accepted | Wall-clock | Task time sum | Receipt duration | Parallel factor | Receipt size |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 2 | 0 | 5/6 | 74.6s | 129.0s | 73.4s | 1.76x | 29.8 KB |
| 2 | 0 | 0 | 2 | 0 | 5/6 | 49.0s | 107.4s | 47.5s | 2.26x | 31.4 KB |
| 3 | 0 | 0 | 2 | 0 | 5/6 | 50.5s | 113.2s | 48.5s | 2.34x | 29.3 KB |
| **Average** | **0** | **0** | **2** | **0** | **5/6** | **58.1s** | **116.5s** | **56.4s** | **2.12x** | **30.1 KB** |

All three repeats also had:

- `scheduleMatchesDryRun=true`;
- `driftStatus=ok`;
- the same deferred task, `t4-tax-9`;
- five agent exit codes `0` and one intentional skip;
- no runtime user intervention.

The benchmark's `manualInterventions=1` metric represents the explicit defer decision, not a person interrupting the run.

## Exit semantics

Dispatcher exit code was `1` in every repeat because one task was intentionally deferred. This is coherent with the current contract: the complete plan was not executed. Keep this behavior for now. Add an `allow deferred` mode only if real CI users need a successful status for intentionally partial plans.

## Receipt assessment

The receipt was sufficient to reconstruct:

- planned waves;
- conflict types and witnesses;
- deferred task;
- per-task exit status and duration;
- final drift result.

Known limits, not implemented in this task:

1. No per-task timeout or progress event. A truly stuck agent can hold the run indefinitely.
2. No per-task `startedAt`/`finishedAt`; concurrency is inferred from summed durations vs receipt duration.
3. Full prompts and stdout/stderr are embedded. Even this tiny run produced about 30 KB; real runs may create large or sensitive receipts.
4. A skipped task carries a generic stderr reason; its witness must be joined from the top-level conflicts array.

These are concrete hardening candidates before unattended external use, not reasons to build a daemon.

## Decision

**GO for the thin dispatcher/receipt concept.** The experiment validates ScopeLock as coordination proof, not as a generic agent runner:

- safe parallel execution worked;
- write-write conflict was prevented;
- read-write ordering was respected;
- merge-readiness evidence was machine-readable;
- average effective parallelism was 2.12x.

Do not add a Codex preset yet. The 5.4 KB plan was machine-generated, raw argv worked after the generic stdin fix, and one-vendor evidence does not justify vendor-specific product API.

Do not add retries, worktrees, sessions, daemon, GUI, cloud, leases, or an LLM planner from this result.

## Recommended next product step

Package this scenario as a one-command demo and conduct five Stage 0 interviews with developers who actively run multiple agents. Test whether they value:

- prevented collisions;
- explicit defer decisions;
- read-write ordering;
- merge-readiness receipts.

Only after those interviews choose between receipt hardening, minimal command generation, or stopping further dispatcher investment.
