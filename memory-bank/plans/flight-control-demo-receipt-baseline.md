# Flight Control one-command demo and receipt baseline

Date: 2026-07-10
Status: complete
Task: #0042

## Objective

Package the validated Flight Control scenario into one deterministic command and measure the current full receipt before any bounded-handoff changes.

This milestone deliberately did not change the production dispatcher or receipt schema.

## One-command demo

Command:

```bash
pnpm demo:flight-control
```

The command builds ScopeLock, creates two temporary fixture repositories, and runs the same six deterministic simulated-agent tasks in two modes:

1. Naive parallel execution without ScopeLock.
2. The real `scopelock run --plan` dispatcher with contracts, read hazards, write-write defer, drift, and receipt.

No model, API key, network access, or installed agent CLI is required. The demo is a deterministic product-mechanics demonstration, not evidence about LLM quality.

### Result

| Metric | Without ScopeLock | ScopeLock Flight Control |
|---|---:|---:|
| Scope violations | 2 | 0 |
| Unresolved conflicts | 2 | 0 |
| Prevented hazards | 0 | 2 |
| Failed tests | 2 | 0 |
| Accepted tasks | 4/6 | 5/6 |

Schedule:

```text
Wave 1: t1-math, t2-strings, t3-tax-8, t5-user-migration
Deferred: t4-tax-9 (write-write with t3-tax-8)
Wave 2: t6-welcome-reader (after t5 read-write dependency)
```

The demo saves `summary.json` and the production v1 receipt under `.scopelock/reports/flight-control-demo/`.

## Receipt analyzer

`benchmarks/coordination/analyze-receipt.mjs` measures serialized UTF-8 bytes by category and extracts actual Codex usage from the final `turn.completed` NDJSON event.

It reports commands/prompts, stdout, stderr, task metadata, coordination, drift, root metadata, largest task, and aggregate usage. It does not estimate tokens from characters and does not summarize or mutate data.

## Real Codex K=3 baseline

Command:

```bash
pnpm benchmark:receipt
```

Environment:

- ScopeLock git SHA: `04db4e83e8095358cb3db780786d00dda81978f7`
- macOS arm64
- Node `v26.4.0`
- Codex CLI `0.144.0-alpha.4`

### Coordination result

| Metric | K=3 average |
|---|---:|
| Scope violations | 0 |
| Unresolved conflicts | 0 |
| Prevented hazards | 2 |
| Failed tests | 0 |
| Accepted tasks | 5/6 |
| Wall-clock | 48.2s |
| Parallel factor | 2.39x |
| Receipt size | 30,306 bytes |

### Receipt composition

| Category | Average bytes | Approximate share |
|---|---:|---:|
| stdout | 17,597 | 58% |
| stderr | 5,648 | 19% |
| command/prompt | 4,079 | 13% |
| drift | 1,879 | 6% |
| task metadata | 614 | 2% |
| coordination | 283 | 1% |
| root metadata | 206 | 1% |

Receipt range: 30,000-30,830 bytes. The largest task was consistently `t6-welcome-reader` at roughly 6.3-6.7 KB.

Aggregate Codex usage across three runs:

- input tokens: 784,540;
- cached input tokens: 697,856;
- output tokens: 9,108;
- reasoning output tokens: 257.

## Architectural conclusion

The baseline confirms that receipt growth is dominated by raw process output: stdout + stderr account for roughly 77%, while coordination data is about 1%. The next spike should therefore move raw stdout/stderr to local artifacts and retain bounded evidence plus hashes in the main receipt.

Do not add LLM summarization, SQLite/FTS, a command proxy, or scheduler changes before measuring the deterministic bounded-receipt variant against this baseline.

## Verification

- `pnpm demo:flight-control` pass.
- `pnpm test` pass: core 55/55, CLI 18/18, MCP 3/3, benchmark 6/6.
- `pnpm typecheck` pass.
- `scopelock check-drift` pass with zero violations.
- Real Codex receipt baseline K=3 completed successfully.
