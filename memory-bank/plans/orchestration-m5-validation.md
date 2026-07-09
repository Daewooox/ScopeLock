# M5 — H2/H3 validation (carried over from the M4 caveats)

- **Task:** #0029, contract `orchestration-m5-readwrite` / `orchestration-m5-readwrite-scope2`
- **Depends on:** `orchestration-m4-experiment.md` (H1/H4/H5 = GO, H2 not tested,
  H3 tested only by reasoning).
- **Scope discipline:** validation only; reuses the M4 experiment's contracts
  under `.scopelock/experiments/`. `.scopelock/active` was flipped twice to
  run live gate checks and restored to `orchestration-m5-readwrite-scope2`
  immediately after (`.scopelock/active` is gitignored working state, not
  part of any contract's scope).

---

## H2 — Enforcement (live hook gate run)

**Claim to check:** if scopes are assigned correctly, a strict `hook gate`
should produce ~0 false denials for a task's own legitimate in-scope writes.

**Method:** using two wave-1 neighbors from the M4 scenario
(`t-cli-cmds` planned `packages/cli/src/commands/**`, `t-core-schedule`
planned `packages/core/src/schedule/**`), each contract was `approve`d and
activated in turn (config mode was already `strict` in this repo), and
`scopelock hook gate` was run against a real stdin payload for both an
in-scope path and a neighbor's path:

| Active contract | Path checked | Expected | Actual |
|---|---|---|---|
| `t-cli-cmds` | `packages/cli/src/commands/foo.ts` (own scope) | allow | **allow (exit 0)** |
| `t-cli-cmds` | `packages/core/src/schedule/foo.ts` (t-core-schedule's lane) | deny | **deny (exit 2)** |
| `t-core-schedule` | `packages/core/src/schedule/foo.ts` (own scope) | allow | **allow (exit 0)** |
| `t-core-schedule` | `memory-bank/foo.md` (t-docs's lane) | deny | **deny (exit 2)** |

**Result: 0/2 false denials on legitimate in-scope writes** (both own-scope
checks allowed cleanly), and both cross-lane checks were correctly denied -
confirming enforcement works both ways: no false negatives (missed a real
mistake) and no false positives (blocked legitimate wave-mate work) in this
run. `.scopelock/active` was restored to `orchestration-m5-readwrite-scope2`
immediately afterward.

**Verdict: GO.** (Caveat, same as before: this is one live run on two tasks,
not a fuzzed/exhaustive check - consistent with the "at least one live run"
bar set in the M5 handoff, not a claim of statistical coverage.)

## H3 — Speedup (timed proxy, not theoretical)

**Claim to check:** the wave plan is faster than sequential execution on
waves with ≥2 tasks, with real wall-clock numbers instead of the purely
reasoned ~2x estimate from M4.

**Method:** a proxy workload (`setTimeout`-based fixed-cost "work" per task,
300ms) standing in for real agent execution time, run two ways over the
same 4-task M4 scenario and its actual `plan-parallel` wave assignment
(`wave 1: [t-cli-cmds, t-core-schedule, t-docs]`, `wave 2: [t-overlap]`):

- **Sequential:** all 4 tasks run one after another (`await` in a loop).
- **Wave-parallel:** each wave's tasks run concurrently (`Promise.all`),
  waves run one after another.

Three independent runs:

| Run | Sequential (ms) | Wave-parallel (ms) | Speedup |
|---|---|---|---|
| 1 | 1205 | 602 | 2.002x |
| 2 | 1206 | 602 | 2.003x |
| 3 | 1205 | 603 | 1.998x |

**Result:** consistent ~2.0x speedup, matching the theoretical estimate from
M4 almost exactly - expected, since with uniform per-task cost and a
largest-wave size of 3 out of 4 tasks, wall-clock is bounded by
`(waves) x (per-task cost)` = `2 x 300ms = 600ms` vs. `4 x 300ms = 1200ms`.

**Explicit caveat (not overselling):** this is a *proxy* measurement with
uniform, artificial per-task cost - it is not a real multi-agent run, so it
does not capture agent startup overhead, actual task-duration variance, or
contention on shared resources (CPU, API rate limits) that real concurrent
agents would hit. The core, honest claim it supports: **the speedup is
bounded by the critical path of the largest wave**, not by naive `1/N`
scaling - with 3 of 4 tasks in wave 1, the plan cannot do better than
~2x here even though 3 tasks did run in parallel, because wave 2's single
task still adds its full cost serially. A scenario with a more even task
distribution across more, smaller waves would show a smaller speedup factor
per task, and a scenario dominated by one large wave (all N tasks disjoint)
approaches `Nx`. Real timed validation with actual coding agents remains
future work, not covered by this proxy.

**Verdict: GO (as a proxy measurement)** - real-agent timing is left as a
follow-up, not a blocker for M5.

> **Update (2026-07-09, task #0033):** the real-agent measurement is now done
> - see `orchestration-h3-real-agents.md`. Real subagents editing disjoint
> scopes gave a measured **~1.5–2.0x** (median ~1.8x) on a 3-task wave,
> corroborating this proxy's ~2.0x. The sub-3x gap is now *explained*: the
> execution platform staggered agent dispatch (14.6–23.6 s spread), and it is
> **not** contention (solo ≈ parallel per-task durations) and **not** the
> scheduler (H1/H4 clean across 4 real runs, 0 collisions). Takeaway: the
> scheduler is necessary but not sufficient - a true concurrent executor
> (`scopelock run`) is needed to realize the full ceiling.

## Combined effect on the M4 table

Both caveats raised in `orchestration-m4-experiment.md` §4 are now closed:

| Hypothesis | M4 status | M5 status |
|---|---|---|
| H2 Enforcement | not tested | **GO** (live hook gate run, 0/2 false denials) |
| H3 Speedup | reasoned only | **GO** (proxy ~2.0x; real-agent ~1.5–2.0x median ~1.8x in #0033, gap = platform dispatch stagger) |
