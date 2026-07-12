# ScopeLock reference

This page contains the detailed command and configuration notes kept out of the
main README. Run `scopelock <command> --help` for the exact options supported by
your installed version.

## Commands

| Command | What it does |
|---|---|
| `scopelock init` | Create `.scopelock/` config, contracts, and reports. |
| `scopelock doctor` | Check git, Node, config, the active contract, and hooks. |
| `scopelock contract new` | Create a schema-valid draft contract without an LLM. |
| `scopelock approve <file>` | Save a contract and capture the current git baseline. `--no-activate` saves it without making it the active contract. |
| `scopelock rebaseline [<id>]` | Move a contract baseline after a rebase, squash, or history rewrite. |
| `scopelock export-prompt --target <id>` | Print the active contract as agent instructions. |
| `scopelock inject-contract --target <id>` | Inject the contract into `AGENTS.md` or `CLAUDE.md`. |
| `scopelock hooks install --target <id>` | Add ScopeLock entries to an agent's hook config. |
| `scopelock hooks uninstall --target <id>` | Remove only ScopeLock-owned hook entries. |
| `scopelock hooks verify --target codex` | Run a harmless live hook probe without disabling sandbox protections. |
| `scopelock check-drift` | Compare repository changes with the approved contract. |
| `scopelock manifest` | Build a metadata-only manifest from tracked git files. |
| `scopelock plan-parallel <plan.json>` | Detect conflicts and build a safe task schedule. |
| `scopelock plan fill-commands <plan.json> --target <codex\|claude>` | Render task contracts into explicit, reviewable agent argv commands. |
| `scopelock agents preflight --manifest <path>` | Verify rules, skills, copies, parity, and hook capability. |
| `scopelock run --plan <plan.json>` | Dispatch an approved plan and write a bounded receipt. |
| `scopelock report <receipt> --open` | Render a standalone local HTML Flight Report. |

`--json` is available on every command for machine-readable output.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success or no drift. |
| `1` | The command completed and found policy violations. |
| `2` | Input, environment, or execution error. |

## Enforcement modes

- `warn` is the default. Violations are written to
  `.scopelock/reports/audit.ndjson` but do not block the agent.
- `strict` blocks supported out-of-scope edits. Claude Code supports pre-write
  deny. Codex deny requires a live-verified project hook. Cursor remains an
  audit integration.

## Agent environment preflight

`agents preflight` is read-only. It checks an existing workspace manifest and
never installs or changes rules, skills, or hooks.

For each selected target it can verify:

- required and optional rule or skill presence;
- physical copies instead of symlinks;
- SHA-256 parity with canonical artifacts;
- nominal, degraded, or live-verified hook confidence.

Missing optional artifacts produce a warning. Missing required artifacts,
unwanted symlinks, and parity mismatches produce a violation and exit `1`.
Each violation includes a suggested `ruler` or `skills --copy` command; ScopeLock
does not run that command automatically.

Codex hook confidence can be upgraded to `live-verified` only when an explicit
verification record matches the SHA-256 digest of the current hook config.

See [`examples/agent-workspace/`](../examples/agent-workspace/) for a
reproducible manifest and both a passing and a failing run.

## Parallel planning

By default `plan-parallel` detects write-write conflicts between task scopes.
Use `--include-read-hazards` to also order a writer before tasks that declare
the same path as a read dependency.

If the resulting read-write dependencies form a cycle, ScopeLock exits `1` and
reports the involved tasks instead of inventing an unsafe order. See
[parallel-workflow.md](parallel-workflow.md) for a complete walkthrough.

## Plan execution and receipts

`scopelock run --plan <plan.json>` is a thin dispatcher, not a generic agent
runtime. Plans containing commands require `--yes`; string shell commands also
require `--allow-shell`.

For Codex or Claude Code tasks, compose commands into a separate reviewable plan before
dispatch:

```bash
scopelock hooks install --target claude --mode strict
scopelock plan fill-commands plan.json --target claude --out enriched-plan.json
scopelock run --plan enriched-plan.json --yes
```

By default, `fill-commands` preserves tasks that already have a command. Use
`--force` to replace them. It always generates an argv array, never a shell
string. Generated Claude invocations use `dontAsk`, disable session persistence,
allow only file read/edit tools, and explicitly deny Bash. Put deterministic
test commands in separate plan tasks. The installed strict hook supplies
pre-write scope enforcement; without it, only the final drift check remains.
Cursor has a headless CLI, but automatic
write invocation remains disabled until scoped pre-write denial is proven.

Other `run` options:

- `--receipt <path>` writes the receipt to a custom path instead of the
  default under `.scopelock/reports/`.
- `--timeout-ms <ms>` bounds each task's process (default 900000 = 15 minutes).
- `--no-check-drift` skips the final `check-drift` step the receipt normally
  includes.
- `--no-read-hazards` schedules using only write-write conflicts (F1),
  ignoring each contract's `readPathPatterns` (F2).
- `--no-defer-write-conflicts` runs write-write conflicts instead of deferring
  one side to a later wave.

Receipts contain bounded, redacted previews by default. Raw redacted output is
written only when `--store-raw-output` is explicitly enabled.

Each `task.contract` path resolves from the current working directory, not from
the directory containing `plan.json`.

## Repository manifest

`scopelock manifest` uses `git ls-files` and emits paths and metadata only:
tracked files, detected project types, package managers, test paths, and risky
paths. It does not read or send source contents.

## MCP server

ScopeLock includes a narrow stdio MCP server with three tools:

| Tool | What it does |
|---|---|
| `plan_parallel` | Build deterministic stages and conflict evidence. |
| `scopes_conflict` | Compare two task scopes and return the conflict witness. |
| `check_drift` | Verify the active contract against repository drift. |

Run it from source:

```bash
pnpm --filter @scopelock/mcp build
node packages/mcp/dist/index.js
```

Claude Code and Cursor-style configuration:

```json
{
  "mcpServers": {
    "scopelock": {
      "command": "node",
      "args": ["/absolute/path/to/ScopeLock/packages/mcp/dist/index.js"]
    }
  }
}
```

Codex configuration:

```toml
[mcp_servers.scopelock]
command = "node"
args = ["/absolute/path/to/ScopeLock/packages/mcp/dist/index.js"]
```

The server is pinned to the repository where it starts. Tool inputs cannot
override `repoRoot`; absolute and escaping contract paths are rejected.

## Local hook commands

Hooks call `scopelock` from `PATH` by default. During source development,
`hooks install --local` writes an absolute Node invocation instead. That path is
machine-specific, so do not commit the local form to a shared repository.

## Local storage

```text
.scopelock/
  config.json        # shared, committed
  contracts/*.json   # shared, committed
  reports/           # local, gitignored
  active             # local pointer, gitignored
```
