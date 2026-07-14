# ScopeLock reference

This page contains the detailed command and configuration notes kept out of the
main README. Run `scopelock <command> --help` for the exact options supported by
your installed version.

## Commands

| Command | What it does |
|---|---|
| `scopelock setup` | Initialize the repository, diagnose installed agents, and report hook confidence. |
| `scopelock init` | Create `.scopelock/` config, contracts, and reports. |
| `scopelock doctor` | Check git, Node, config, the active contract, and hooks. |
| `scopelock task start [description]` | Guide one task from friendly paths to a reviewed, approved contract and agent preflight. |
| `scopelock task finish` | Check the active task boundary and create JSON and HTML drift reports. |
| `scopelock contract new` | Create a schema-valid draft contract without an LLM. |
| `scopelock contract approve <file>` | Save a contract and capture the current git baseline. `--no-activate` saves it without making it active. |
| `scopelock contract rebaseline [<id>]` | Move a contract baseline after a rebase, squash, or history rewrite. |
| `scopelock contract export --target <id>` | Print the active contract as agent instructions. |
| `scopelock contract inject --target <id>` | Put the contract in `AGENTS.md` or `CLAUDE.md`. |
| `scopelock hooks install --target <id>` | Add ScopeLock entries to an agent's hook config. |
| `scopelock hooks uninstall --target <id>` | Remove only ScopeLock-owned hook entries. |
| `scopelock hooks verify --target codex` | Run a harmless live hook probe without disabling sandbox protections. |
| `scopelock check-drift` | Compare repository changes with the approved contract. |
| `scopelock manifest` | Build a metadata-only manifest from tracked git files. |
| `scopelock plan schedule <plan.json>` | Detect conflicts and build safe execution stages. |
| `scopelock plan compose <plan.json> --target <codex\|claude\|cursor>` | Render task contracts into explicit, reviewable agent argv commands. Cursor plans require isolation. |
| `scopelock plan prepare <plan.json> --target <id> --out <path>` | Validate, schedule, preflight, and compose a separate ready plan without running it. |
| `scopelock agents preflight --manifest <path>` | Verify rules, skills, copies, parity, and hook capability. |
| `scopelock run <plan.json>` | Dispatch a reviewed plan and write a bounded receipt. |
| `scopelock report <result.json> --open` | Render a run receipt or drift result as a standalone local HTML Flight Report. |

`--json` is available on every command for machine-readable output.

## Guided setup

`scopelock setup` is the idempotent starting point. It composes the existing
`init`, doctor, and hook-probe behavior; it does not authenticate or run an
agent. In a terminal it offers missing hooks only for detected agents and shows
the exact config file before each confirmation. All confirmations are collected
before the first hook file is changed.

In a pipe or CI job, setup is diagnosis-only and never waits for input. An
explicit non-interactive install requires both intent and confirmation:

```bash
scopelock setup --target claude --install-hooks --yes --mode strict
```

Use `--local` only when running ScopeLock from a source checkout before the
`scopelock` binary is on `PATH`. Repeating setup with an already-correct config
does not rewrite it. Existing non-ScopeLock hook entries are preserved.

The readiness table distinguishes capability from evidence: Claude supports a
documented pre-write deny, Cursor remains post-write audit-only, and Codex is
reported as degraded unless a matching live-verification record exists.

## Guided task start

`scopelock task start` is the guided layer over the existing contract commands.
It asks for a task, agent, paths that may change, blocked paths, advisory task
context, and required test types. Friendly directory inputs such as `src` are
compiled to the canonical `src/**` contract pattern. The review shows tracked
file coverage and warns when the scope includes at least half the repository or
known sensitive files.

Approval and instruction injection are separate decisions. Declining approval
leaves a local draft under `.scopelock/drafts/` and creates no approved contract.
After approval, ScopeLock captures the Git baseline and checks the selected
agent environment. It only offers to update `AGENTS.md` or `CLAUDE.md` after
showing the target path. The command does not start an agent, execute tests, or
claim OS-level read containment.

Interactive use:

```bash
scopelock task start
```

