# Agent Environment Preflight: product and implementation plan

> Status: Steps 0-4 implemented through Codex hook adapter + receipt integration.
> Updated: 2026-07-10.
> Owner of current planning task: codex, Task #0044.

## 1. Objective

Extend ScopeLock Flight Control so that, before a multi-agent run, it can prove
that every assigned agent received the required project rules, skills, and
enforcement configuration. After the run, the bounded receipt must preserve
the hashes and capability evidence used for that decision.

The product statement is:

> ScopeLock verifies that agents are configured consistently, schedules their
> work safely, enforces task scope where the harness allows it, and records a
> verifiable result.

This responds to a concrete discovery signal: developers using Claude Code,
Cursor, Codex, GLM through another harness, and similar tools must maintain
different instruction files, skill locations, hook formats, and config
directories. Symlinks are not a reliable universal transport.

## 2. Product decision

ScopeLock MUST NOT become a generic rule synchronizer, skill marketplace,
terminal-output proxy, session database, or full agent runtime.

Use the ecosystem in layers:

| Layer | Preferred owner | ScopeLock responsibility |
|---|---|---|
| Durable project guidance | root/nested `AGENTS.md` | Declare required guidance and verify effective presence/hash |
| Reusable workflows | open Agent Skills (`SKILL.md`) | Declare required skills and verify physical installations/hash parity |
| Rule/skill materialization | Ruler and/or `skills` CLI | Integrate or provide actionable fixes; do not clone blindly |
| Context optimization | RTK / Context Mode | Optional compatibility signal only; do not embed in core |
| Full agent runtime | Claude/Cursor/Codex/OpenHands/OpenCode/etc. | Treat the harness as the execution boundary; never model-specific |
| Coordination/proof | ScopeLock | Contracts, conflict graph, dispatch, hooks, drift, tests, receipt |

The defensible addition is **environment attestation**, not file copying:

1. discover the assigned harness and version;
2. resolve its effective instruction and skill locations;
3. verify required artifacts and detect symlinks when physical files are
   required;
4. compare hashes across targets;
5. probe configured enforcement capabilities;
6. stop or warn before dispatch;
7. persist only metadata/hashes in the bounded receipt.

## 3. Research findings to preserve

### 3.1 Direct solutions already exist

- Agent Skills is an open cross-product format: one directory with `SKILL.md`
  plus optional `scripts/`, `references/`, and `assets/`. It uses progressive
  disclosure, so only metadata is loaded until a skill is selected.
  Source: https://github.com/agentskills/agentskills
- `vercel-labs/skills` installs the same skill into many agents. Its `--copy`
  mode explicitly avoids symlinks and therefore addresses the reported Cursor
  failure mode for skills.
  Source: https://github.com/vercel-labs/skills
- Ruler is a direct solution for static configuration distribution: canonical
  rules, skills, MCP config, and experimental subagents are materialized into
  native paths for many harnesses.
  Source: https://github.com/intellectronica/ruler

Conclusion: run a buy-vs-build experiment before adding any materializer to
ScopeLock. If Ruler + `skills --copy` cover the static problem, integrate and
verify them rather than creating another format.

### 3.2 Adjacent projects do not replace ScopeLock

- Caveman primarily compresses visible agent output. Its useful pattern is a
  stdlib-only provider registry and idempotent installer, not coordination.
  Source: https://github.com/JuliusBrussee/caveman
- RTK filters noisy shell-command output. Savings are command/workload
  dependent, and some targets are hook-based while others rely on prompt
  instructions. It does not synchronize project policy or prevent task scope
  conflicts. Source: https://github.com/rtk-ai/rtk
- Context Mode sandboxes large tool output and implements session continuity
  with SQLite/FTS5. It has a mature hook adapter model but is too broad and
  stateful to embed in ScopeLock. Its ELv2 license also means source should not
  be copied into this MIT project. Source: https://github.com/mksglu/context-mode
- OpenHands has strong Agent Skills support, project/org precedence, and
  progressive disclosure, but primarily solves the problem inside its own
  runtime. Adopt the format, not the runtime.
  Source: https://docs.openhands.dev/overview/skills

### 3.3 Existing ScopeLock assumptions are stale

The current registry says Codex hooks support is `none`. Current official
Codex documentation supports lifecycle hooks in `~/.codex/hooks.json`,
`~/.codex/config.toml`, `<repo>/.codex/hooks.json`, and project config, including
`PreToolUse`. Project-local hooks require a trusted project.

