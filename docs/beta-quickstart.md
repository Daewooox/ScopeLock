# Private beta quick start

ScopeLock is an engineering beta for developers who use AI coding agents. It
adds reviewable task boundaries, conflict-aware multi-agent plans, isolated
execution, drift checks, and local evidence. It is not an OS sandbox.

## Requirements

- Git
- Node.js 22 or newer
- Claude Code, Codex, or Cursor CLI for real agent runs
- A clean branch in the repository you want to test

## Install a verified beta bundle

The npm packages are not public yet. A beta tester receives three tarballs from
the same verified CI run. From the directory containing them, run:

```bash
npm install --global --ignore-scripts --no-audit --no-fund \
  ./scopelock-core-0.1.0-beta.1.tgz \
  ./scopelock-cli-0.1.0-beta.1.tgz \
  ./scopelock-mcp-0.1.0-beta.1.tgz

scopelock --help
```

Do not mix tarballs from different runs. Their filenames and SHA-256 values
must match the manifest supplied with the bundle.

To remove the beta:

```bash
npm uninstall --global @scopelock/core @scopelock/cli @scopelock/mcp
```

### Source fallback

```bash
git clone https://github.com/Daewooox/ScopeLock.git
cd ScopeLock
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @scopelock/cli link --global
```

If `corepack` is unavailable, install `pnpm@10` globally with npm.

## Protect one task

Run these commands from the repository where the agent will work:

```bash
scopelock setup

scopelock task start "Add retry handling" \
  --agent claude \
  --allow src/network \
  --allow tests/network \
  --block .env \
  --test unit
```

Review the draft before approving it. ScopeLock does not start the agent. Let
your agent do the task, run the relevant project tests, then verify the result:

```bash
scopelock task finish --open
```

The Flight Report separates allowed changes, blocked changes, and changes
outside the approved boundary. `task finish` checks repository drift; it does
not run the tests named in the contract.

## Prepare several agents

Start from a reviewed `plan.json` whose tasks reference approved contracts:

```bash
scopelock plan prepare plan.json --target claude --out ready-plan.json
```

Inspect `ready-plan.json` before execution. ScopeLock detects overlapping writes
and read dependencies, then puts conflicting tasks into a safe order. To run
the reviewed plan in temporary Git worktrees:

```bash
scopelock run ready-plan.json --yes --isolate --receipt receipt.json
scopelock report receipt.json --open
```

Promotion is fail-closed: a task is rejected if its patch leaves its contract,
the repository changed unexpectedly, or the configured validation command
fails. Isolation protects the normal workflow from accidental task patches; it
does not contain arbitrary absolute-path writes by a malicious process.

## Send useful feedback

Use the [short beta feedback form](beta-feedback.md) or open a structured
[pilot report](https://github.com/Daewooox/ScopeLock/issues/new?template=pilot.yml).
Never attach credentials, proprietary source, prompts, raw receipts, or
unredacted command output.

