# ScopeLock Step 5.0 buy-vs-build spike verdict

Date: 2026-07-09
Contract: `mcp-buy-vs-build-spike`
Scope: docs-only, competitor installs and scratch repos under `/tmp/scopelock-mcp-spike`

## Verdict

**GO, but only for the narrow Step 5.1 MCP slice.**

The kill criterion did **not** trigger: `agent-guardrails` plus native hooks covers a large part of finish-time scope checking, but not language-agnostic parallel scheduling, and not true pre-write denial. `wit` covers cooperative multi-agent locks, including hard lock conflicts for the same symbol string, but it is not a wave scheduler and its parser/contract layer is TS/JS/Python-only. Therefore ScopeLock should build MCP only as thin wrappers around the two surviving differentiators:

- `plan_parallel` / `scopes_conflict`: language-agnostic glob scheduler with concrete witnesses.
- `check_drift`: verification tool for ScopeLock contracts, paired with the existing PreToolUse hook gate. Do **not** clone agent-guardrails' five-reviewer-check suite.

Estimated coverage by existing tools for the intended Step 5.1 value: **~65-75%**, not >=90%. The uncovered part is the combination of pre-flight wave planning over arbitrary path globs plus ScopeLock's strict pre-write gate.

## Scratch Setup

- Fixture repo: `/tmp/scopelock-mcp-spike/polyglot-work`
- Files:
  - `src/app.ts`
  - `py/service.py`
  - `config/settings.json`
  - `config/pipeline.yaml`
- `agent-guardrails`: `0.20.0`, run through `npx`; native binary on this machine had `EACCES`, so commands used `AGENT_GUARDRAILS_RUNTIME=node`.
- `wit`: npm package is `wit-protocol@0.1.3`, not `wit`; run from cloned source with temporary `npx bun` wrapper because the CLI/daemon require Bun.
- ScopeLock CLI: local built `packages/cli/dist/index.js`, used only from scratch repos.

## Evidence Table

| Axis | agent-guardrails | wit | ScopeLock | Winner |
| --- | --- | --- | --- | --- |
| A: when out-of-scope is caught | `check` catches after the diff exists. Clean run changed `src/app.ts` and `config/settings.json`; `check --json` returned `ok:false`, `scoreVerdict:"blocked"`, `outOfTaskScopeFiles:["config/settings.json"]`, exit 1. | Not a scope-drift checker. It coordinates declared intents and locks; no "approved task scope vs changed files" check. | `hook gate` on PreToolUse input for `config/settings.json` returned exit 2 before any file write; `src/app.ts` returned exit 0. | ScopeLock for pre-write denial. agent-guardrails for mature finish-time review. |
| A: daemon / auto-mode behavior | `start --foreground` watched `src/, lib/, tests/`, then after edits wrote `.agent-guardrails/daemon-result.json` with `ok:false`. The bad file was already changed. Claude hook is `PostToolUse`; Codex hook is `Stop`; git hook is pre-commit. | Claude plugin/session instructions tell agents to declare/lock before editing. Lock conflicts can stop a cooperative agent before it edits, but there is no general file-write interceptor. | Existing Claude hook is `PreToolUse` and strict mode denies before write. | ScopeLock for unattended auto-mode safety. |
| B: parallel scheduling plus witness | No scheduler found in CLI/MCP. MCP tools are guardrail/read/check/loop/review oriented (`start_agent_native_loop`, `finish_agent_native_loop`, `run_guardrail_check`, etc.). | No wave scheduler. It stores intents/locks and reports conflicts. Same TS symbol lock returns `LOCK_CONFLICT`; file intent overlap returns `INTENT_OVERLAP`. | `plan-parallel` on TS + Python + JSON + YAML contracts produced one wave: `[json-config, py-service, ts-format, yaml-config]`. Conflict plan produced two waves and witnesses: `config-all x json-config -> config/.json`; `config-all x yaml-config -> config/.yaml`. | ScopeLock for pre-flight N-task scheduling. |
| B: polyglot / non-code | Scope checks are path based and work on any file, but no scheduling. Daemon generic preset watched only `src/, lib/, tests/` by default, so config-only changes may not trigger until another watched file changes or `check` runs. | File intents work for JSON/YAML as string paths; `lock` accepts arbitrary symbol strings like `config/pipeline.yaml:pipeline`. Parser/contract docs/source restrict supported extensions to `.ts/.tsx/.js/.jsx/.py`, so JSON/YAML locks are not AST-backed. | Globs are language-agnostic; JSON/YAML are first-class because the scheduler reasons over paths, not parsers. | ScopeLock for non-code scheduling; wit for code-symbol locks. |
| C: is worktree isolation enough? | Not an orchestrator; fits review/merge-gate flow. | Designed for shared workdir coordination, not worktree isolation. | Useful when agents share a workdir or when a platform loop needs pre-flight "can these tasks run together?" before dispatch. Worktrees are enough when teams accept later merge resolution and separate branches; they do not answer same-tree auto-mode safety or produce reusable conflict witnesses. | Ambiguous overall; ScopeLock wins only in shared-tree / auto-loop workflows. |
| Integration and maturity | Strong. CLI, MCP stdio, daemon, setup, adapters for Claude/Codex/Cursor/Gemini/OpenCode, CI/hook footprint. GitHub topic/search showed ~7-8 stars, so adoption remains weak despite maturity. | Focused and young. Requires Bun; `npx wit-protocol --help` hung without Bun because package bin points at TS/Bun entry. Source run worked with temporary Bun. | CLI/hooks/scheduler are built and tested locally; MCP not built yet. | agent-guardrails for maturity; ScopeLock only if differentiated. |