Source: https://developers.openai.com/codex/config-advanced#hooks

Cursor also has newer pre-tool hooks, but public reports show version/tool
specific enforcement gaps. Therefore a static enum such as `deny|audit|none`
must describe only nominal capability. Runtime confidence must come from a
live/config probe and be included in the preflight report.

### 3.4 Model and harness are different axes

Do not add adapters for models such as GLM. A model without its own coding
harness runs through OpenCode, Cline, Cursor, Continue, or another host. ScopeLock
integrates with the host because the host owns files, hooks, tools, and config.

## 4. Target user flow

The intended end state is:

```bash
scopelock agents preflight --manifest .scopelock/agents.json
scopelock run --plan plan.json
```

Example human output:

```text
agent environment preflight
claude  rules match  skills 2/2  pre-write deny configured
cursor  rules match  skills 2/2  hook reliability audit-only
codex   rules match  skills 2/2  PreToolUse configured

policy parity: pass
ready to dispatch: yes
```

Exit codes preserve the project-wide contract:

- `0`: all required targets pass;
- `1`: actionable parity/capability violations;
- `2`: malformed manifest, unreadable config, unsupported target, or internal
  execution error.

## 5. Non-goals

- No new LLM calls.
- No daemon, cloud account, auth, or background file watcher.
- No SQLite, FTS, semantic retrieval, or cross-session memory.
- No command-output filtering or RTK clone.
- No generic rule DSL and no new skill format.
- No secret values in manifests or receipts.
- No automatic overwrite of foreign hook/config entries.
- No support for more than Claude, Cursor, and Codex in the first production
  slice.
- No automatic model detection; detect the harness and executable version.

## 6. Phased implementation

### Step 0 - buy-vs-build compatibility spike (NEXT, docs-only)

Goal: reproduce the reported workflow and determine which static-distribution
work is already solved. Do not change `packages/**` in this step.

#### 0.1 Create an external fixture

Use a temporary git repository outside ScopeLock, for example:

```text
/tmp/scopelock-agent-env-spike/
├── AGENTS.md
├── .agents/skills/review-sentinel/SKILL.md
├── .ruler/
│   ├── AGENTS.md
│   └── ruler.toml
├── existing-config-fixtures/
│   ├── claude-settings.json
│   ├── cursor-hooks.json
│   └── codex-config.toml
└── evidence/
```

Use unique sentinels:

- rule: `SCOPELOCK_RULE_SENTINEL_20260710`;
- skill: `SCOPELOCK_SKILL_SENTINEL_20260710`.

Each existing config fixture must contain one foreign entry that the tested
tool is not allowed to remove.

#### 0.2 Test `skills` CLI

Run project-local installs for Claude Code, Cursor, and Codex with `--copy`.
Record exact CLI version and commands. Verify:

- expected target directories/files exist;
- `lstat` reports regular files/directories, not symlinks;
- the skill sentinel is byte-identical in all target copies;
- a second identical apply is idempotent;
- changing canonical `SKILL.md` then updating produces equal target hashes;
- removal deletes only the selected skill and preserves unrelated skills;
- `DISABLE_TELEMETRY=1` is used during the experiment.

#### 0.3 Test Ruler

Run `ruler init/apply` against the same fixture. Verify:

- physical `CLAUDE.md`, `AGENTS.md`, Cursor output, skill directories, and MCP
  files produced for enabled targets;
- foreign configuration entries survive merge/apply;
- second apply is idempotent;
- canonical rule update propagates deterministically;
- generated-file cleanup behavior is understood;
- no secret-bearing global config is copied into the fixture;
- current OpenHands output paths are not used as evidence for our three-target
  MVP because Ruler documentation may lag OpenHands deprecations.

#### 0.4 Live harness probes

Only run a target when its executable exists. Record unavailable targets as
`blocked`, never as `failed`.

For each available harness:

1. print version;
2. start in the fixture;
3. ask it to report the rule sentinel;
4. invoke the skill and report the skill sentinel;
5. install a harmless deny hook for a known temporary path;
6. attempt the write and record whether it was blocked before mutation;
7. verify the foreign config entry still exists.

For Codex, test both trusted-project loading and the negative untrusted case if
the CLI exposes a reproducible trust boundary. For Cursor, report enforcement
per tool type; do not generalize one successful deny to all reads/writes/tools.

#### 0.5 Measurements

Produce one table:

| Target | Rule loaded | Skill loaded | Physical copy | Idempotent | Foreign config preserved | Pre-write deny |
|---|---:|---:|---:|---:|---:|---:|

