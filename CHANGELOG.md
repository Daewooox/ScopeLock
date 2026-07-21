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
- Actionable dirty-repository guidance for `run --isolate`: the failure lists
  up to 10 changed paths and offers three safe choices (commit, run from a
  disposable clean clone, or abort) without ScopeLock ever committing,
  stashing, cleaning, or deleting files itself.
- Live `scopelock run` progress for direct and isolated execution: TTYs receive
  a settled failure-first panel, pipes and CI receive flat lifecycle lines, and
  `--json` remains a single progress-free JSON document.
- Live `plan prepare` and `task finish` progress with phase-based reporting: same
  spinner, flat-line, and silent behavior as `run`. Task finish findings now
  visually distinguish blocked, outside-scope, and high-risk findings from clean ones.
- Live `task start` progress shows three phases ("Describe and scope the task",
  "Review and approve", "Connect the agent") in the interactive wizard; scope and
  sensitive-file warnings visually stand out on the review screen.
- `plan prepare`'s Checks section now renders as a failure-first status table
  (colored PASS/WARN/FAIL rows with inline reasons), matching the treatment
  already used by `task finish` and `task start`.
- `check-drift` is multi-contract-aware for `run`'s end-of-run drift check:
  every task's own approved contract is checked, not just whichever contract
  happens to be active, eliminating false-positive outside-scope findings on
  multi-task runs.
- Reproducible npm tarballs, clean-install smoke tests, release evidence, and
  a protected OIDC staging workflow. No npm package has been published yet.
- Deterministic progressive demo plus a real-user and real-repository beta
  validation protocol.
- Reduced-motion-aware animated README replays for Guided task verification and
  Standard multi-agent plan preparation.

Known beta limits: Node.js 22 or 24 is required, APIs may change before 1.0,
and ScopeLock is a workflow guardrail rather than an OS sandbox.
