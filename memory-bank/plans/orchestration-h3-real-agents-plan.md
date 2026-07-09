# Plan: H3 real-agent measurement (parallel subagents)

- **Task:** #0033 (PENDING). Written by the SA; executable by another agent.
- **Goal:** Replace the M5 H3 *proxy* (a `setTimeout` per-task delay) with a
  **real** wall-clock comparison of sequential vs wave-parallel execution
  using actual coding agents doing actual work on disjoint scopes - and, in
  the same run, confirm H1/H4 (no within-wave file collisions) hold under
  real agents, not just in unit tests.
- **Depends on:** `orchestration-m5-validation.md` (proxy H3 it replaces),
  `orchestration-m4-experiment.md` (H1/H4/H5 on synthetic data),
  `docs/parallel-workflow.md` (the workflow being measured).

---

## 0. What this can and cannot prove (read first - sets honest scope)

The orchestrator (a Claude Code session) can spawn subagents via the Agent
tool. They are **real** agent invocations doing real LLM work and real file
edits, so this is a genuine, non-proxy measurement of:

- **scheduling correctness under real agents** (do the waves the scheduler
  produced actually keep agents off each other's files?), and
- **wall-clock speedup** of running a wave concurrently vs one-at-a-time.

It does **not** reproduce **runtime hook-gate enforcement across independent
editor processes** (Claude Code / Cursor UIs each with hooks installed,
`PreToolUse` deny). Subagents share the orchestrator's harness/host. That
fidelity gap belongs to H2, which was already validated once live in #0029.
State this caveat in the report; do not let the H3 number get read as an
H2 result.

Second honesty rail: **LLM latency is high-variance.** A single pair of runs
is not evidence. Report a distribution over K repetitions, and compare
against the theoretical bound, not a vibe.

---

## 1. Experimental design

### 1.1 Workload (the tasks agents actually do)

Build a small set of tasks on **disjoint** write-scopes so the scheduler puts
them in **one wave** (maximum parallelism - the case where speedup is
visible). Requirements:

- **3-4 tasks**, each of *comparable size/effort* (so wall-clock is
  comparable). Good shape: "add one documented helper function + its unit
  test to module X" - self-contained, similar cost, verifiable.
- Scopes **provably disjoint** - derive the waves from `scopelock
  plan-parallel`, don't eyeball them. Confirm it reports **1 wave, 0
  conflicts** before running.
- Use a **throwaway git repo or a disposable copy** of a real codebase, not
  the ScopeLock repo itself. Agents will make real edits; keep them
  contained.
- **Also prepare a 2-wave variant** (one task's scope overlapping another) as
  a secondary run, to show the scheduler correctly *serializes* under real
  agents (wave 2 only starts after wave 1 lands) - not just in the timing
  path but as a correctness demonstration.

### 1.2 Critical design choice: shared working directory, NOT worktrees

The Agent tool offers `isolation: "worktree"`. **Do not use it here.** The
whole claim under test is "real agents editing the *same* working tree
concurrently don't collide because the scheduler gave them disjoint lanes."
Isolating them in separate worktrees would trivially avoid collisions and
prove nothing. Spawn all wave members against the **same** working directory.
(A worktree-per-agent design is a *different*, later experiment about merge
strategy, not H1/H4/H3.)

### 1.3 Two execution modes, identical work, identical start

Reset the repo to the same baseline commit before each mode/run so both do
identical work from an identical starting state.

- **Sequential:** spawn task 1 (`run_in_background: false`), wait, spawn task
  2, wait, ... Measure total wall-clock around the whole sequence.
- **Wave-parallel:** spawn *all* wave-1 tasks in one turn (multiple Agent
  calls in a single response, or `run_in_background: true` then await all),
  wait for the whole wave to finish, then wave 2, etc. Measure total
  wall-clock around the batch.

### 1.4 Controls for variance

- Repeat each mode **K = 3-5** times. Report **min / median / max**, never a
  single number.
- **Identical, deterministic prompts** per task across all runs - specify the
  exact deliverable and files so agents don't wander (wander = latency
  noise). Pin the **same model** for every agent in every run.
- Same machine, no competing heavy load. Note any thermal/throttling risk.
- Record **per-task durations** too, not just totals - the parallel wall-clock
  is bounded by the *slowest* task in the wave (critical path), and per-task
  numbers let you show that.

---

## 2. Measurement harness

For each `{mode, run#}` capture a row:

| field | how |
|---|---|
| `mode` | sequential \| wave-parallel |
| `run` | 1..K |
| `wall_clock_ms` | orchestrator timestamps around the batch |
| `per_task_ms[]` | timestamp around each subagent |
| `collisions` | # files written by >1 same-wave agent (expect 0) |
| `drift_violations` | sum of `outside_scope`/`forbidden` across tasks (expect 0) |
| `outcome_equiv` | does the final changed-file set match the sequential run's? |

Timestamps: `Date.now()` (or `performance.now()`) in the orchestrator around
each spawn/await. Subagents can't reliably self-time; the orchestrator owns
the clock.

---

## 3. Correctness checks alongside timing (H1/H4 under real agents)

After **each** parallel run, before resetting:

1. **Per-task drift:** activate each task's contract and run `scopelock
   check-drift --json`; assert `0` `outside_scope`/`forbidden` violations -
   every agent stayed in its lane. (Reuse the `rebaseline` command if a reset
   invalidated a baseline.)
2. **Collision scan (H4 kill-criterion under real execution):** compute the
   union of changed files across same-wave agents; assert **no path appears
   for two agents**. One collision = H4 fired under real agents = STOP and
   report (this would falsify the safety claim in practice, not just theory).
3. **Outcome equivalence:** the set of changed files from the parallel run
   should equal the set from the sequential run (same work, different
   ordering) - proves parallelism didn't corrupt or drop work.

---

## 4. GO / NO-GO criteria

- **GO** if, across K runs: parallel **median** wall-clock is meaningfully
  below sequential (target: **> 1.5x** on a 3-task single wave), **and** 0
  collisions, **and** 0 drift violations, **and** outcome-equivalent.
- **Near-1x speedup is a real finding, not a failure to hide.** If spawn /
  tool-round-trip overhead dominates for small tasks, document it honestly:
  "parallelism pays only above a task-size threshold of ~X." That is useful
  product truth (informs when the future `scopelock run` orchestrator should
  even bother parallelizing).
- **NO-GO / escalate** if any collision or drift violation occurs - that
  contradicts H1/H4 and must be root-caused before trusting the scheduler on
  real agents.

Always frame the number against the bound: with N equal-cost tasks in one
wave, ideal speedup approaches N x; real speedup = sequential-sum /
largest-wave-critical-path, eroded by spawn + coordination overhead.

---

## 5. Deliverable

- New `plans/orchestration-h3-real-agents.md` (results) **or** replace the H3
  section of `orchestration-m5-validation.md` in place - with: the workload,
  the raw {mode, run, wall_clock, per-task} table, min/median/max, the
  collision/drift results, the GO/NO-GO verdict, and the §0 fidelity caveats
  verbatim.
- Update `orchestration-m5-validation.md` H3 row: "proxy" -> "real agents
  (median N.Nx over K runs)".

---

## 6. Execution checklist (for the agent doing it)

1. Create the throwaway repo + N comparable-size tasks; write their contracts
   (`contract new`), confirm `plan-parallel` = 1 wave / 0 conflicts.
2. Snapshot the baseline commit.
3. For run in 1..K: reset to baseline; run **sequential**; record row + run
   correctness checks.
4. For run in 1..K: reset to baseline; run **wave-parallel** (shared workdir,
   no worktrees); record row + correctness checks.
5. Do the 2-wave variant once to demonstrate correct serialization under real
   agents (a wave-2 agent must not start until wave-1 writes land).
6. Aggregate, write the report, set the verdict, update the M5 validation row.

## 7. Risks / gotchas

- **Non-deterministic agent output** inflates variance and can break
  outcome-equivalence even when nothing is wrong. Mitigate with tightly
  specified deliverables; treat "different but in-scope" edits as still a
  pass for H1/H4/H3 (the safety and timing claims don't require byte-identical
  output, only no-collision + in-scope + comparable cost).
- **A crashed/hung subagent** skews wall-clock. Use a per-task timeout; on
  timeout, discard that run and note it, don't average a hang in.
- **Reset discipline:** if you reset via `git reset --hard` + clean, make sure
  `.scopelock/` state and contract baselines survive (or `rebaseline` after).
  A stale baseline mid-experiment now fails loudly (`BASELINE_NOT_FOUND`),
  which is good - repair with `scopelock rebaseline` rather than ignoring it.
- **Don't over-claim.** This closes the "H3 was only a proxy" gap and adds a
  real-agent H1/H4 datapoint. It does **not** replace the live cross-process
  H2 enforcement result, and it is not a benchmark suite - it's an indicative,
  distribution-reported experiment.
