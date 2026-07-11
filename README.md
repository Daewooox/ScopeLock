# ScopeLock

Local, deterministic guardrails for AI coding agents.

AI agents drift: you ask for a small change and they refactor half the repo,
touch CI, or edit auth. ScopeLock makes you approve an explicit **scope
contract** first, then enforces it - deterministically, on your machine, with
no LLM and no cloud in the loop.

- **Approve** a contract: which paths the agent may touch, which are forbidden.
- **Export** it as a prompt / inject it into `AGENTS.md` / `CLAUDE.md`.
- **Enforce** it at runtime via editor hooks (Claude Code `PreToolUse` deny,
  Cursor `afterFileEdit` audit).
- **Verify** afterwards with a git-driven drift check.

Everything is rule-based and local: the drift engine and hooks never call an
LLM or the network.

## Requirements

- Node.js >= 22
- git

## Install

```bash
npm install -g @scopelock/cli
```

Not published yet? Run from source:

```bash
git clone <repo> && cd scopelock
pnpm install && pnpm -r build
# then use `node packages/cli/dist/index.js` in place of `scopelock`,
# or `pnpm --filter @scopelock/cli link --global`
```

## 60-second quickstart

```bash
# 1. Initialize .scopelock/ in your repo
scopelock init

# 2. Scaffold a contract (deterministic, no LLM) and approve it
scopelock contract new \
  --task "Add dark mode toggle" \
  --planned "src/ui/**" \
  --forbidden "src/auth/**" \
  --test unit \
  --out darkmode.contract.json
scopelock approve darkmode.contract.json      # stamps the current git baseline

# 3. Give the contract to your agent
scopelock export-prompt --target claude       # print instructions
scopelock inject-contract --target claude      # or inject into CLAUDE.md/AGENTS.md

# 4. Enforce it live while the agent works
scopelock hooks install --target claude --mode strict --local
scopelock hooks install --target cursor --mode warn   --local

# 5. Verify after the fact
scopelock check-drift                          # exit 0 clean, 1 = violations
```

## Commands

| Command | What it does |
|---|---|
| `scopelock init` | Create `.scopelock/` (config, contracts, reports). |
| `scopelock doctor` | Check git, Node, config, active contract, hooks. |
| `scopelock contract new` | Scaffold a schema-valid draft contract (no LLM). |
| `scopelock approve <file>` | Save a contract and capture the git baseline. |
| `scopelock rebaseline [<id>]` | Re-anchor an existing contract's baseline to the current commit (repairs a stale baseline after a rebase / squash-merge / history rewrite). |
| `scopelock export-prompt --target <id>` | Print the contract as agent instructions. |
| `scopelock inject-contract --target <id>` | Inject the contract into `AGENTS.md` / `CLAUDE.md`. |
| `scopelock hooks install --target <id> [--mode warn\|strict] [--local]` | Install editor hooks. |
| `scopelock hooks uninstall --target <id>` | Remove ScopeLock's hook entries only. |
| `scopelock check-drift [--base <sha>]` | Compare actual repo changes to the contract. |
| `scopelock manifest` | Build a deterministic repo manifest from tracked git files. |
| `scopelock plan-parallel <plan.json> [--include-read-hazards]` | Derive a parallel-safe schedule (waves) from a set of task contracts. |
| `scopelock agents preflight --manifest <path> [--target <id>]` | Read-only check that each agent's declared rules/skills are physically present, not symlinks, and consistent before dispatch. |

`--json` is available on every command for machine-readable output.

`scopelock run --plan <plan.json>` is intentionally explicit: a plan with
commands requires `--yes`, and string shell commands require `--allow-shell`.
Receipts store redacted bounded previews by default; raw redacted artifacts are
written only with `--store-raw-output`.

`agents preflight` verifies an existing environment; it never installs or
mutates anything. It reads a manifest (`{ schemaVersion, targets, rules,
skills, policy }`) and, for each target, checks that required rules/skills
resolve to a physical file (not a symlink, when `policy.requirePhysicalCopies`
is set) and that their content matches the declared canonical artifact (when
`policy.requireRuleParity`/`requireSkillParity` is set). Missing *optional*
artifacts are informational (`warn`), never block dispatch; missing
*required* artifacts, unwanted symlinks, and parity mismatches are
violations - exit `1`, with a `fix` hint per violation pointing at the exact
`ruler`/`skills --copy` command to run (nothing is auto-applied). Exit `2`
for a missing/invalid manifest file or an unknown `--target`.

