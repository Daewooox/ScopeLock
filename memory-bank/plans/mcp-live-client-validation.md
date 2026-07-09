# ScopeLock MCP Live Client Validation

Date: 2026-07-10

## Goal

Validate the narrow ScopeLock MCP server from a real agent client, not only from unit tests or a direct SDK smoke script.

## Setup

- Built server: `pnpm --filter @scopelock/mcp build`
- Registered global Codex MCP server:

```bash
/Applications/Codex.app/Contents/Resources/codex mcp add scopelock -- \
  /opt/homebrew/bin/node \
  "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents/packages/mcp/dist/index.js"
```

Codex reported:

```text
scopelock
  enabled: true
  transport: stdio
  command: /opt/homebrew/bin/node
  args: /Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents/packages/mcp/dist/index.js
```

## Live Calls

Ran `codex exec` from the ScopeLock repo with JSON events enabled. The event stream contained real `mcp_tool_call` items against server `scopelock`.

### `scopes_conflict`

Input:

```json
{
  "a": { "id": "a", "planned": ["config/**"], "forbidden": [], "read": [] },
  "b": { "id": "b", "planned": ["config/*.json"], "forbidden": [], "read": [] }
}
```

Result:

```json
{
  "conflict": true,
  "detail": {
    "a": "a",
    "b": "b",
    "kind": "write-write",
    "witness": "config/.json"
  }
}
```

### `check_drift`

Input:

```json
{
  "repoRoot": "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
}
```

Result:

```json
{
  "ok": true,
  "report": {
    "contractId": "mcp-live-client-validation-v2",
    "repoMode": "normal",
    "repoState": { "kind": "clean" },
    "changedFiles": ["memory-bank/plans/mcp-live-client-validation.md"],
    "violations": []
  }
}
```

### `plan_parallel`

Input plan:

```json
{
  "schemaVersion": 1,
  "planId": "live-mcp-plan",
  "tasks": [
    { "id": "t1-core", "contract": "examples/parallel/t1-core.json" },
    { "id": "t2-cli", "contract": "examples/parallel/t2-cli.json" },
    { "id": "t3-docs", "contract": "examples/parallel/t3-docs.json" }
  ]
}
```

Result:

```json
{
  "planId": "live-mcp-plan",
  "waves": [["t1-core", "t2-cli", "t3-docs"]],
  "conflicts": [],
  "cycles": []
}
```

## Notes

- This validates the Codex client path: config registration, stdio startup, tool discovery, argument passing, structured MCP result, and final agent answer.
- Plugin manifest warnings appeared during `codex exec`, but they came from unrelated local plugins and did not affect ScopeLock MCP calls.
- The first validation contract (`mcp-live-client-validation`) was replaced by `mcp-live-client-validation-v2` because the contract file itself must be inside planned scope for dogfooding.
- A repeated live `check_drift` call under v2 returned `ok: true`, `changedFiles.length: 1`, and `violations.length: 0`; the single changed file was this in-scope validation report.

## Verdict

GO. Step 5 live-client validation passed for all three narrow tools: `scopes_conflict`, `check_drift`, and `plan_parallel`.