## Commands and Observations

### agent-guardrails

Install/runtime checks:

```bash
npx -y agent-guardrails --version
# agent-guardrails v0.20.0

npx -y agent-guardrails init . --preset generic --adapter codex --force
# failed first with native darwin-arm64 EACCES

AGENT_GUARDRAILS_RUNTIME=node npx -y agent-guardrails init . --preset generic --adapter codex --force
# succeeded
```

Clean scope violation check:

```bash
AGENT_GUARDRAILS_RUNTIME=node npx -y agent-guardrails plan \
  --task "Only change src/app.ts" \
  --intended-files "src/app.ts" \
  --allow-paths "src/" \
  --allowed-change-types "implementation-only"

printf '\n// in scope\n' >> src/app.ts
printf '\n{"bad":true}\n' >> config/settings.json
AGENT_GUARDRAILS_RUNTIME=node npx -y agent-guardrails check --json
```

Observed summary:

```json
{
  "ok": false,
  "scoreVerdict": "blocked",
  "diffSource": "working tree",
  "changedFiles": ["config/settings.json", "src/app.ts"],
  "outOfTaskScopeFiles": ["config/settings.json"],
  "outOfIntendedFiles": ["config/settings.json"]
}
```

Daemon check:

```bash
AGENT_GUARDRAILS_RUNTIME=node npx -y agent-guardrails start --foreground
# Watch paths: src/, lib/, tests/
# Check interval: 5000ms

printf '\n{"bad2":true}\n' >> config/settings.json
printf '\n// trigger daemon\n' >> src/app.ts
# daemon later logs "Check completed with issues"; file was already changed
```

Source/doc confirmation:

- README says the tool gives reviewers "a clear answer before merge" and the workflow ends with `check --review`.
- Claude integration is `PostToolUse`; Codex integration is `Stop`; git integration is pre-commit.
- MCP loop prompt says after every file edit call `check_after_edit`.

### wit

Install/runtime checks:

```bash
npm view @amaar-mc/wit
# 404
npm view wit
# unrelated package
npm view wit-protocol version bin
# 0.1.3, bin wit -> src/cli/index.ts

npx -y wit-protocol --help
# hung without Bun
npx -y bun --version
# 1.3.14
```

Run from source with temporary Bun wrapper:

```bash
cd /tmp/scopelock-mcp-spike/wit
npx -y bun install

cd /tmp/scopelock-mcp-spike/wit-work
PATH="/tmp/scopelock-mcp-spike/bin:$PATH" npx -y bun run /tmp/scopelock-mcp-spike/wit/src/cli/index.ts init
```

Observed:

