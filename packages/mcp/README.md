# @mindthediff/mcp

The narrow stdio MCP server for
[MindTheDiff](https://github.com/Daewooox/MindTheDiff), local flight control for AI
coding agents. It exposes deterministic scope-conflict, scheduling, and
drift-verification tools so an agent can call MindTheDiff directly instead of
shelling out to the CLI.

```bash
npx --yes @mindthediff/mcp@beta
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
    "mindthediff": {
      "command": "npx",
      "args": ["--yes", "@mindthediff/mcp@beta"]
    }
  }
}
```

Codex:

```toml
[mcp_servers.mindthediff]
command = "npx"
args = ["--yes", "@mindthediff/mcp@beta"]
```

The server is pinned to the repository where it starts and does not provide
a generic agent runtime — tool inputs cannot override `repoRoot`, and
absolute/escaping contract paths are rejected. See the
[MCP server reference](https://github.com/Daewooox/MindTheDiff/blob/main/docs/reference.md#mcp-server)
for the full tool schemas.

MIT licensed. Requires Node.js 22 or newer.
