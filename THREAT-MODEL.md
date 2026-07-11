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
- `--allow-shell` gating covers both string-form commands and argv-array
  invocations of a shell interpreter with an inline-command flag (e.g.
  `["sh", "-c", "..."]`, `["cmd", "/c", "..."]`), not just literal strings.

## What ScopeLock Does Not Protect

- A malicious same-user shell process with full filesystem access.
- Kernel, filesystem, terminal, editor, or GitHub runner compromise.
- Agent actions through harness surfaces that do not expose trustworthy hooks.
- User-approved executable plans from an untrusted source.
- Secrets printed by tools when raw output storage is explicitly enabled.

## Trust Boundaries

- `plan.json` is executable code when it contains commands. `scopelock run`
  requires `--yes`; shell strings additionally require `--allow-shell`.
- Approved contracts are trusted only while their local integrity seal matches.
- Claude Code pre-write hooks can block known file-edit events. Cursor is
  treated as post-write audit. Codex hook confidence remains degraded until a
  safe live probe exists.
- MCP tools are pinned to the server repository root and reject absolute or
  escaping contract paths.

## Current Release Decision

Public beta requires passing Security M0 and a final adversarial review. Until
then, ScopeLock is suitable for informed local pilots where users understand
that it is a guardrail, not a sandbox.