Explicit non-interactive use:

```bash
scopelock task start "Add retry handling" \
  --agent codex \
  --allow src/network \
  --allow tests/network \
  --block .env \
  --context src/shared \
  --test unit \
  --yes
```

Without `--yes`, a non-interactive invocation saves the draft and exits `2`
with the exact `scopelock contract approve` command to run after review.
`--inject` explicitly opts into updating the selected agent instruction file.
Advanced users can continue to use `contract new`, `contract approve`, and
`contract inject` independently.

## Guided task finish

`scopelock task finish` compares the current repository with the active task
boundary, saves the drift evidence as JSON, and renders a standalone HTML
Flight Report. It groups changed paths into allowed, blocked, and outside-scope
changes and returns `0` only when the task is cleared. The command is
non-interactive by default; add `--open` to open the generated report in a
browser.

```bash
scopelock task finish
scopelock task finish --open
```

This command verifies repository evidence only. It does not execute the tests
listed in the contract and says so explicitly in both terminal output and
machine-readable results. Use `check-drift` directly when only the underlying
JSON drift primitive is needed. Existing foreign text in `AGENTS.md` or
`CLAUDE.md` is still checked normally; only an exact change to ScopeLock's own
injected marker block is excluded from drift.

### Legacy aliases

Older scripts remain compatible for this release. The aliases below are
hidden from root help so new users see one coherent command model:

| Legacy | Canonical |
|---|---|
| `approve` | `contract approve` |
| `rebaseline` | `contract rebaseline` |
| `export-prompt` | `contract export` |
| `inject-contract` | `contract inject` |
| `plan-parallel` | `plan schedule` |
| `plan fill-commands` | `plan compose` |
| `run --plan plan.json` | `run plan.json` |

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
  deny. Codex deny requires a live-verified project hook. Cursor hooks remain
  audit-only; isolated runs add a separate validate-before-promote patch gate.

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

By default `plan schedule` detects write-write conflicts between task scopes.
Use `--include-read-hazards` to also order a writer before tasks that declare
the same path as a read dependency.

If the resulting read-write dependencies form a cycle, ScopeLock exits `1` and
reports the involved tasks instead of inventing an unsafe order. See
[parallel-workflow.md](parallel-workflow.md) for a complete walkthrough.

`plan prepare` is the reviewable convenience layer over scheduling, environment
checks, and command composition:

```bash
scopelock plan prepare plan.json \
  --target claude \
  --out ready-plan.json
scopelock run ready-plan.json --yes --isolate
```

It requires approved contracts and the selected agent CLI, enables read hazards
by default, and writes nothing when a dependency cycle or environment blocker is
found. Add `--no-read-hazards` only when stale reads are intentionally safe. Add
`--manifest agents.json` to make required rule/skill presence, physical-copy,
and parity violations block preparation too. Without a manifest those static
artifacts are explicitly reported as not configured, not as verified.

Every task command is regenerated through the selected shell-free harness
adapter, including commands already present in the input plan. The input and
output paths must differ. The resulting file is accepted unchanged by `run`,
but preparation does not approve a contract, repair the environment, start an
agent, or bypass `run --yes --isolate`.

## Plan execution and receipts

`scopelock run <plan.json>` is a thin dispatcher, not a generic agent
runtime. Plans containing commands require `--yes`; string shell commands also
require `--allow-shell`.

Compose agent commands into a separate reviewable plan before dispatch:

```bash
scopelock hooks install --target claude --mode strict
scopelock plan compose plan.json --target claude --out enriched-plan.json
scopelock run enriched-plan.json --yes
```

For stronger workspace containment, add `--isolate`:

```bash
scopelock run enriched-plan.json --yes --isolate --receipt receipt.json
```

Each task runs in its own detached Git worktree. ScopeLock accepts only a
whole task patch whose paths match that task's contract, carries accepted
changes into later execution steps, and applies one aggregate patch to the
user working tree at the end. The user repository must be clean and remain at
the same `HEAD`; otherwise dispatch or final promotion fails closed.

