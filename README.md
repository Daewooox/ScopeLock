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
| `scopelock export-prompt --target <id>` | Print the contract as agent instructions. |
| `scopelock inject-contract --target <id>` | Inject the contract into `AGENTS.md` / `CLAUDE.md`. |
| `scopelock hooks install --target <id> [--mode warn\|strict] [--local]` | Install editor hooks. |
| `scopelock hooks uninstall --target <id>` | Remove ScopeLock's hook entries only. |
| `scopelock check-drift [--base <sha>]` | Compare actual repo changes to the contract. |

`--json` is available on every command for machine-readable output.

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
