# @mindthediff/core

Deterministic contracts, drift checks, scheduling, hook policy, worktree
isolation, and release-evidence schemas for
[MindTheDiff](https://github.com/Daewooox/MindTheDiff), a local flight-control
tool for AI coding agents. This package is the reusable library surface;
most users should install [`@mindthediff/cli`](https://www.npmjs.com/package/@mindthediff/cli)
instead and use `core` only when embedding MindTheDiff's rules in another tool.

## What's in here

- **Schemas** (`schemas/*`) — Zod schemas for contracts, drift reports,
  repository manifests, config, agent-workspace manifests, and
  release-evidence records. Every schema is versioned
  (`CONTRACT_SCHEMA_VERSION`, etc.) so consumers can detect breaking changes.
- **Drift engine** (`drift/*`) — compares a git repository's actual changes
  against an approved contract's scope and produces a structured report.
- **Rules** (`rules/*`) — path classification, risk detection, missing-test
  heuristics, and fail-closed finding-action resolution.
- **Scheduling** (`schedule/*`) — conflict detection between task scopes
  (write-write and read-write hazards) and safe execution stage ordering.
- **Harness adapters** (`harness/*`) — hook installation/merge logic for
  Claude Code, Codex, and Cursor.
- **Git primitives** (`git/*`) — status, diff, worktree, and a push-loss
  safety guard, all shelling out to the real `git` binary, no libgit2 binding.

## Usage

```ts
import { approvedContractSchema, buildDriftReport } from "@mindthediff/core";

const contract = approvedContractSchema.parse(contractJson);
const report = buildDriftReport({ contract, changedPaths, repoRoot });
```

Full API surface, the CLI built on top of it, and the complete conceptual
model are documented in the
[main repository](https://github.com/Daewooox/MindTheDiff) — see
[`docs/reference.md`](https://github.com/Daewooox/MindTheDiff/blob/main/docs/reference.md)
for the CLI/config reference this package's schemas back.

MIT licensed. Requires Node.js 22 or newer.
