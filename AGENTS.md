# Memory Bank workflow (generic)

This project uses Memory Bank — structured project memory in `memory-bank/`.

## Before any task

Read:
1. `memory-bank/README.md` (once per session)
2. `memory-bank/tasks.md` (active tasks)
3. `memory-bank/activeContext.md` (current focus)

## Task workflow

```
/van → /plan → /creative → /build → /reflect → /archive
```

- L1 (quick fix): /van → /build → /archive
- L2 (improvement): /van → /plan → /build → /reflect → /archive
- L3 (feature): /van → /plan → /creative → /build → /reflect → /archive
- L4 (system): full cycle + phased build

Lessons are extracted incrementally in `/reflect` (step 3a) → `reflection/lessons-registry.md`.

## Reading discipline (token economy)

- Before any Glob/Grep/Read over `src/` — first read `memory-bank/docs/component-map.md`.
- For `system-patterns/` and `style-guide/` — always start with `_index.md`, then read only the specific file.
- For `plans/`, `archive/`, `reflection/`, `creative/` — never bulk-read. Only the specific file by reference.
- codegraph (if installed): structural questions "where is symbol X / who calls it" — ask the graph (`codegraph_*` or `memory-bank/codegraph/graph.json`) before `grep`. It's a lead, not a completeness proof — verify blast-radius in the code.

## Concurrency

Shared files in `memory-bank/` can contain blocks from different tasks/agents. They are protected by HTML markers `<!-- TASK #NNNN BEGIN ... END -->`. **Never modify someone else's block.** Only edit your own. When unsure, ask the user.

## Edit, not Write

For shared `memory-bank/` files (tasks.md, activeContext.md, progress.md, projectbrief.md, productContext.md, techContext.md) — use Edit only, never overwrite with Write.

## Round/Iteration

If the user reports a **recurrence of an already-fixed bug** — it's a **round N+1 of the same task**, not a new task. Increment `Iteration:` in the BEGIN block and add a line to `Round-history:`.

## Codex CLI users

Use the adapter prompts in `memory-bank/docs/codex-*.md` — they are concise versions of the slash commands.

<!-- SCOPELOCK CONTRACT BEGIN -->
# ScopeLock Contract: self-dogfood-docs-config-2026-07-05

Target: Codex CLI

## Task
Dogfood ScopeLock docs and hook configuration changes on the ScopeLock repository

## Approved Scope
- AGENTS.md
- .claude/settings.json
- .cursor/hooks.json
- memory-bank/activeContext.md
- memory-bank/tasks.md
- memory-bank/plans/checkpoint-dogfood-validation.md
- memory-bank/plans/scopelock-implementation-plan.md

## Forbidden
- packages/core/src/schemas/**
- packages/core/src/hook/**
- packages/cli/src/commands/hook.ts
- packages/cli/src/commands/hooks.ts

Do NOT modify these paths. If the task requires it, stop and ask before editing.

## Required Tests
- No explicit test requirement.

## Assumptions
- This checkpoint should only touch docs, Memory Bank, and hook configuration files.
- Runtime hook logic is already implemented and should not change during dogfood.

## Open Questions
- Mode is currently global in .scopelock/config.json, not per-target.
- Installed hook command uses scopelock from PATH; before npm distribution local users may need a wrapper or link.

## Final Instruction
Stay inside the approved scope, run the required tests when relevant, and stop to ask when the change appears to require forbidden or unapproved files.
<!-- SCOPELOCK CONTRACT END -->
