# M4 — scope-algebra mini-experiment (H1-H5 go/no-go)

- **Task:** #0028, contract `orchestration-m4-experiment`
- **Depends on:** `orchestration-scope-algebra.md` §5 (hypotheses + worked example),
  `orchestration-implementation-plan.md` (M1-M3 build).
- **Scope discipline:** experiment only; no product code changed. All artifacts
  live under `.scopelock/experiments/` (draft contracts + `plan.json`); this
  report is the only file added under `memory-bank/`.

---

## 1. Scenario

Four subtask contracts scaffolded with `scopelock contract new` against real
areas of this repo (not a scratch/toy repo — the actual ScopeLock tree), one
of them deliberately overlapping another:

| Task id | `plannedPathPatterns` | Intent |
|---|---|---|
| `t-core-schedule` | `packages/core/src/schedule/**` | disjoint from the other three |
| `t-cli-cmds` | `packages/cli/src/commands/**` | disjoint from `t-core-schedule`/`t-docs`, subset of `t-overlap` |
| `t-docs` | `memory-bank/**`, `README.md` | disjoint from the other three |
| `t-overlap` | `packages/cli/src/**` | **intentionally** a superset of `t-cli-cmds`'s scope |

Artifacts: `.scopelock/experiments/{t-core-schedule,t-cli-cmds,t-docs,t-overlap}.json`
(draft contracts, `baseline: null` — sufficient for `plan-parallel`, which only
reads `scope.plannedPathPatterns`/`forbiddenPathPatterns` and never touches
git baseline) + `.scopelock/experiments/plan.json`:

```json
{
  "schemaVersion": 1,
  "planId": "m4",
  "tasks": [
    { "id": "t-core-schedule", "contract": ".scopelock/experiments/t-core-schedule.json" },
    { "id": "t-cli-cmds", "contract": ".scopelock/experiments/t-cli-cmds.json" },
    { "id": "t-docs", "contract": ".scopelock/experiments/t-docs.json" },
    { "id": "t-overlap", "contract": ".scopelock/experiments/t-overlap.json" }
  ]
}
```

## 2. Actual output

Command: `node packages/cli/dist/index.js plan-parallel .scopelock/experiments/plan.json`

```
plan m4
wave 1: [t-cli-cmds, t-core-schedule, t-docs]
wave 2: [t-overlap]
conflicts:
  t-cli-cmds x t-overlap [write-write]: packages/cli/src/commands
```

`--json` (byte-identical across two separate invocations — see §4 H5):

```json
{"status":"ok","data":{"planId":"m4","waves":[["t-cli-cmds","t-core-schedule","t-docs"],["t-overlap"]],"conflicts":[{"a":"t-cli-cmds","b":"t-overlap","kind":"write-write","witness":"packages/cli/src/commands"}]}}
```

Stats: 4 tasks, 1 write-write edge, χ = 2 waves, max wave size = 3 (theoretical
max parallelism achieved in wave 1).

**Witness sanity check** (independent of the CLI, straight against the M1
matcher-consistency invariant): the reported witness
`packages/cli/src/commands` was checked directly against `picomatch` —

```
picomatch("packages/cli/src/commands/**", {dot:true})("packages/cli/src/commands") === true
picomatch("packages/cli/src/**",          {dot:true})("packages/cli/src/commands") === true
```

Both true, confirming the witness is not a scheduler-side artifact — it is a
real path that both globs actually match under the same matcher the runtime
hook gate uses.

## 3. Reasoning check (independent of the tool)

By inspection of the four glob patterns: `packages/core/src/schedule/**`,
`memory-bank/**`+`README.md`, and `packages/cli/src/commands/**` share no
path prefix with each other or with `packages/cli/src/**`... except
`t-cli-cmds` (`packages/cli/src/commands/**`), which is a strict subset of
`t-overlap`'s `packages/cli/src/**`. So exactly one conflicting pair is
expected — `t-cli-cmds`/`t-overlap` — and everything else should be free to
run together. The tool's output matches this by-hand expectation exactly.

## 4. Hypotheses — go/no-go

| Hypothesis | Metric | Result | Verdict |
|---|---|---|---|
| **H1 Safety** | write-collisions within a wave | Wave 1 = `{t-cli-cmds, t-core-schedule, t-docs}` — 0 pairwise conflicts among them (the only conflict pair, `t-cli-cmds`/`t-overlap`, spans two different waves). Wave 2 is a singleton. | **0 collisions within any wave** | **GO** |
| **H4 Soundness (kill criterion)** | any file written by two agents in the same wave | The one true overlap (`t-cli-cmds` ⊂ `t-overlap`) was correctly detected and pushed to a *different* wave, not left inside one. No occurrence of two conflicting tasks sharing a wave. | **0 occurrences** | **GO — kill criterion did not fire** |
| **H5 Determinism** | re-running the scheduler on the same plan | Two independent CLI invocations (`/tmp/m4-run1.json`, `/tmp/m4-run2.json`) diffed with `diff` — **byte-identical**, including conflict/witness order. | **byte-identical** | **GO** |
| **H3 Speedup** | wall-clock vs. sequential (reasoned, not measured — no live agents run) | Naive sequential = 4 turns. Scheduled = 2 waves, one of size 3. If per-task duration is roughly uniform, wall-clock drops from `4T` to `~2T` (wave 1 bounded by its slowest of 3 parallel tasks, wave 2 is 1 task) — a ~2x reduction, growing with task count/parallelism in wave 1. | reasoning + stats only, no live timing | **GO (qualified: not empirically timed)** |
| **H2 Enforcement** | `hook gate` denials during a wave | Not run live in this experiment (optional per protocol). Reasoning: since H1/H4 show wave-mates have provably disjoint write-scopes, a correctly configured per-task hook gate (strict mode, each agent scoped to its own contract) should see ~0 legitimate denials for in-scope work — any denial would indicate an agent straying outside its own already-disjoint lane, not a scheduler false negative. | not measured | **not tested (optional, no red flag)** |

## 5. Final verdict: **GO**

The scheduler produced the *intuitively correct* schedule by hand-inspection
(§3) and the tool's output matched exactly, including a real, picomatch-
verified witness for the one deliberate overlap. The kill criterion (H4) did
not fire: the only overlapping pair was never co-scheduled. Determinism (H5)
holds across repeated runs. H3 is directionally positive but reasoned, not
timed — acceptable per the experiment protocol, which allows a numeric/
reasoning estimate. H2 was not exercised live; nothing here contradicts it,
but it remains unverified in vivo.

**Conclusion:** scope-algebra scheduling (M1-M3) is sound and useful on a
real multi-task scenario drawn from this repo. Proceed to **M5** (read-write
F2: layered scheduling + cycle detection + `readPathPatterns` in the contract
schema + restoring the CLI's read-hazard surface, which was intentionally
removed in the M3 review fixes until the underlying data exists).

## 6. Raw artifacts

- `.scopelock/experiments/t-core-schedule.json`, `t-cli-cmds.json`,
  `t-docs.json`, `t-overlap.json` — the four draft task contracts.
- `.scopelock/experiments/plan.json` — the plan fed to `plan-parallel`.
- (Not committed: `/tmp/m4-run1.json`, `/tmp/m4-run2.json` — the two raw
  `--json` runs diffed for H5; reproducible by re-running the command above.)
