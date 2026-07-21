# `plan prepare` — failure-first status table

## Problem

`plan prepare`'s human-readable output renders its `Checks` section as a
flat, undifferentiated list of strings (`packages/cli/src/commands/
plan-prepare.ts`, `checks: string[]`, built incrementally via
`checks.push(...)` across the function, consumed by `result()`'s
`renderSections([...{ title: "Checks", lines: checks }...])`). Every line
looks visually equal — a passing "No scope overlaps found" reads the same
as a blocking "Repository validation not detected" — with no color, no
inline reason, no failure-first ordering.

This is a follow-up from Task #0082 (terminal UX progress reporters,
Phases 1-4, PRs #57/#58/#60/#61, merged to `main`), which already brought
this exact failure-first `renderStatusTable` treatment to `task finish`'s
findings table and `task start`'s review-screen warnings. `plan prepare`
was deliberately left out of that work (documented as a separate follow-up
in the Phase 3 plan) because its `checks: string[]` list needed its own
design pass: unlike `task finish`'s findings (a fixed, uniform set of four
categories) or `task start`'s warnings (a single homogeneous list),
`plan prepare`'s checks are a heterogeneous sequence built across multiple
branches of one function, some appearing only on specific failure paths.

## Goals

- Bring the same failure-first visual treatment (bright/colored failing
  rows with inline `↳ reason`, dimmed passing rows) already used by
  `task finish` and `task start` to `plan prepare`'s `Checks` section.
- Zero change to the JSON contract: `data.checks` remains exactly the
  `string[]` it is today, in the same order, for every existing caller
  (scripts, CI, other tooling) that parses `plan prepare --json`.
- Zero change to `exitCode` or control flow — this is a rendering-only
  change.

## Non-goals

- Restructuring `data.checks` itself into an object array (rejected —
  breaks JSON consumers for no functional gain; confirmed with the
  project maintainer during design).
- Touching `Execution stages` or any other `renderSections` block.
- Any change to `plan-parallel.ts`, `agents-preflight.ts`,
  `plan-fill-commands.ts`, or any other command `plan prepare` calls into.
- Progress-reporter `phase` events (`scheduling`/`preflight`/`composing`)
  — already wired in Phase 3, untouched here.

## Design

### Parallel row construction

`checks: string[]` continues to be built exactly as today — same
`checks.push(...)` calls, same points in the function, same strings, same
order. It remains the sole source of `data.checks` in the JSON contract.

Alongside it, a new `checkRows: StatusRow[]` array is built in parallel:
every point that pushes onto `checks` also pushes a matching `StatusRow`
onto `checkRows`, using the `StatusRow`/`StatusRowStatus` types already
defined in `packages/cli/src/ui.ts` (`{ id, status, cells, reason? }`,
`status: "pass" | "warn" | "fail"`).

`result()`'s signature changes from reading `data.checks as string[]`
internally to accepting `checkRows: StatusRow[]` as an explicit parameter,
so `checkRows` can never leak into `data` (and therefore never into JSON
output) — it exists only for rendering. The `Checks` section's `lines`
becomes the single string returned by `renderStatusTable("Check",
["Detail"], checkRows)`, a one-column table (`id` = short label, one
`Detail` cell) that mirrors today's `"label  value"` string shape, just
with color, dimming, and inline reasons layered on top.

### Row-by-row mapping

Every existing `checks.push(...)` call gets a paired `checkRows.push(...)`
call, mapped as follows:

| Source | id | status | cells | reason (when set) |
|---|---|---|---|---|
| Scope overlaps (initial array entry) | `"Scope overlaps"` | `pass` if `schedule.conflicts.length === 0`, else `warn` | `["No overlaps found"]` or `["${count} ordered safely"]` | when `warn`: `"overlapping scope was reordered into separate stages"` |
| Unschedulable groups (cycles path) | `"Unschedulable groups"` | `fail` | `["${count} read-write group(s)"]` | `"circular dependencies block scheduling"` |
| `{agent} CLI` | `` `${HARNESSES[target].label} CLI` `` | `pass` if found, else `fail` | `[executable.found ? "found" : "not found"]` | when `fail`: `"install the target agent's CLI"` |
| Hook confidence | `"Hook confidence"` | `pass` if `"live-verified"` or `"documented"`, else `warn` (`"degraded"`) | `[hook.capabilities.confidence]` | when `warn`: `"project trust could not be verified statically"` |
| Rules and skills (manifest supplied) | `"Rules and skills"` | direct passthrough of `workspace.summary.status` (`"pass" \| "warn" \| "fail"`) | `[workspace.summary.status]` | when not `pass`: `"${workspace.summary.violationsCount} violation(s) found"` |
| Rules and skills (no manifest) | `"Rules and skills"` | `warn` | `["not configured"]` | `"no manifest supplied"` |
| Repository validation not detected | `"Repository validation"` | `fail` | `["not detected"]` | `"pass --validation-check to supply one"` |
| Agent commands composed | `"Agent commands"` | `pass` | `["${readyPlan.tasks.length} composed"]` | — |
| Validation setup | `"Validation setup"` | `pass` | `[composedValidation.setup.join(" ")]` | — |
| Validation cwd | `"Validation cwd"` | `pass` | `[validationCwd]` | — |
| Per-check validation line | `` `Validation check ${check.id}` `` | `pass` | `[` `required=${check.required}${check.cwd ? \` cwd=${check.cwd}\` : ""} ${check.command.join(" ")}` `]` | — |

This table is the full, exact spec for the implementation plan — no
placeholder rows, no "TBD" statuses.

### Error handling

No new error paths are introduced. Every branch that currently returns
early (`cycles.length > 0`, environment needs attention, composition
unsupported, validation not detected) already has its matching `checks`
entries pushed before the return; `checkRows` mirrors that exactly, so
every `result()` call site gets a `checkRows` array whose rows correspond
1:1 to that call's `checks` at that point.

### Testing

Existing `cli.test.ts` tests for `plan prepare` that assert on exact
substrings of the human output (e.g. `/No scope overlaps found/`) continue
to pass as long as the substrings the tests check for still appear
verbatim inside the rendered table's `Detail` cells — `renderStatusTable`
preserves cell text, it only adds color codes, dimming, and reason lines
around it. Where a test currently asserts on the full concatenated string
(label + value in one string, e.g. `/Hook confidence\s+degraded/`), the
implementer must re-check it against the split id/cells table layout and
update the regex to match across the two columns, following the exact
precedent set in Phase 4 (`task-start.ts`'s "warns when the allowed scope
covers..." test, which was split into two separate regexes for the same
reason). No new behavioral test cases are required — this is a rendering
change, not new functionality — but the implementer must run the existing
`plan prepare` test suite and fix any assertion whose literal-string
expectation no longer matches the new table layout.

## Verification

- `pnpm typecheck && pnpm build && pnpm test` all green, no regressions
  outside the updated `plan prepare` test assertions.
- `data.checks` byte-identical (same strings, same order) between the
  pre- and post-change JSON output for a representative `plan prepare
  --json` run in each of the four branches (cycles, env-needs-attention,
  composition-unsupported, success).
- `node packages/cli/dist/index.js check-drift` clean under this task's
  ScopeLock contract.
