# ScopeLock Threat Model

## What ScopeLock Protects

- Accidental edits outside an approved contract.
- Agent edits to forbidden files when a supported pre-write hook is active.
- Multi-agent write/write and read/write hazards before dispatch.
- Silent mutation of approved contracts, config, and ScopeLock-owned hook
  entries through a local approval integrity seal. A seal mismatch always
  denies, regardless of the enforcement mode the (possibly tampered) config
  claims - otherwise an attacker could downgrade `mode` to `warn` as part of
  the same edit that breaks the seal and defeat detection of that edit.
- Receipt secret leakage by default, using redacted bounded previews.
- Opt-in isolated plan execution keeps task changes in detached Git worktrees,
  rejects a whole patch on any forbidden/outside/unsupported path, and applies
  one sealed aggregate patch only after revalidating the user's clean `HEAD`.
- `--allow-shell` gating covers both string-form commands and argv-array
  invocations of a shell interpreter with an inline-command flag (e.g.
  `["sh", "-c", "..."]`, `["cmd", "/c", "..."]`), not just literal strings.
- Any future automatic response to a finding must be gated by
  `resolveFindingAction`: unclassified, unknown, absent, or malformed actions
  resolve to `ask-user`, never `auto-fix`.

## What ScopeLock Does Not Protect

- A malicious same-user shell process with full filesystem access.
- Absolute-path writes outside a task worktree. Worktree isolation is a
  Git-level workspace boundary, not a kernel or filesystem sandbox.
- Kernel, filesystem, terminal, editor, or GitHub runner compromise.
- Agent actions through harness surfaces that do not expose trustworthy hooks.
- User-approved executable plans from an untrusted source.
- Secrets printed by tools when raw output storage is explicitly enabled.

## Trust Boundaries

- `plan.json` is executable code when it contains commands. `scopelock run`
  requires `--yes`; shell strings additionally require `--allow-shell`.
- `run --isolate` claims `workspace-gated`, never OS-sandboxed. It requires a
  clean repository, rejects symlink/gitlink promotion, caps plans at 32 tasks
  and patches at 50 MiB, and blocks final promotion after interruption or base
  drift. Harness-native sandboxing remains an independent required layer.
- Commands produced by `plan prepare` or the lower-level `plan compose` are
  reviewable argv arrays and pass through the same `run <plan> --yes` trust
  gate as hand-written commands. Preparation never starts an agent.
- Cursor-composed plans carry `execution.isolation = "required"` and are
  rejected before dispatch unless `--isolate` is present. The generated argv
  keeps Cursor's native sandbox enabled; `--yes` and `--allow-shell` do not
  weaken the mode binding.
- Spawned agent commands are supervised as process trees. Timeout, `SIGINT`,
  and `SIGTERM` use one cleanup path, and isolated worktrees are removed only
  after the tree is reaped. Unix uses a detached process group; Windows uses a
  numeric PID-only `taskkill /T /F` invocation and does not claim equivalent
  process-group observability.
- Generated Claude Code commands use `dontAsk`, expose only file read/edit
  tools, deny Bash, and rely on the installed ScopeLock pre-write hook for
  scope enforcement. Without that hook, enforcement is post-run drift only.
  Tests and other shell commands remain separate plan tasks.
- Approved contracts are trusted only while their local integrity seal matches.
- ScopeLock does not push today. Any future path that constructs a `git push`
  must call `checkPushSafety` against the live remote first and refuse to
  discard unincorporated remote commits without an explicit user override.
  The push must bind atomically to the returned lease snapshot with an explicit
  `--force-with-lease=<ref>:<expected-sha>` (including the missing-ref case),
  rather than relying on a check-then-push sequence alone.
- Claude Code pre-write hooks can block known file-edit events. Cursor is
  treated as post-write audit. Codex hook confidence starts `degraded` and is
  only upgraded to `live-verified` by an explicit `hooks verify --target
  codex` run whose recorded digest matches the current hook config - never
  automatically or from static inspection alone.
- MCP tools are pinned to the server repository root and reject absolute or
  escaping contract paths.
- npm release candidates are packed and clean-installed before promotion.
  The OIDC token permission exists only in the protected staging job; that job
  also requires `main`, an exact version confirmation, an explicit repository
  enable flag, and `npm-production` environment approval. It stages packages
  for a separate npm 2FA review instead of making them public immediately.
  The first publication cannot use npm trusted/staged publishing because the
  packages and `@scopelock` scope do not exist yet and therefore remains a
  separate manual bootstrap risk, never an automated fallback to a long-lived
  token.

## Current Release Decision

Security M0 and the adversarial hardening pass are complete for the current
local pilot surface. ScopeLock remains pre-1.0 and suitable for informed local
pilots whose users understand that it is a guardrail, not a sandbox. Public
npm distribution has separate packaging and release gates.