Also record:

- generated bytes by target;
- canonical vs target SHA-256;
- install/apply duration;
- manual interventions;
- exact tool versions;
- unsupported or ambiguous behavior.

#### 0.6 Deliverable and decision gate

Write `memory-bank/plans/agent-environment-preflight-spike-verdict.md` with:

- commands and versions;
- evidence table;
- gaps in Ruler/skills CLI;
- GO/NO-GO for a ScopeLock materializer;
- GO/NO-GO for ScopeLock environment attestation.

Decision rules:

- If existing tools cover at least 90% of static distribution and preserve
  foreign config, **do not build `scopelock agents apply`**.
- Build only a missing target adapter if the gap is required by an available
  design partner and cannot be fixed upstream cheaply.
- Environment attestation is GO only if the experiment finds at least one
  meaningful mismatch, unreliable capability, or unverifiable configuration
  that ScopeLock can detect before dispatch.
- If all three harnesses consume the same canonical files reliably with no
  mismatch, stop and keep the current product focused on coordination.

#### 0.7 Step 0 Definition of Done

- [ ] ScopeLock product code unchanged.
- [ ] Fixture and raw evidence live outside the product repository.
- [ ] Ruler and `skills --copy` tested, not merely read from README.
- [ ] Claude/Cursor/Codex results separated; unavailable tools marked blocked.
- [ ] Symlink behavior verified with `lstat`/`readlink`.
- [ ] Idempotence and foreign-entry preservation verified.
- [ ] Report contains an explicit GO/NO-GO per decision gate.
- [ ] Memory Bank updated with the result.

### Step 1 - schemas and pure preflight engine (only after Step 0 GO)

Expected files:

```text
packages/core/src/schemas/agent-workspace.ts
packages/core/src/agents/locations.ts
packages/core/src/agents/discover.ts
packages/core/src/agents/preflight.ts
packages/core/src/agents/hash.ts
packages/core/src/agent-preflight.test.ts
```

Proposed manifest v1:

```ts
type AgentWorkspaceManifest = {
  schemaVersion: 1;
  targets: Array<"claude" | "cursor" | "codex">;
  rules: Array<{ id: string; path: string; required: boolean }>;
  skills: Array<{ name: string; path: string; required: boolean }>;
  policy: {
    requirePhysicalCopies: boolean;
    requireRuleParity: boolean;
    requireSkillParity: boolean;
  };
};
```

Constraints:

- all paths are repo-relative and cannot escape the repository;
- duplicate target/rule/skill ids fail Zod validation;
- hashing is SHA-256 over raw file bytes in deterministic path order;
- skill digest includes `SKILL.md` and bundled files, excluding generated cache
  files and `.git`;
- discovery does not execute skill scripts;
- symlinks are reported, not followed, when physical copies are required;
- missing optional artifacts are informational, missing required artifacts are
  violations;
- core returns typed data only and never prints or exits.

Minimum tests:

- valid and invalid manifest fixtures;
- path traversal rejected;
- identical trees yield identical digest;
- byte change changes digest;
- file order and OS separators do not change digest;
- symlink detected;
- missing required vs optional behavior;
- foreign files do not affect declared skill digest;
- no target-specific target path is hardcoded outside `locations.ts`.

### Step 2 - CLI `agents preflight`

Expected files:

```text
packages/cli/src/commands/agents-preflight.ts
packages/cli/src/index.ts
packages/cli/src/cli.test.ts
```

Command:

```bash
scopelock agents preflight \
  --manifest .scopelock/agents.json \
  [--target claude] [--target cursor] [--target codex] \
  [--json]
```

Requirements:

- thin CLI over core;
- human output includes `severity`, `detail`, and actionable `fix`;
- JSON shape is Zod-validated before output;
- exit `1` for parity/capability violations, `2` for operational errors;
- no automatic mutation in the first version;
- fixes may recommend exact Ruler/skills commands, but must not download or
  execute third-party code implicitly.

### Step 3 - harness capability refresh and Codex hook adapter

Status: implemented.

Step 3a shipped nominal capabilities and config-file probes. Step 3b then live
captured Codex `apply_patch` `PreToolUse` and verified deny behavior in an
external fixture. Production now includes `.codex/hooks.json` merge,
`hook gate --format codex`, and `apply_patch` path extraction. Static confidence
remains `degraded` for Codex because project trust is not statically readable.

Do not start until Step 0 records live behavior.

