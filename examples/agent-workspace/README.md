# Agent environment preflight example

A minimal, reproducible manifest for
[`scopelock agents preflight`](../../docs/reference.md#agent-environment-preflight).

Unlike the [parallel-workflow example](../parallel/), this one can't just
point at paths inside this repo: `agents preflight` checks *fixed* installed
locations relative to the repo root (`AGENTS.md`, `CLAUDE.md`,
`.agents/skills/<name>`, `.claude/skills/<name>`, `.cursor/skills/<name>` -
see `packages/core/src/agents/locations.ts`), not whatever path you happen to
declare. So this example needs its own scratch repo to check against, the
same way the CLI's own tests do.

## Reproduce in one command

```bash
mkdir /tmp/preflight-example && cd /tmp/preflight-example
git init -q
mkdir -p .agents/skills/review
echo "RULE" > AGENTS.md
echo "RULE" > CLAUDE.md
echo "SKILL.md" > .agents/skills/review/SKILL.md
cp /path/to/ScopeLock/examples/agent-workspace/manifest.json .
node /path/to/ScopeLock/packages/cli/dist/index.js agents preflight --manifest manifest.json
```

Expected output:

```
agent environment preflight
claude  status=pass  rules 1/1  skills 1/1
  hook: pre-write deny (documented, not installed-checked live, not installed)
cursor  status=pass  rules 1/1  skills 1/1
  hook: post-write audit only (documented, not installed-checked live, not installed)
codex  status=pass  rules 1/1  skills 1/1
  hook: pre-write deny (degraded, unverified, not installed)

summary: pass (0 violations)
ready to dispatch: yes
```

## What a missing required skill looks like

Delete the skill directory (`rm -rf .agents/skills/review`) and rerun the
same command:

```
claude  status=fail  rules 1/1  skills 0/1
  hook: pre-write deny (documented, not installed-checked live, not installed)
  error  missing_required_skill  claude: required skill "review" not found (looked in: .claude/skills/review, .agents/skills/review)
    fix: install the skill physically (e.g. `npx skills add <source> --agent claude --copy`)
...
summary: fail (3 violations)
ready to dispatch: no
```

Exit code `1`. Each violation carries a `fix` hint; `agents preflight` never
runs it for you - it is read-only.

## What's here

| File | Role |
|---|---|
| `manifest.json` | An `agentWorkspaceManifestSchema` manifest requiring one rule (`AGENTS.md`) and one shared skill (`review`) across `claude`, `cursor`, and `codex`. `requirePhysicalCopies: true` rejects symlinks; parity checks are off here to keep the example to one canonical skill copy. |
