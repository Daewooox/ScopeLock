# Real-Agent Coordination Benchmark — Codex CLI K=3

Date: 2026-07-10

## Purpose

Repeat the deterministic multi-agent coordination benchmark with real agent outputs, not scripted file mutations.

This run used real `codex exec` subprocesses against temporary fixture repositories. Claude and Cursor were not available in PATH on this machine, so they were not included in this run.

## Fixture

Same shape as the deterministic benchmark:

- 6 tasks total.
- 2 independent tasks: math, strings.
- 2 write-write conflict tasks: both edit `src/pricing.mjs`.
- 2 read-write hazard tasks: user migration and welcome reader depending on `src/user.mjs`.
- 3 modes:
  - `without_scopelock`
  - `contracts_hooks`
  - `contracts_hooks_plan_parallel`

Important limitation: for Codex CLI, `contracts_hooks` is not a true pre-write hook run. In this environment ScopeLock has prompt/MCP/post-run checks for Codex, but no hard pre-write hook adapter equivalent to Claude/Cursor hook flow. Therefore the Codex result validates contract-prompt behavior plus post-run metrics, and validates `plan_parallel` scheduling, but it does not prove Codex pre-write enforcement.

## Command

```bash
node benchmarks/coordination/run-codex-real-agent-benchmark.mjs --runs 3 > /tmp/scopelock-codex-real-k3.json
```

Smoke before K=3:

```bash
node benchmarks/coordination/run-codex-real-agent-benchmark.mjs --runs 1 --modes without_scopelock
```

Cheap harness smoke test, without launching Codex:

```bash
node --test benchmarks/coordination/run-codex-real-agent-benchmark.test.mjs
```

## Availability

| Agent | Status |
|---|---|
| Codex CLI | available via `codex` |
| Claude CLI | not found in PATH |
| Cursor CLI | not found in PATH |

## K=3 Summary

| Mode | Runs | Scope violations applied avg | Unresolved conflicts avg | Detected/prevented conflicts avg | Manual interventions avg | Failed tests avg | Accepted tasks avg | Wall-clock avg |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| without_scopelock | 3 | 2 | 2 | 0 | 0 | 1 | 5/6 | 51.5s |
| contracts_hooks | 3 | 0 | 2 | 0 | 0 | 1 | 5/6 | 57.3s |
| contracts_hooks_plan_parallel | 3 | 0 | 0 | 2 | 1 | 0 | 5/6 | 74.3s |

Per-run details:

| Run | Mode | Scope violations | Unresolved conflicts | Detected/prevented | Failed tests | Accepted | Wall-clock | Deferred |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1 | without_scopelock | 2 | 2 | 0 | 1 | 5/6 | 48.5s | - |
| 1 | contracts_hooks | 0 | 1 | 0 | 1 | 5/6 | 58.5s | - |
| 1 | contracts_hooks_plan_parallel | 0 | 0 | 2 | 0 | 5/6 | 67.4s | `t4-tax-9` |
| 2 | without_scopelock | 2 | 2 | 0 | 1 | 5/6 | 56.3s | - |
| 2 | contracts_hooks | 0 | 2 | 0 | 1 | 5/6 | 53.9s | - |
| 2 | contracts_hooks_plan_parallel | 0 | 0 | 2 | 0 | 5/6 | 92.6s | `t4-tax-9` |
| 3 | without_scopelock | 2 | 2 | 0 | 1 | 5/6 | 49.8s | - |
| 3 | contracts_hooks | 0 | 2 | 0 | 1 | 5/6 | 59.6s | - |
| 3 | contracts_hooks_plan_parallel | 0 | 0 | 2 | 0 | 5/6 | 63.0s | `t4-tax-9` |

Token/cost observation from JSONL usage totals:

| Mode | Agent runs | Input tokens | Cached input tokens | Output tokens | Reasoning tokens |
|---|---:|---:|---:|---:|---:|
| without_scopelock | 18 | 1,512,138 | 1,279,232 | 22,937 | 2,561 |
| contracts_hooks | 18 | 1,447,360 | 1,286,656 | 22,521 | 2,975 |
| contracts_hooks_plan_parallel | 15 | 910,868 | 811,776 | 12,356 | 159 |

## Interpretation

The result strengthens the Flight Control thesis:

- Contracts reduced applied scope violations from 2 to 0 across all K=3 runs.
- Contracts alone did not reliably solve coordination: unresolved conflicts and failing tests remained.
- `plan_parallel` converted hidden write-write/read-write hazards into explicit scheduling decisions: 0 unresolved conflicts and 0 failed tests across K=3.
- The cost is real: wall-clock increased from ~51.5s to ~74.3s and one task was deferred for human/product decision.

The most important product nuance: ScopeLock should not claim "multi-agent speedup" as the primary value. The real value is fewer bad merges, fewer silent drifts, and explicit conflict receipts. Speed can come later from a runner, but correctness is the wedge.

## Product Implications

1. Build the next demo around **merge-readiness / conflict prevention**, not raw time.
2. Add a first-class Codex integration story:
   - MCP tools are already useful for `plan_parallel` / `check_drift`.
   - A true Codex pre-write hook story is still missing.
3. Keep the benchmark harness. It is a good regression artifact for future agent integration work.
4. For a stronger external claim, rerun with installed/authenticated Claude and Cursor CLIs or with their native hook flows.

## Next Recommended Step

Implement the smallest possible `scopelock run --plan plan.json` prototype only if it dispatches real agents under explicit waves and records receipts. Do not build a generic runner. The benchmark shows the useful surface is:

- load contracts
- compute waves/conflicts
- defer or require decision for write-write conflicts
- launch agent commands
- run `check-drift`
- record a receipt