Replace the overly coarse `hooksSupport: deny|audit|none` assumption with two
layers:

1. nominal adapter capabilities from documented formats;
2. observed/configured probe status in each preflight report.

At minimum model:

```ts
type HookCapabilities = {
  preToolUse: boolean;
  postToolUse: boolean;
  canDeny: boolean;
  canModifyInput: boolean;
  confidence: "documented" | "live-verified" | "degraded";
};
```

Codex work, if live probe passes:

- add `.codex/hooks.json` path support;
- idempotently merge ScopeLock `PreToolUse` without removing foreign entries;
- support install/uninstall/doctor;
- parse the actual Codex hook event through Zod;
- respect trusted-project behavior and report untrusted project as degraded;
- add live regression instructions and unit fixtures.

Cursor work:

- retain post-run drift as source of truth;
- only upgrade from audit to deny for tool types proven by the Step 0 live
  matrix;
- store no blanket `deny` claim if any required write path is unverified.

### Step 4 - dispatcher and bounded receipt integration

Status: implemented.

Receipt schema is now v3. `scopelock run --plan` checks
`.scopelock/agents.json` when present, blocks dispatch in strict mode on
required violations, continues in warn mode while recording violations, and
stores manifest/target digests plus hook confidence without raw rule/skill
contents.

Only after Steps 1-3 are stable.

- If `.scopelock/agents.json` exists, run preflight before dispatch.
- In strict policy, do not launch tasks when required parity fails.
- In warn policy, launch but record violations.
- Add a bounded `environment` section to receipt v3 or the next compatible
  schema version:

```ts
type ReceiptEnvironment = {
  manifestDigest: string;
  targets: Array<{
    id: AgentId;
    version: string | null;
    rulesDigest: string | null;
    skillsDigest: string | null;
    hookConfidence: "documented" | "live-verified" | "degraded";
    violations: string[];
  }>;
};
```

Do not embed rule/skill contents or raw configs in the receipt. Raw diagnostic
evidence, if needed, belongs in local artifacts and follows the existing
bounded-receipt pattern.

### Step 5 - demo and design-partner validation

Status: next.

Build one deterministic demo with two states:

1. Cursor is missing a required physical skill copy: preflight blocks and
   explains the exact fix.
2. After applying the fix, all targets pass, tasks are scheduled, and the final
   receipt contains matching environment hashes.

Then run a pilot with the user who reported the problem. Success is not video
views. Success means:

- the user replaces manual duplicated setup for at least one real repo;
- the preflight finds or prevents at least one configuration mismatch;
- the user understands the report without developer explanation;
- the same flow is repeated on a second task or repository.

## 7. Global engineering invariants

- Existing ScopeLock CLI exit contract remains `0/1/2`.
- Every JSON boundary uses Zod.
- Every persisted JSON write uses `writeJsonAtomic`.
- `.scopelock` paths come from `scopelockPaths()`.
- Core contains no commander, console output, or `process.exit`.
- Hook/config merge is marker-owned and preserves foreign entries.
- No network access in drift, preflight, hooks, or receipt generation.
- Third-party installer execution is explicit and user-visible.
- Product code changes require a fresh approved ScopeLock contract.
- Cross-platform tests cover Windows path separators and symlink capability
  differences; skip with an explicit reason when the OS cannot create symlinks.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Ruler already covers the whole feature | Step 0 kill-criterion; integrate instead of clone |
| Agent config formats change quickly | Small adapters, nominal vs observed capabilities, live probes |
| Generated copies drift | SHA-256 parity and actionable preflight violations |
| Secrets leak through config attestation | Hash declared artifacts only; never persist values/raw config |
| Preflight creates startup friction | Run only when manifest exists; deterministic local checks; target p95 < 150 ms excluding executable version probes |
| Hook says deny but host ignores it | Version/tool-specific confidence; post-run drift remains source of truth |
| Feature dilutes Flight Control | Position as pre-dispatch checklist and receipt provenance, not config management |

## 9. Final sequence

The required order is:

```text
Step 0 evidence
  -> GO/NO-GO static materializer
  -> GO/NO-GO environment attestation
  -> Step 1 pure core
  -> Step 2 CLI
  -> Step 3 hook capability refresh
  -> Step 4 run/receipt integration
  -> Step 5 pilot and video
```

Do not skip Step 0. Do not implement Steps 1-5 in one contract or one commit.
Each production step gets its own ScopeLock contract, tests, logical commit,
and Memory Bank update.
