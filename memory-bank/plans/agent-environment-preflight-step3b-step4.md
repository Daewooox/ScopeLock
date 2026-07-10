# Agent Environment Preflight Step 3b + Step 4

Date: 2026-07-10
Task: #0044
Contract: `agent-env-codex-step3b-run-step4-v3`

## Summary

Step 3b confirmed that Codex `PreToolUse` can observe and deny native
`apply_patch` calls before mutation when project hooks are trusted or
`--dangerously-bypass-hook-trust` is used for automation.

Step 4 integrated environment attestation into the thin dispatcher receipt:
`scopelock run --plan` now checks `.scopelock/agents.json` when present, blocks
dispatch in strict mode on required preflight violations, and records bounded
environment metadata in receipt schema v3.

## Step 3b evidence

External fixture:

```text
/tmp/scopelock-codex-hook-step3b
```

Live Codex CLI:

```text
codex-cli 0.144.0-alpha.4
```

Findings:

- Invalid top-level unknown fields in `.codex/hooks.json` make Codex reject the
  whole hook config. Foreign preservation must happen inside known hook arrays,
  not arbitrary top-level metadata.
- Real `apply_patch` events contain `tool_name: "apply_patch"` and the full
  patch text in `tool_input.command`.
- Allowed `apply_patch`: 2/2 mutations applied and hook events captured.
- Denied `apply_patch`: 3/3 mutations blocked before write with
  `permissionDecision: "deny"`.
- Negative trust run without bypass: mutation applied and no hook event was
  captured.

Decision:

- **GO** for a minimal Codex hook adapter.
- Confidence remains **degraded** in static preflight because project trust has
  no reliable static indicator.

## Implemented

- Added `codexScopeLockEntry()` for `.codex/hooks.json`.
- `hooks install --target codex --local --mode strict` writes project-local
  Codex hooks and preserves foreign hook entries.
- `hook gate --format codex` emits Codex deny JSON.
- `evaluateHookGate()` extracts all changed paths from native `apply_patch`
  payloads and denies if any touched path is outside/forbidden.
- `hooks install` checks `.scopelock/config.json` before writing hook files, so
  an uninitialized repo no longer gets a partial hook write followed by
  `NOT_INITIALIZED`.
- Receipt schema is now `3`; when `.scopelock/agents.json` exists, receipts
  include manifest digest, target digests, hook confidence, violations, and
  `blockedByEnvironment`.

No rule/skill contents or raw configs are embedded.

## Verification

```bash
pnpm typecheck
pnpm build && pnpm -r test
pnpm exec node --test benchmarks/coordination/*.test.mjs
node packages/cli/dist/index.js check-drift --json
pnpm demo:flight-control -- --output-dir /tmp/scopelock-flight-control-demo-step4
```

Results:

- core: 78/78
- cli: 30/30
- mcp: 3/3
- benchmark tests: 7/7
- check-drift: 0 violations
- demo: without ScopeLock = 2 violations / 2 conflicts / 2 failed tests / 4 of
  6 accepted; ScopeLock = 0 violations / 0 conflicts / 0 failed tests / 5 of 6
  accepted.

## Product impact

This is the first demonstrable end-to-end version of the "flight-control"
story:

1. verify environment before dispatch;
2. schedule safe waves;
3. block or record unsafe agent setup;
4. enforce Codex native `apply_patch` scope when project hooks are trusted;
5. write a bounded receipt with coordination + drift + environment provenance.

Next step should be a short video demo and one design-partner pilot, not more
infrastructure.
