# Safety benchmark

ScopeLock reports two separate tracks:

- **Synthetic**: a deterministic six-task fixture. It tests the coordination
  mechanics and is repeatable, but it says nothing about LLM quality.
- **Real agent**: the same fixture driven by an installed coding-agent CLI.
  Use at least `K=5` runs per mode before comparing rates. If a harness is not
  installed or cannot be invoked, record it as `blocked`, never as a failure.

## Modes

- `without_scopelock`: baseline execution with no ScopeLock controls.
- `contracts_hooks`: per-task contracts and hook checks, without parallel-plan
  scheduling.
- `contracts_hooks_plan_parallel`: contracts, hooks, and conflict-aware waves.
- `scopelock_run`: the real dispatcher path when the agent harness supports it.

## Metrics

Each run keeps explicit denominators in `raw-runs.json`:

- `unsafePromotionRate`: unsafe changes promoted / unsafe attempts;
- `scopeViolationRate`: out-of-scope mutations accepted / out-of-scope
  attempts;
- `benignBlockRate`: safe tasks blocked / safe tasks attempted;
- `acceptedTaskRate`: accepted completed tasks / attempted tasks;
- `manualInterventions`: human decisions required before continuation;
- `runtimeOverhead`: protected wall-clock time / baseline wall-clock time.

A zero denominator is `null`, not zero. Median and p95 are reported for
wall-clock time and manual interventions. Timeout, cancellation, failed tests,
environment, agent, version, operating system, fixture and run identity stay
in the raw evidence.

## Commands

Build first, then run the deterministic benchmark with an output directory:

```bash
pnpm build
node benchmarks/coordination/run-benchmark.mjs --output-dir /tmp/scopelock-benchmark
```

The real-agent runner defaults to five runs:

```bash
node benchmarks/coordination/run-codex-real-agent-benchmark.mjs \
  --runs 5 \
  --output-dir /tmp/scopelock-real-benchmark
```

Outputs are `raw-runs.json`, `summary.json`, `summary.md`, and, for dispatcher
runs, individual receipts. Do not commit generated outputs or model logs.

## Interpretation limits

These fixtures measure the selected scenarios and the observed local harness.
They do not prove that every agent, repository, language, operating system or
attack is safe. Report theoretical prevented attacks separately from observed
real-agent outcomes, and keep benign blocks visible so protection is not
optimized by silently rejecting useful work.
