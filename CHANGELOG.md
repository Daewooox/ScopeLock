# Changelog

All notable changes to ScopeLock will be documented here.

## 0.1.0-beta.1 - Unreleased

- Scope contracts, deterministic drift checks, and agent hook enforcement.
- Progressive CLI with Guided `setup`, `task start`, and `task finish` flows.
- Reviewable `plan prepare` compilation over scheduling, preflight, and
  shell-free agent commands without hidden execution.
- Conflict-aware multi-agent execution stages and explicit harness commands.
- Opt-in worktree isolation with validate-before-promote patch gates.
- Bounded receipts, standalone Flight Reports, and environment preflight.
- Ordered named validation checks with required/optional semantics, explicit
  acceptance ids, and receipt v6 evidence for execution, scope, validation,
  acceptance, promotion, and cleanup.
- Capability-aware agent prompts: the non-interactive `plan fill-commands`
  command no longer asks the agent to search for MCP or call `check_drift`
  itself, since `scopelock run` already owns authoritative validation and the
  final scope/drift check. Interactive prompts (`export-prompt`,
  `inject-contract`) are unchanged and still ask for these `if available`.
- Cross-platform process-tree supervision and fail-closed security hardening.
- Reproducible npm tarballs, clean-install smoke tests, release evidence, and
  a protected OIDC staging workflow. No npm package has been published yet.
- Deterministic progressive demo plus a real-user and real-repository beta
  validation protocol.
- Reduced-motion-aware animated README replays for Guided task verification and
  Standard multi-agent plan preparation.

Known beta limits: Node.js 22 or 24 is required, APIs may change before 1.0,
and ScopeLock is a workflow guardrail rather than an OS sandbox.