Isolated runs are opt-in and produce receipt v5 with per-task patch digests,
path classifications, final-promotion status, and cleanup evidence. The first
release limits a run to 32 tasks and each task/aggregate patch to 50 MiB.
Gitlinks and symlinks are rejected. A signal interrupts children, blocks final
promotion, and runs worktree cleanup. ScopeLock supervises the complete child
process tree: timeout, `SIGINT`, and `SIGTERM` share one termination path, and
the receipt records termination reason, requested signal, escalation, and
platform when a task is interrupted. Windows uses PID-only `taskkill /T /F`;
the receipt does not claim Unix-equivalent process-group proof.

This is Git-workspace containment, not an OS sandbox. A command with ambient
user permissions can still write through an absolute path outside its
worktree. Keep harness-native sandboxes enabled and do not run untrusted plans.

By default, `plan compose` preserves tasks that already have a command. Use
`--force` to replace them. It always generates an argv array, never a shell
string. Generated Claude invocations use `dontAsk`, disable session persistence,
allow only file read/edit tools, and explicitly deny Bash. Put deterministic
test commands in separate plan tasks. The installed strict hook supplies
pre-write scope enforcement; without it, only the final drift check remains.
Cursor composition is available only as an isolation-bound plan:

```bash
scopelock plan compose plan.json --target cursor --out cursor-plan.json
scopelock run cursor-plan.json --yes --isolate --receipt receipt.json
```

`plan compose --target cursor` always writes
`execution.isolation = "required"`. Running that file without `--isolate`
fails with `PLAN_REQUIRES_ISOLATION`; `--yes` and `--allow-shell` cannot bypass
the requirement. The generated argv keeps Cursor's sandbox enabled. ScopeLock
still treats Cursor hooks as audit-only: the worktree patch gate, rather than
a claimed pre-write deny, is the final enforcement boundary.

Other `run` options:

- `--receipt <path>` writes the receipt to a custom path instead of the
  default under `.scopelock/reports/`.
- `--timeout-ms <ms>` bounds each task's process (default 900000 = 15 minutes).
- `--isolate` gates each task patch in a detached worktree and promotes once.
- `--no-check-drift` skips the final `check-drift` step the receipt normally
  includes.
- `--no-read-hazards` schedules using only write-write conflicts (F1),
  ignoring each contract's `readPathPatterns` (F2).
- `--no-defer-write-conflicts` runs write-write conflicts instead of deferring
  one side to a later execution stage.

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

## Release readiness

The workspace packages share one beta version and are packed together:

```bash
pnpm release:pack
pnpm release:smoke
pnpm release:evidence -- --smoke-dir .release-artifacts
```

`release:pack` rejects tarballs containing compiled tests or source maps and
requires a package README, license, manifest, and runtime entrypoint. It writes
SHA-256 digests and file counts to `.release-artifacts/pack-manifest.json`.
`release:smoke` installs all three unpublished tarballs into a clean temporary
project, imports core, starts the CLI, runs `scopelock init`, and completes an
MCP initialize handshake.

The `release-readiness` workflow repeats that install on Linux, macOS, and
Windows and uploads a bounded evidence record. Evidence starts with security
and approval fields as `pending`; configuration presence is never recorded as
a passed check.

The `stage npm beta` workflow is manual and cannot reach npm unless all of the
following are true:

- it runs from `main` and the requested version matches the packed version;
- CodeQL, gitleaks, tests, dependency audit, pack, and smoke gates pass;
- repository variable `NPM_PUBLISH_ENABLED` is exactly `true`;
- confirmation is exactly `stage-<version>`;
- the protected `npm-production` environment is approved;
- npm trusts `publish-npm.yml` for this repository/environment through OIDC.

The workflow uses `npm stage publish`, not direct publication. A maintainer
must review and approve each staged package with npm 2FA before it becomes
public. npm does not allow staged or trusted publishing for a brand-new
package, so the first bootstrap publication remains a separate manual gate.
The `@scopelock` npm scope must also be created and owned by the maintainer;
the release preflight found no existing scope and no authenticated npm account.
No package has been published as part of release-readiness work.