Each target also reports a `hook` capability probe: whether ScopeLock's own
hook entry is installed, and a `confidence` of `documented` (nominal, from
the host's documented hook format), `live-verified` (an actual harness run
confirmed it - never set automatically), or `degraded` (the claim can't be
trusted for this repo). Claude and Cursor read their real config files;
Codex is always reported `degraded` today because its `hooks.json` schema
and the file-editing (`apply_patch`) hook event shape are undocumented and
unconfirmed by a live probe. This capability probe is informational in this
release; it does not (yet) block dispatch on its own.

`manifest` uses `git ls-files` and reports paths/metadata only: tracked files,
detected project types, package managers, test paths, and risky paths. It does
not read or send source file contents.

Each `task.contract` path inside `plan.json` resolves relative to the
current working directory (the same convention as `approve <file>`), not
relative to the `plan.json` file's own location.

By default `plan-parallel` only considers write-write conflicts (F1) between
contracts' `plannedPathPatterns`. Pass `--include-read-hazards` to also order
tasks using each contract's `readPathPatterns` (F2): a task that writes a
path another task declares as a read must be scheduled in an earlier wave.
If the read-write dependencies form a cycle, the plan is unschedulable as
written - the command exits `1` and lists the cycle instead of a wave order.

Running more than one agent on the same repo at once? See
[**Running agents in parallel**](docs/parallel-workflow.md) for the full
walkthrough - scaffold a contract per subtask, compute the schedule, hand
each wave to its agent, and verify after the fact - with real command output
at every step. A reproducible example lives in
[`examples/parallel/`](examples/parallel/).

## MCP server

ScopeLock also ships a narrow stdio MCP server for agent loops. It intentionally
does **not** clone generic reviewer/enforcer suites; it exposes only the two
ScopeLock-specific surfaces:

| Tool | What it does |
|---|---|
| `plan_parallel` | Build deterministic waves/conflicts from a plan JSON object and contract files. |
| `scopes_conflict` | Check two task scopes and return the conflict witness. |
| `check_drift` | Verify the active approved contract against git drift. |

Run from source:

```bash
pnpm --filter @scopelock/mcp build
node packages/mcp/dist/index.js
```

Claude Code / Cursor-style MCP config while running from source:

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

Codex TOML-style config:

```toml
[mcp_servers.scopelock]
command = "node"
args = ["/absolute/path/to/ScopeLock/packages/mcp/dist/index.js"]
```

When a ScopeLock contract is injected into an agent prompt, the final
instruction tells the agent to call `check_drift` before finishing and resolve
any violations.

MCP tools are pinned to the repository where the server starts. Tool inputs do
not accept `repoRoot`; absolute and escaping contract paths are rejected.

### `--local`

Editor hooks call `scopelock` by default, which assumes it is on `PATH`.
`--local` instead writes an absolute `node "<abs>/index.js"` invocation, so
hooks work before the package is installed globally. The absolute path is
machine-specific, so commit the default (non-`--local`) form to shared repos.

## Exit codes

Stable contract, relied on by CI and hooks:

| Code | Meaning |
|---|---|
| `0` | success / no drift |
| `1` | completed, violations found |
| `2` | execution error (bad input, not a git repo, ...) |

## Modes

- `warn` (default): violations are logged to `.scopelock/reports/audit.ndjson`,
  never blocked.
- `strict`: enforcement hooks block out-of-scope edits where the agent supports
  it (Claude Code `PreToolUse` deny). Cursor always audits (never blocks).

## Security and Privacy

ScopeLock is a deterministic local guardrail, not an OS sandbox. It protects
against accidental scope drift and gives tamper evidence for approved local
state, but it cannot stop a malicious same-user process with unrestricted shell
access. See [SECURITY.md](./SECURITY.md), [THREAT-MODEL.md](./THREAT-MODEL.md),
and [PRIVACY.md](./PRIVACY.md).

## What lives where

```
.scopelock/
  config.json        # shared, committed
  contracts/*.json   # shared, committed
  reports/           # per-machine, gitignored
  active             # per-machine pointer, gitignored
```

## License

MIT - see [LICENSE](./LICENSE).
