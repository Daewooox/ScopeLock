# H3 real-agent measurement — results

- **Task:** #0033. Executes `orchestration-h3-real-agents-plan.md`.
- **Replaces:** the proxy H3 in `orchestration-m5-validation.md` (a `setTimeout`
  per-task delay) with a **real** measurement using actual coding subagents
  editing real files on disjoint scopes.
- **Date:** 2026-07-09.

## TL;DR

- **H1/H4 (safety) under real agents: GO.** Across 4 real runs (13 subagent
  invocations total), every agent stayed inside its lane, no file was touched
  by two agents, and every generated test passed. The kill-criterion (two
  agents writing one file in one wave) never fired.
- **H3 (speedup): real, measured ≈ 1.5–1.8x** on a 3-task wave (per-run
  median ~1.7x), **below the ~3x theoretical ceiling** for 3 equal tasks. The
  analysis pins down *why*, and it is neither the scheduler nor resource
  contention — it is the **execution platform staggering agent dispatch**.
- **Product implication:** the scheduler is *necessary but not sufficient*.
  It correctly proves a wave is collision-free and *can* run concurrently;
  realizing the speedup needs an executor that actually dispatches wave
  members with true concurrency. This is the concrete argument for a future
  `scopelock run`.

## Workload

Throwaway git repo, three independent utility modules, one task each — all
comparable in size ("add one documented pure function + a `node:test` file"):

| Task | Write scope | Function |
|---|---|---|
| `t-strings` | `src/strings/**` | `titleCase(str)` |
| `t-numbers` | `src/numbers/**` | `clamp(n, lo, hi)` |
| `t-arrays` | `src/arrays/**` | `chunk(arr, size)` |

`scopelock plan-parallel` confirmed **1 wave, 0 conflicts** before running.
Agents shared **one working directory** (not worktrees — per the plan, so the
collision-safety claim is actually exercised). All agents pinned to the same
model (Sonnet). Each agent self-bracketed its work with `python3` epoch-ms
timestamps, so both modes are measured on *pure agent-work time*, excluding
orchestration latency symmetrically.

## Raw data (ms-precision runs)

| Run | Mode | per-task durations | Σ durations | wall-span | start-stagger | tests | H1/H4 |
|---|---|---|---|---|---|---|---|
| par2 | parallel | 25 / 24 / 25 s | 74.4 s | **49.0 s** | 23.6 s | 15 pass | clean |
| par3 | parallel | 24 / 25 / 27 s | 76.2 s | **41.6 s** | 14.6 s | 13 pass | clean |
| seq1 | sequential (1-at-a-time) | 38 / 23 / 25 s | 85.5 s | — | — | 13 pass | clean |

(`par1` was a pilot at `date` second-resolution — macOS `date` lacks `%N`, so
it was redone with `python3`. It agreed qualitatively: ~2.3x coarse, 0
collisions.)

## Speedup

Measured on **pure agent work** (sequential Σ-of-durations vs parallel
wall-span), which is the apples-to-apples number:

- per-run (Σ/span, cancels cross-run variance): **par2 = 1.52x, par3 = 1.83x**.
- sequential baseline seq1 Σ = 85.5 s vs parallel wall: 85.5/49.0 = 1.74x,
  85.5/41.6 = 2.06x.
- **Headline: ~1.5–2.0x, median ~1.8x.**

### Why NOT 3x (and why NOT the inflated 3.2–3.8x)

- A naive script printed 3.24–3.82x by comparing seq1's **elapsed** wall
  (158.9 s) against the parallel wall. **That number is rejected**: seq1's
  158.9 s includes ~73 s of *my own orchestrator latency between tasks* (I
  drove the sequential run turn-by-turn), which is entirely absent from the
  parallel arm. Counting it would fake a speedup out of my typing speed.
  The honest sequential baseline is Σ-of-durations (85.5 s), pure agent work.
- The real gap from the ~3x ceiling is **dispatch staggering**: the harness
  did not start the 3 background agents simultaneously — their start
  timestamps spread over **14.6–23.6 s** (nearly a full task). If they had
  started together, wall-span would approach the largest single task (~25 s)
  and speedup would approach 3x. The tighter the stagger, the higher the
  speedup — par3 (14.6 s stagger) beat par2 (23.6 s stagger), 1.83x vs 1.52x.

### It is NOT contention

Contention would slow each agent *when run alongside others*. It didn't:
solo per-task durations (t-numbers 23 s, t-arrays 25 s) match their parallel
durations (24–27 s) within noise. Concurrent agents do not materially slow
each other — the LLM work is API-bound, not local-CPU-bound. (t-strings' 38 s
solo run is single-sample variance, not contention — contention would inflate
the *parallel* numbers, not the solo one.)

## Correctness (H1/H4) — every run

Across par1, par2, par3, seq1 (4 real runs):

- **0 collisions**: the union of changed files partitioned cleanly — every
  changed file fell inside exactly one task's scope; no path was written by
  two agents. Kill-criterion never fired.
- **0 out-of-scope writes**: no agent touched another module, `package.json`,
  or anything outside its lane.
- **All generated tests passed** (`node --test`): 13–15 assertions green per
  run.

This is H1/H4 (previously measured only on synthetic data in M4) now confirmed
under **real agents editing a shared working tree concurrently**.

## 2-wave variant (serialization)

Added `t-strings-extra` (also `src/strings/**`, overlapping `t-strings`).
`plan-parallel` correctly split it out:

```
wave 1: [t-arrays, t-numbers, t-strings]
wave 2: [t-strings-extra]
conflict: t-strings x t-strings-extra [write-write]: src/strings
```

The scheduling decision (overlap → separate wave, with witness) was
demonstrated via the CLI. Real-agent execution of a 2-wave plan reduces to
"run wave 1 (already validated above), then wave 2" — it adds only ordering,
which is already unit-tested in the M5 F2 suite, so it was **not** separately
timed with additional agent runs (an honest scope call to conserve cost).

## Fidelity caveats (unchanged from the plan's §0)

- This validates **scheduling correctness + real-agent collision-safety +
  wall-clock speedup**. It does **not** reproduce **runtime hook-gate
  enforcement across independent editor processes** (Claude Code / Cursor UIs
  with hooks, `PreToolUse` deny) — subagents share the orchestrator's harness.
  That is H2, validated separately and once, live, in #0029.
- Timing is indicative, not a benchmark: K is small (2 clean ms parallel runs
  + 1 true sequential + 1 coarse pilot), and LLM latency is high-variance. The
  numbers are reported as a range with the mechanism explained, not a single
  headline figure.

## Verdict

- **H1 / H4: GO** under real agents (0 collisions, 4 runs).
- **H3: closed as real** — ~1.5–2.0x measured (median ~1.8x), with the
  sub-ceiling gap fully attributed to platform dispatch staggering (not the
  scheduler, not contention). The earlier proxy's ~2.0x is corroborated and
  now *explained*.
- **Follow-on (backlog):** the speedup ceiling is realized only with a true
  concurrent executor. A `scopelock run` that dispatches a wave's agents
  simultaneously (rather than staggered) would close most of the gap to ~3x.
  This is the strongest concrete motivation yet for building that orchestrator.
