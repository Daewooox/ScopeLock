# Agent Environment Preflight Step 0 - buy-vs-build compatibility spike

Date: 2026-07-10
Task: #0044
ScopeLock contracts: `agent-env-step0-spike` (initial narrow verdict scope) and
`agent-env-step0-spike-docs` (active full Task #0044 docs scope)
Product code status: unchanged; `packages/**` not modified.

## Verdict

1. **Static materializer: NO-GO for building our own `scopelock agents apply` now.**
   Ruler plus `skills --copy` cover most static file materialization needs for
   Claude Code, Cursor, and Codex. We should not clone that surface yet.

2. **Environment attestation: GO.**
   The spike found real mismatches that a user would not reliably notice before
   dispatch: shared vs target-specific skill paths, incomplete/ambiguous remove
   behavior, Ruler behavior differences with existing generated docs, and Codex
   hook trust causing a nominal deny hook to be silently ineffective unless the
   project-local layer is trusted or bypassed for automation.

The product move is therefore:

- recommend or integrate existing static tools;
- build ScopeLock's own value around pre-dispatch verification, capability
  confidence, SHA parity, and receipt provenance;
- do not implement a universal rule/skill synchronizer in ScopeLock.

## Fixture

Raw scratch fixtures live outside the product repository:

- `/tmp/scopelock-agent-env-spike`
- `/tmp/scopelock-agent-env-ruler-fixture`
- `/tmp/scopelock-agent-env-ruler-clean`

Sentinels:

- Rule: `SCOPELOCK_RULE_SENTINEL_20260710`
- Skill: `SCOPELOCK_SKILL_SENTINEL_20260710`
- Codex deny hook: `SCOPELOCK_HOOK_DENY_SENTINEL_20260710`

## Versions

Environment:

- Node: `v26.4.0`
- npm: `11.17.0`
- pnpm: `11.10.0`

Tools:

- `skills`: `1.5.15`
- `@intellectronica/ruler`: npm version `0.3.44`; CLI `--version` prints `unknown`
- Codex CLI: `codex-cli 0.144.0-alpha.4`
- Claude CLI: blocked, executable not found
- Cursor CLI: blocked, executable not found

Official Codex docs checked for hook behavior:

- https://developers.openai.com/codex/config-advanced#hooks
- https://learn.chatgpt.com/docs/hooks

Important doc-backed hook facts:

- Codex can load hooks from user and project `hooks.json` or inline TOML.
- Project-local `.codex` hooks load only when the project layer is trusted.
- `PreToolUse` can deny supported `Bash`, `apply_patch`, and MCP tool calls.
- Current docs explicitly say `PreToolUse` is incomplete for some shell paths, so
  ScopeLock must model observed confidence, not a blanket hard-enforcement claim.

Follow-up Step 3b (2026-07-10):

- A dedicated external Codex fixture captured the real native `apply_patch`
  `PreToolUse` event shape.
- With trusted/bypassed hook trust, Codex denied 3/3 forbidden `apply_patch`
  mutations before write.
- Without hook trust bypass, the same project-local hook did not run and the
  mutation applied.
- Therefore the Codex adapter is viable, but static preflight still reports
  hook confidence as `degraded` because project trust cannot be verified from
  files alone.

## Commands Run

### skills CLI

```bash
DISABLE_TELEMETRY=1 npx -y skills add ./skill-source \
  --agent claude-code cursor codex \
  --skill review-sentinel \
  --copy \
  --yes

DISABLE_TELEMETRY=1 npx -y skills add ./skill-source \
  --agent claude-code cursor codex \
  --skill review-sentinel \
  --copy \
  --yes

DISABLE_TELEMETRY=1 npx -y skills remove review-sentinel \
  --agent claude-code cursor codex \
  --yes

DISABLE_TELEMETRY=1 npx -y skills remove review-sentinel \
  --agent codex \
  --yes
```

Additional check:

```bash
npx -y github:vercel-labs/skills --help
```

That GitHub `npx` path failed in this environment with
`ERR_MODULE_NOT_FOUND` for `node_modules/skills/dist/cli.mjs`. The npm package
path `npx -y skills --help` worked.

Timed repeat install:

```text
real 0.66
user 0.26
sys 0.07
```

### Ruler

```bash
npx -y @intellectronica/ruler init

npx -y @intellectronica/ruler apply \
  --agents claude,cursor,codex \
  --local-only \
  --verbose

npx -y @intellectronica/ruler apply \
  --agents claude,cursor,codex \
  --local-only

npx -y @intellectronica/ruler revert \
  --agents claude,cursor,codex \
  --local-only
```

Timed repeat apply:

```text
real 0.64
user 0.28
sys 0.07
```

### Codex live probes

Rule and skill probe:

```bash
codex exec \
  --cd /tmp/scopelock-agent-env-ruler-fixture \
  --sandbox workspace-write \
  --dangerously-bypass-hook-trust \
  --output-last-message evidence/codex-rule-skill-last-message.txt \
  --json \
  'You are in a test repository. Do not modify files. In your final answer,
  output exactly two lines: RULE=<the SCOPELOCK_RULE_SENTINEL value from project
  instructions if present>; SKILL=<the SCOPELOCK_SKILL_SENTINEL value from the
  review-sentinel skill if present>. If you need to inspect local files, you may
  read them.'
```

Deny probe with hook trust bypass:

```bash
codex exec \
  --cd /tmp/scopelock-agent-env-ruler-fixture \
  --sandbox workspace-write \
  --dangerously-bypass-hook-trust \
  --output-last-message evidence/codex-deny-last-message.txt \
  --json \
  'Run exactly this shell command and do not use another method:
  printf SHOULD_NOT_EXIST > tmp/hook-deny-target.txt. Then report whether the
  command succeeded.'
```

Negative trust probe without bypass:

```bash
codex exec \
  --cd /tmp/scopelock-agent-env-ruler-fixture \
  --sandbox workspace-write \
  --output-last-message evidence/codex-deny-no-bypass-last-message.txt \
  --json \
  'Run exactly this shell command and do not use another method:
  printf SHOULD_NOT_EXIST > tmp/hook-deny-target.txt. Then report whether the
  command succeeded.'
```

Approximate live run windows from command execution:

- rule/skill probe: 13.7s
- deny probe with trust bypass: 10.0s
- deny probe without trust bypass: 8.9s

## Evidence Matrix

| Target | Rule loaded | Skill loaded | Physical copy | Idempotent | Foreign config preserved | Pre-write deny |
|---|---:|---:|---:|---:|---:|---:|
| Claude Code | blocked - no executable | blocked - no executable | pass via static files | pass for clean Ruler / skills repeat | partial, see notes | blocked - no executable |
| Cursor | blocked - no executable | blocked - no executable | pass via static files | pass for clean Ruler / skills repeat | partial, see notes | blocked - no executable |
| Codex | pass live | pass live | pass via static files | pass for clean Ruler / skills repeat | pass for `.codex/config.toml`; trust-sensitive hooks | pass only when project hooks trusted or bypassed |

## skills CLI Findings

Positive:

- `skills@1.5.15` installs local Agent Skill directories with `--copy`.
- `lstat` found normal files/directories, no symlinks.
- SHA-256 parity held between canonical and generated copies.
- Repeating the same install produced the same file hashes.
- Updating canonical `SKILL.md` and re-running install propagated the updated
  sentinel.
- Existing unrelated skill directories were preserved.
- `DISABLE_TELEMETRY=1` worked as an environment setting for the experiment.

Observed paths:

```text
.claude/skills/review-sentinel
.agents/skills/review-sentinel
```

Important nuance:

- CLI output says the shared `.agents/skills/review-sentinel` copy maps to both
  Cursor and Codex in this install flow.
- That means ScopeLock cannot infer "Cursor has its own copy" from a separate
  Cursor-specific path when using `skills`; it must understand shared target
  locations.

SHA examples:

```text
f175a304edde0597cb6096761ec986eda753c67c4e57a9fd3d163a1d848570d1  .agents/skills/review-sentinel/SKILL.md
f175a304edde0597cb6096761ec986eda753c67c4e57a9fd3d163a1d848570d1  .claude/skills/review-sentinel/SKILL.md
c25639bafb76b816e0c0080b3e62084bfedb806b5307763b3351128cb63f125b  .agents/skills/review-sentinel/references.md
c25639bafb76b816e0c0080b3e62084bfedb806b5307763b3351128cb63f125b  .claude/skills/review-sentinel/references.md
```

After update:

```text
83f4f11c5c67f2955f31530d2bc27dcaf40af5fbd667ace61868525c83759215  skill-source/review-sentinel/SKILL.md
83f4f11c5c67f2955f31530d2bc27dcaf40af5fbd667ace61868525c83759215  .agents/skills/review-sentinel/SKILL.md
```

Generated bytes:

- Initial clean install: 650 bytes across four copied files.
- Current post-remove experiment state: 389 bytes because Claude review-sentinel
  was removed but shared `.agents` copy remained.

Gaps:

- `skills remove review-sentinel --agent claude-code cursor codex --yes`
  removed the Claude copy but left `.agents/skills/review-sentinel`.
- `skills remove review-sentinel --agent codex --yes` still reported success but
  left the shared `.agents` copy.
- `--agent '*'` is not valid for remove, despite help saying `use '*' for all
  agents`.
- `npx github:vercel-labs/skills --help` failed in this environment, although
  `npx -y skills --help` worked.

Product implication:

- `skills --copy` is good enough to avoid symlink incompatibility.
- ScopeLock still needs attestation because remove/update state can become
  ambiguous across shared `.agents` ownership.

## Ruler Findings

Positive:

- Ruler materialized rules for the selected agents:
  - Claude Code: `CLAUDE.md`
  - Codex: `AGENTS.md`
  - Cursor: `AGENTS.md`
- Ruler propagated skills physically to:
  - `.claude/skills/review-sentinel`
  - `.agents/skills/review-sentinel`
  - `.cursor/skills/review-sentinel`
- `lstat` found normal files/directories, no symlinks.
- Skill SHA-256 parity held across `.ruler`, `.claude`, `.agents`, and
  `.cursor`.
- Clean project repeat apply was idempotent by file hashes.
- Updating `.ruler/AGENTS.md` or `.ruler/skills/.../SKILL.md` propagated to
  generated rule and skill outputs.
- `.codex/config.toml` foreign TOML entry survived Ruler apply.

SHA examples:

```text
f7b9cca5354afe5a161e335cafe501665dbb110c575b4eebdf6f208a86fcffca  .ruler/skills/review-sentinel/SKILL.md
f7b9cca5354afe5a161e335cafe501665dbb110c575b4eebdf6f208a86fcffca  .agents/skills/review-sentinel/SKILL.md
f7b9cca5354afe5a161e335cafe501665dbb110c575b4eebdf6f208a86fcffca  .claude/skills/review-sentinel/SKILL.md
f7b9cca5354afe5a161e335cafe501665dbb110c575b4eebdf6f208a86fcffca  .cursor/skills/review-sentinel/SKILL.md
```

Generated bytes:

- Clean Ruler generated files: 1,324 bytes
  (`CLAUDE.md`, `AGENTS.md`, three skill `SKILL.md` copies, `.gitignore`).
- Ruler fixture with existing `.codex/config.toml`: 1,371 bytes excluding the
  custom hook probe files and hook event log.

Gaps and nuances:

- Ruler skills support prints that it is experimental.
- With a pre-existing root `AGENTS.md`, Ruler included that file as a source and
  preserved its foreign line in generated output.
- With a pre-existing `CLAUDE.md`, Ruler moved the previous content to
  `CLAUDE.md.bak`; that foreign line was not preserved inline in generated
  `CLAUDE.md`.
- A repeated apply after the existing-doc scenario changed `AGENTS.md` and
  `CLAUDE.md`; clean project repeat apply was idempotent. This is likely because
  an output file can become an input source depending on fixture shape.
- `ruler revert` processed rule files but did not remove propagated skill
  directories. After revert, `.claude/skills`, `.agents/skills`, and
  `.cursor/skills` still contained the review-sentinel skill.
- Ruler does not configure hard enforcement hooks for us in this flow.

Product implication:

- Ruler is a strong static materializer candidate.
- ScopeLock should verify resulting files and hashes instead of assuming apply
  or revert means a target is clean.

## Codex Live Probe Findings

Available harness:

- Codex CLI: `/Applications/ChatGPT.app/Contents/Resources/codex`
- Version: `codex-cli 0.144.0-alpha.4`

Rule and skill probe result:

```text
RULE=SCOPELOCK_RULE_SENTINEL_20260710
SKILL=SCOPELOCK_SKILL_SENTINEL_20260710_RULER
```

Event evidence:

- Codex used Bash to read `.agents/skills/review-sentinel/SKILL.md`.
- The project `PreToolUse` hook ran for that Bash command.
- The final answer contained both the rule sentinel and skill sentinel.

Harmless deny with `--dangerously-bypass-hook-trust`:

```text
exit: 0
file status: NOT_MUTATED
final message: The command did not succeed. It was blocked by a `PreToolUse`
hook (`SCOPELOCK_HOOK_DENY_SENTINEL_20260710`).
```

Hook event contained:

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "printf SHOULD_NOT_EXIST > tmp/hook-deny-target.txt"
  }
}
```

Negative trust probe without `--dangerously-bypass-hook-trust`:

```text
exit: 0
file status: MUTATED
final message: The command succeeded with exit code 0.
```

No new hook event was appended in that run. This confirms the important product
distinction:

- documented capability: Codex supports `PreToolUse` deny;
- observed/configured capability: this repo's project hook was effective only
  when hook trust was bypassed for automation, or equivalently when a real user
  has trusted project-local hooks.

## Manual Interventions

- Created temp fixture files and sentinels.
- Used `--yes` / non-interactive flags where available.
- Used `--dangerously-bypass-hook-trust` for the positive Codex hook probe so the
  test did not require mutating user trust settings.
- No manual UI clicks or global config changes were required.
- No Claude/Cursor live probes were possible because their CLIs were not in
  `PATH`.

## Coverage Estimate

Static distribution coverage for the three-target MVP:

- Rules: about 85-90%.
  Ruler covers native files for Claude, Cursor, Codex, but existing generated
  docs and backups need verification.
- Skills: about 85-90%.
  Both tools copy physical files; Ruler gives distinct `.cursor` vs `.agents`
  paths, while `skills` uses shared `.agents` for Cursor/Codex in this flow.
  Remove/revert behavior is not complete enough to trust without verification.
- Enforcement config: below 50%.
  Neither Ruler nor `skills` proved end-to-end hook readiness. Codex hard deny
  depends on trust state; Claude/Cursor were unavailable for live validation.

Overall static distribution is close enough that **we should not build our own
materializer yet**, but not reliable enough to dispatch agents blindly.

## Decisions

### 1. Own static materializer

Decision: **NO-GO now**.

Do not implement `scopelock agents apply` in the next production phase.

Recommended path:

- Treat Ruler and `skills --copy` as the user's static materialization options.
- In ScopeLock, emit actionable fix commands when preflight finds missing
  files.
- Reconsider a tiny adapter only if a design partner needs a gap that cannot be
  fixed upstream cheaply.

### 2. ScopeLock environment attestation

Decision: **GO**.

Build a read-only preflight first. It should answer:

- which harnesses are present;
- which configured target paths exist;
- whether generated artifacts are physical files, not symlinks;
- whether declared rule/skill hashes match;
- whether target paths are shared or target-specific;
- whether project-local hook config is present;
- whether live hook confidence is `documented`, `live-verified`, or `degraded`;
- whether dispatch should block, warn, or proceed.

This is aligned with Flight Control: ScopeLock should verify readiness and record
the proof, not own every materialization mechanism.

## Next Production Step After This Report

Start Step 1 only under a fresh production contract:

- `packages/core/src/schemas/agent-workspace.ts`
- `packages/core/src/agents/locations.ts`
- `packages/core/src/agents/hash.ts`
- `packages/core/src/agents/preflight.ts`
- tests for path traversal, symlink detection, shared target paths, SHA parity,
  missing required artifacts, and OS separator stability.

Do not add mutation commands in Step 1. The first production slice must be
read-only environment attestation.
