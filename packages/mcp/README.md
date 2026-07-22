# @scopelock/mcp

The narrow stdio MCP server for
[ScopeLock](https://github.com/Daewooox/ScopeLock), local flight control for AI
coding agents. It exposes deterministic scope-conflict, scheduling, and
drift-verification tools so an agent can call ScopeLock directly instead of
shelling out to the CLI.

```bash
npx --yes @scopelock/mcp@beta
```

## Tools

| Tool | What it does |
|---|---|
| `plan_parallel` | Build deterministic execution stages and conflict evidence for a multi-task plan. |
| `scopes_conflict` | Compare two task scopes and return the write-write/read-write conflict witness. |
| `check_drift` | Verify the active contract against repository drift. |

## Configuration

Claude Code / Cursor-style:

```json
{
  "mcpServers": {
    "scopelock": {
      "command": "npx",
      "args": ["--yes", "@scopelock/mcp@beta"]
    }
  }
}
```

Codex:

```toml
[mcp_servers.scopelock]
command = "npx"
args = ["--yes", "@scopelock/mcp@beta"]
```

The server is pinned to the repository where it starts and does not provide
a generic agent runtime — tool inputs cannot override `repoRoot`, and
absolute/escaping contract paths are rejected. See the
[MCP server reference](https://github.com/Daewooox/ScopeLock/blob/main/docs/reference.md#mcp-server)
for the full tool schemas.

MIT licensed. Requires Node.js 22 or newer.
