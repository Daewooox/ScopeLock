# @scopelock/mcp

The narrow stdio MCP server for
[ScopeLock](https://github.com/Daewooox/ScopeLock). It exposes deterministic
scope conflict, scheduling, and drift-verification tools.

The package has not been published to npm yet. Until the first beta release,
build the repository and run `node packages/mcp/dist/index.js` from source.
After publication, the intended command is `npx --yes @scopelock/mcp@beta`.

The server is pinned to its startup repository and does not provide a generic
agent runtime.

MIT licensed. Requires Node.js 22 or newer.
