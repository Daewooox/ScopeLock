# Agent Environment Preflight Step 5a - Pilot Demo + Codex Hook Verify

Date: 2026-07-10
Task: #0044
Contract: `pilot-demo-codex-hook-verify`

## Summary

Step 5a turns the environment-preflight work into a demonstrable product slice:
one command shows the flight-control story end to end, and Codex hook confidence
can now be upgraded by a live harmless probe instead of static guesswork.

## Implemented

- Added `pnpm demo:pilot`.
- Added `benchmarks/coordination/run-pilot-demo.mjs`.
- Added `benchmarks/coordination/run-pilot-demo.test.mjs`.
- Added `scopelock hooks verify --target codex`.
- Added `.scopelock/hook-verifications.json` as the local verification store.
- Added Zod schemas for hook verification records/store.
- `agents preflight` now reports Codex hook confidence as `live-verified` only
  when the latest verification record matches the current `.codex/hooks.json`
  SHA-256 digest and has `result: "passed"`.

## Pilot Demo Scenario

The demo is deterministic and does not call an LLM/API:

1. create a temp git fixture;
2. create ScopeLock contracts for writer/reader/hook tasks;
3. run `scopelock run --plan` with a required missing skill;
4. verify strict environment preflight blocks dispatch;
5. add the missing skill;
6. rerun and verify safe waves: `[pilot-writer] -> [pilot-reader]`;
7. install Codex hook config in strict local mode;
8. send a synthetic Codex `apply_patch` event to `hook gate --format codex`;
9. verify forbidden path is denied;
10. write receipt v3 and a compact summary.

Command:

```bash
pnpm demo:pilot -- --output-dir .scopelock/reports/pilot-demo
```

Expected output:

```text
ScopeLock Pilot Demo
1. missing skill -> preflight block: PASS
2. fix skill -> safe waves run: PASS
   waves: [pilot-writer] -> [pilot-reader]
3. Codex apply_patch hook deny: PASS
4. receipt v3: .../.scopelock/reports/pilot-demo/receipt.json
```

## Codex Hook Verify

Command:

```bash
scopelock hooks verify --target codex
```

Options:

- `--codex-bin <path>` - override the Codex executable for test fixtures or
  non-standard installs.
- `--timeout-ms <ms>` - bound the live probe.
- `--json` - machine-readable result.

Behavior:

- requires a ScopeLock Codex hook installed in the current repo;
- runs a harmless `codex exec` apply_patch probe against `.scopelock/probes/...`;
- treats the probe as passed only if no file mutation happened and Codex output
  contains a recognizable ScopeLock denial;
- writes a verification record with target, checkedAt, hookConfigDigest, result,
  and detail;
- keeps confidence `degraded` on timeout, mutation, missing hook, or
  unrecognized output.

This does not try to statically prove Codex project trust. It proves the current
hook through live behavior and records the evidence.

## Verification

```bash
pnpm typecheck
pnpm build
pnpm -r test
pnpm exec node --test benchmarks/coordination/*.test.mjs
pnpm demo:pilot -- --output-dir .scopelock/reports/pilot-demo
node packages/cli/dist/index.js check-drift --json
git diff --check
```

Results:

- core: 79/79;
- cli: 31/31;
- mcp: 3/3;
- benchmark tests: 8/8;
- `demo:pilot`: PASS for all four steps;
- `check-drift`: 0 violations under `pilot-demo-codex-hook-verify`.

## Next Step

Create a short video demo script using `pnpm demo:pilot` as the stable backbone:

1. open with the user pain: multi-agent setup drift and unsafe writes;
2. run the demo and show strict preflight blocking a missing skill;
3. show the skill fix and safe waves;
4. show Codex hook deny / `hooks verify` as live evidence;
5. open `receipt.json` and point at environment provenance, waves, and task
   results;
6. ask the design partner to try the same flow on one real repo.

Stop condition: do not add new runtime/orchestration infrastructure until a
design partner confirms this demo addresses a real workflow.