```bash
WIT_SESSION=agent-a wit declare --description "Edit TS formatter" --files src/app.ts --symbols src/app.ts:formatUser --json
# hasConflicts: false
WIT_SESSION=agent-a wit lock --symbol "src/app.ts:formatUser" --json
# acquired
WIT_SESSION=agent-c wit declare --description "Also edit TS formatter" --files src/app.ts --symbols src/app.ts:formatUser --json
# INTENT_OVERLAP
WIT_SESSION=agent-c wit lock --symbol "src/app.ts:formatUser" --json
# LOCK_CONFLICT, exit 1
```

Non-code observations:

```bash
WIT_SESSION=agent-b wit declare --description "Edit JSON config" --files config/settings.json --json
# hasConflicts: false
WIT_SESSION=agent-b wit lock --symbol "config/settings.json:featureFlags" --json
# acquired
WIT_SESSION=agent-d wit lock --symbol "config/pipeline.yaml:pipeline" --json
# acquired
```

This is useful cooperative locking, but for JSON/YAML it is string-level, not AST-backed. Wit source/docs state parser-supported extensions are `.ts`, `.tsx`, `.js`, `.jsx`, `.py`; contract proposal can return `SYMBOL_NOT_FOUND` for unsupported language/symbol.

### ScopeLock

Scheduler:

```bash
node "$SCOPELOCK" contract new --id ts-format --task "Edit TS formatter" --planned "src/**" --out plans/ts-format.json
node "$SCOPELOCK" contract new --id py-service --task "Edit Python service" --planned "py/**" --out plans/py-service.json
node "$SCOPELOCK" contract new --id json-config --task "Edit JSON config" --planned "config/*.json" --out plans/json-config.json
node "$SCOPELOCK" contract new --id yaml-config --task "Edit YAML pipeline" --planned "config/*.yaml" --out plans/yaml-config.json
node "$SCOPELOCK" contract new --id config-all --task "Edit all config" --planned "config/**" --out plans/config-all.json
node "$SCOPELOCK" plan-parallel plans/independent-plan.json --json
node "$SCOPELOCK" plan-parallel plans/conflict-plan.json --json
```

Observed:

```json
{
  "planId": "polyglot-independent",
  "waves": [["json-config", "py-service", "ts-format", "yaml-config"]],
  "conflicts": []
}
```

```json
{
  "planId": "polyglot-conflict",
  "waves": [["config-all"], ["json-config", "yaml-config"]],
  "conflicts": [
    {"a": "config-all", "b": "json-config", "kind": "write-write", "witness": "config/.json"},
    {"a": "config-all", "b": "yaml-config", "kind": "write-write", "witness": "config/.yaml"}
  ]
}
```

Pre-write gate:

```bash
node "$SCOPELOCK" approve plans/ts-format.json --json
# set .scopelock/config.json mode=strict in scratch repo

printf '{"tool_input":{"file_path":"config/settings.json"}}' | node "$SCOPELOCK" hook gate
# ScopeLock: changed outside approved scope: config/settings.json
# exit 2

printf '{"tool_input":{"file_path":"src/app.ts"}}' | node "$SCOPELOCK" hook gate
# exit 0
```

## Decision for Step 5.1

Build:

- `packages/mcp` only if it remains a thin adapter over existing core/CLI behavior.
- Tools:
  - `plan_parallel(plan)` returns waves, conflicts, cycles.
  - `scopes_conflict(a,b)` returns conflict boolean and witness.
  - `check_drift()` returns current ScopeLock drift report for the active contract.
- Prompt/injection addition: before finishing, call `check_drift` and resolve violations.

Do not build:

- A generic MCP enforcer with scope/test/risk/reviewer scoring.
- A daemon/background checker clone.
- A broad agent orchestration runner.
- An LLM planner.

## Sources

- Local clone: `/tmp/scopelock-mcp-spike/agent-guardrails`
- Local clone: `/tmp/scopelock-mcp-spike/wit`
- GitHub: https://github.com/logi-cmd/agent-guardrails
- GitHub: https://github.com/amaar-mc/wit
- npm package checked: `agent-guardrails@0.20.0`, `wit-protocol@0.1.3`
