# Parallel-workflow example

A reproducible, 4-task example for the guide at
[`docs/parallel-workflow.md`](../../docs/parallel-workflow.md). The
contracts here are drafts (`baseline: null`, never `approve`d) scoped to
real paths in this repo, so `plan-parallel` can run against them directly -
no `scopelock init`, no git baseline, no approval step needed.

## Reproduce in one command

From this directory:

```bash
scopelock plan-parallel plan.json --include-read-hazards
```

(Not installed globally? From the repo root:
`node packages/cli/dist/index.js plan-parallel examples/parallel/plan.json --include-read-hazards`.)

Expected output:

```
plan parallel-workflow-example
wave 1: [t1-core, t2-cli, t3-docs]
wave 2: [t4-tests]
conflicts:
  t1-core x t4-tests [read-write]: packages/core/src/schedule
```

Drop `--include-read-hazards` to see the F1 (write-write only) result
instead - all four tasks land in a single wave, since none of their
*write* scopes overlap:

```
plan parallel-workflow-example
wave 1: [t1-core, t2-cli, t3-docs, t4-tests]
```

## What's here

| File | Role |
|---|---|
| `plan.json` | The `schedulePlanSchema` plan referencing the four contracts below |
| `t1-core.json` | Writes `packages/core/src/schedule/**` |
| `t2-cli.json` | Writes `packages/cli/src/commands/**` |
| `t3-docs.json` | Writes `memory-bank/**`, `README.md` |
| `t4-tests.json` | Writes `packages/core/src/schedule.test.ts`, **reads** `packages/core/src/schedule/**` (the deliberate read-write hazard with `t1-core`) |
