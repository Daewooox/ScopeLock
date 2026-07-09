# Multi-Agent Coordination Benchmark

Date: 2026-07-10

## Goal

Test the ScopeLock Flight Control thesis with a small reproducible benchmark:

> Does ScopeLock reduce multi-agent chaos (scope violations, collisions, failed tests, untrusted merge readiness), not merely launch more agents?

This benchmark is intentionally deterministic. It uses scripted "agents" with known patches so we can isolate coordination mechanics from LLM variance.

## Fixture

The harness creates a temporary git repo with a tiny Node ESM project:

- `src/math.mjs`
- `src/strings.mjs`
- `src/pricing.mjs`
- `src/user.mjs`
- `tests/base.test.mjs`

Then it runs 6 scripted tasks:

| Task | Type | Intended scope |
|---|---|---|
| `t1-math` | independent | `src/math.mjs`, `tests/math-extra.test.mjs` |
| `t2-strings` | independent + outside-scope attempt | `src/strings.mjs`, `tests/strings-extra.test.mjs` |
| `t3-tax-8` | write-write conflict side A | `src/pricing.mjs`, `tests/pricing-tax-8.test.mjs` |
| `t4-tax-9` | write-write conflict side B | `src/pricing.mjs`, `tests/pricing-tax-9.test.mjs` |
| `t5-user-migration` | writer in read-write hazard | `src/user.mjs`, `tests/user-migration.test.mjs` |
| `t6-welcome-reader` | reader in read-write hazard + outside-scope attempt | `src/welcome.mjs`, `tests/welcome.test.mjs`, reads `src/user.mjs` |

The two intentional outside-scope attempts are:

- `t2-strings` tries to write `docs/telemetry.md`.
- `t6-welcome-reader` tries to write `package.json`.

## Modes

1. **without_scopelock**
   - No contracts.
   - No hooks.
   - All scripted agents run concurrently.

2. **contracts_hooks**
   - Each task gets a ScopeLock contract.
   - Strict hook preflight is run for planned and outside-scope attempts.
   - Tasks still run concurrently; no scheduling.

3. **contracts_hooks_plan_parallel**
   - Same contracts + strict hook preflight.
   - `scopelock plan-parallel --include-read-hazards` computes waves/conflicts.
   - Policy for this benchmark: write-write conflicts are treated as a human decision point; the lexically later conflicting task is deferred instead of mutating the same file.

## Result

Command:

```bash
node benchmarks/coordination/run-benchmark.mjs
```

Output table:

| Mode | Scope violations applied | Blocked attempts | Unresolved conflicts | Detected/prevented conflicts | Manual interventions | Failed tests | Accepted tasks | Wall-clock ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| without_scopelock | 2 | 0 | 2 | 0 | 0 | 1 | 4/6 | 91 |
| contracts_hooks | 0 | 2 | 2 | 0 | 2 | 1 | 4/6 | 92 |
| contracts_hooks_plan_parallel | 0 | 2 | 0 | 2 | 3 | 0 | 5/6 | 260 |

`plan_parallel` output in the third mode:

```json
{
  "waves": [
    ["t1-math", "t2-strings", "t3-tax-8", "t5-user-migration"],
    ["t4-tax-9"],
    ["t6-welcome-reader"]
  ],
  "conflicts": [
    {
      "a": "t3-tax-8",
      "b": "t4-tax-9",
      "kind": "write-write",
      "witness": "src/pricing.mjs"
    },
    {
      "a": "t5-user-migration",
      "b": "t6-welcome-reader",
      "kind": "read-write",
      "witness": "src/user.mjs"
    }
  ],
  "cycles": []
}
```

## Interpretation

### No ScopeLock

Fastest wall-clock, but dirty:

- 2 outside-scope edits landed.
- 2 unresolved coordination conflicts remained.
- tests failed.
- only 4/6 tasks were accepted.

This matches the practical multi-agent failure mode: speed is misleading when review/repair work is pushed to the human later.

### Contracts + Hooks

Useful but incomplete:

- Outside-scope edits were blocked.
- But write-write and read-write hazards still happened because hooks do not coordinate multiple task scopes.
- Tests still failed.
- accepted tasks stayed 4/6.

This validates the product architecture split: hooks are necessary guardrails, but not sufficient flight control.

### Contracts + Hooks + `plan_parallel`

Best merge-readiness:

- 0 applied scope violations.
- 0 unresolved conflicts.
- 0 failed tests.
- 5/6 tasks accepted; one write-write conflicting task was explicitly deferred.
- Wall-clock was slower in this tiny fixture because the safe plan serialized/deferred risky work.

This is the honest product thesis: ScopeLock may add coordination overhead, but it converts hidden chaos into explicit decisions and clean receipts.

## Product Signal

The result supports continuing the ScopeLock Flight Control direction, with a narrower claim:

> ScopeLock does not promise "more agents are always faster"; it promises fewer unplanned edits, fewer unresolved collisions, and more auditable merge readiness when multiple agents are used.

This is a stronger and more defensible claim than building a generic runner.

## Limitations

- Scripted agents, not real LLM agents.
- One deterministic fixture, not a statistical study.
- Manual intervention count is modeled as blocked attempts + deferred write-write conflict.
- Wall-clock is synthetic because scripted tasks include small sleeps.
- It does not yet measure real human review time.

## Next Experiment

Run the same benchmark with real agents or agent-like subprocesses:

1. Keep the same six tasks and contracts.
2. Ask Codex/Claude/Cursor agents to implement them.
3. Run K=3-5 repetitions per mode.
4. Add metrics:
   - actual merge conflicts,
   - review minutes,
   - number of repair prompts,
   - final accepted patches,
   - `check_drift` reports per task.

Go criterion for product continuation:

- ScopeLock reduces unresolved conflicts/violations by at least 50%, or
- ScopeLock materially reduces repair/review prompts, even if wall-clock is not faster.
