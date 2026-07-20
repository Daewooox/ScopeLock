# Terminal UX: live progress, failure-first tables, Guided wizard feel

Date: 2026-07-20
Status: approved design, not yet implemented

## Problem

ScopeLock's CLI is silent during every multi-step command until it prints
one final block. Three concrete pain points:

1. `run --isolate` gives zero feedback while waves of tasks and ordered
   validation checks run (agent dispatches can take tens of seconds to a
   few minutes each) — the terminal looks hung.
2. Result tables (`renderTable` in `packages/cli/src/ui.ts`) give every row
   equal visual weight. A failing/blocked row looks the same as a passing
   one except for the color of one word, and the failure reason isn't
   inline — the user has to open the JSON receipt to find out why.
3. The Guided flow (`task start` → `task finish`) is a flat sequence of
   `question()`/`confirm()` prompts and plain text sections
   (`renderSections`). There's no sense of "step 2 of 4," and the
   pre-approval review screen is undifferentiated text, including scope
   warnings that read the same as any other line.

## Goals

- Live, redrawing terminal feedback during `run` (both `--isolate` and
  direct), `plan prepare`, and `task finish`.
- A failure-first table style: failing/blocked rows visually dominate with
  an inline truncated reason; passing rows recede (dim). Grouping (by wave,
  by required/optional check) carries through from the live view into the
  final static table — they are the same object at different points in time,
  not two different renderers.
- A wizard feel for `task start`/`task finish`: step-of-N headers, and a
  review screen that reuses the failure-first table's visual language for
  warnings (broad scope, sensitive paths) instead of flat `Warning ...`
  lines.
- Zero behavior change for `--json` output and for piped/non-TTY output
  beyond an added flat line log (see below) — machine-readable output must
  stay byte-for-byte compatible.

## Non-goals

- No new runtime dependency. `packages/cli` currently depends on only
  `commander`; this stays true. No `ink`, `blessed`, `listr2`, `cli-progress`,
  etc.
- No emoji. ASCII/braille-spinner + existing ANSI color codes only, matching
  the project's current `PASS`/`WARN`/`FAIL`/`SKIP` visual language.
- Not a general-purpose TUI framework. This is scoped to ScopeLock's own
  four consuming commands, not a reusable library for other projects.
- Not a change to any command's `CommandResult` shape, exit codes, or JSON
  output. Progress reporting is additive/interstitial only.

## Approach: event-driven reporter

Commands do not know how progress is displayed. Each of the four commands
emits structured lifecycle events through an injected `ProgressReporter`;
two concrete reporters (plus a no-op) implement the same interface and are
chosen once, up front, based on the output mode. This mirrors the existing
dependency-injection pattern already used for `question`/`confirm` in
`task-start.ts`, and keeps business logic (`run-plan.ts`, `plan-prepare.ts`,
`task-finish.ts`, `task-start.ts`) decoupled from presentation — the same
separation `CommandResult.data` vs `CommandResult.human` already draws for
final output, extended to interim output.

Rejected alternative: imperative redraw calls scattered directly inside the
command functions. Simpler to write, but couples business logic to terminal
presentation, is hard to unit-test without a real or emulated TTY, and would
make three unrelated command files responsible for ANSI cursor math.

## Components

### `packages/cli/src/progress/types.ts`

```ts
export type ProgressEvent =
  | { type: "wave-start"; wave: number; totalWaves: number; taskIds: string[] }
  | { type: "task-start"; id: string }
  | { type: "task-done"; id: string; status: "passed" | "failed" | "blocked" | "skipped"; durationMs: number }
  | { type: "check-start"; id: string; required: boolean }
  | { type: "check-done"; id: string; status: "passed" | "failed" | "skipped"; durationMs: number; skipReason?: string }
  | { type: "phase"; name: "validating" | "promoting" | "cleaning-up" }
  | { type: "step"; index: number; total: number; label: string }
  | { type: "interrupted" };

export type ProgressReporter = { emit(event: ProgressEvent): void; dispose(): void };
```

`dispose()` stops any interval timer (spinner tick) and leaves the terminal
in a clean state; commands call it in a `finally` block, matching the
existing `coordinator.dispose()` pattern in `run-plan.ts`.

### `packages/cli/src/progress/reporter.ts`

`createReporter(stream: NodeJS.WriteStream, options: { json: boolean })`:

- `options.json === true` → `NoopReporter` (emit is a no-op).
- `stream.isTTY === true && supportsColor` (reuse the existing check from
  `ui.ts`) → `LivePanelReporter`.
- otherwise → `LineReporter`.

### `LivePanelReporter`

Holds an ordered list of rows (wave headers, task rows, check rows) keyed by
id. On each event: update the row's state, then repaint — move the cursor up
by the previously-drawn line count (`\x1b[<n>A`), clear each line
(`\x1b[2K`), and rewrite. A single `setInterval` (only running while at
least one row is `running`) advances the braille spinner frame and triggers
a repaint tick; disposed when no row is running or on `dispose()`.

On `interrupted` or after the last event, the panel does **one final
repaint** using the failure-first table renderer (below) instead of its own
row format — the live view settles into the exact static summary a
non-interactive run would have printed, so there's no jarring swap between
"live" output and "final" output.

### `LineReporter`

One line per event, no repaint, no timestamps (avoids noisy diffs in CI
logs piped to files): `[wave 1] auth-fragment-run1: passed (12.4s)`,
`[validation] redirect-test: passed`. Respects `NO_COLOR` via the existing
`stripAnsi` helper in `ui.ts`.

### `renderStatusTable` (extends `ui.ts`)

New table renderer alongside `renderTable`: failing/blocked rows keep full
saturation and bold, and get one inline sub-row directly beneath with a
truncated reason (`stderr`/`skipReason`/finding `detail`, ~100 chars) plus
`(full log: <path>)` when a raw artifact path exists in the receipt.
Passing rows render dim. Rows are grouped exactly as the live panel grouped
them (by wave; by required-then-optional for checks) — same grouping logic,
shared, not reimplemented per renderer.

### Guided wizard additions (`task-start.ts`, `task-finish.ts`)

- `wizardStep(index, total, label)` — a one-line header
  (`Step 2 of 4 — Review scope`) printed via the reporter's `step` event
  before each interactive phase (describe → scope → tests → review/approve
  → environment/inject).
- The review screen (currently a flat `renderSections` block in
  `task-start.ts`) is rebuilt on `renderStatusTable`: scope-coverage and
  sensitive-path warnings render with the same visual weight as a failing
  check, instead of a plain `Warning ...` text line.

## Data flow example: `run --isolate`

```
wave-start(1, taskIds=[a,b]) 
  task-start(a) → task-done(a, passed, 43000ms)
  task-start(b) → task-done(b, blocked, ...)
phase("validating")
  check-start(redirect-test, required) → check-done(redirect-test, passed, ...)
  check-start(analyze, required) → check-done(analyze, passed, ...)
phase("promoting")
phase("cleaning-up")
dispose()
```

The command's returned `CommandResult` (`data`/`human`/`exitCode`) is
unchanged in shape — it is still computed and returned exactly as today;
the reporter events are strictly additional, interim output.

## Error handling

- **SIGINT / interrupt mid-run**: the existing `RunSignalCoordinator`
  already marks remaining tasks as skipped/interrupted (`run-plan.ts`). The
  reporter must receive a terminal event (`task-done` with `status:
  "skipped"`, then `interrupted`) for every row still `running`, or the live
  panel hangs showing spinners forever. Wire this through the same
  coordinator callback path that already exists.
- **Terminal resize**: no persistent layout state beyond the current row
  list; width is recomputed on the next repaint tick. Acceptable — ScopeLock
  runs are short-lived, not long-running dashboards.
- **`--json`**: `NoopReporter`; zero output change from today, verified by
  existing `--json` tests continuing to pass unmodified.
- **`NO_COLOR`**: both reporters route all coloring through the existing
  `color()` helper in `ui.ts`, which already no-ops when `NO_COLOR` is set —
  neither reporter needs its own `NO_COLOR` check. `LineReporter` reuses the
  existing `stripAnsi` helper only if it ever composes a line from
  already-colored fragments (e.g. reusing a value `color()`'d elsewhere);
  otherwise nothing to strip.
- **Piped stdout mid-session**: `isTTY` is checked once at reporter
  creation, matching the existing `supportsColor` behavior in `ui.ts` — not
  a new risk surface.

## Testing

- `ProgressReporter` is an interface; tests inject a recording fake
  (`{ emit: (e) => events.push(e) }`) into each command and assert the exact
  event sequence/shape — no terminal emulation needed, matching this
  project's deterministic `node:test` style.
- `LivePanelReporter`'s redraw math gets isolated tests against a fake
  writable stream, with `isTTY` forced via a constructor option rather than
  read from `process.stdout.isTTY` (so tests don't depend on the real
  terminal) — assert exact byte sequences for a scripted event sequence.
- `LineReporter` output gets one assertion per event, in the same string-testing
  style already used for `humanReport` in `cli.test.ts`.
- `renderStatusTable` and `wizardStep` are pure functions, tested the same
  way `renderTable` already is.
- Existing tests asserting today's `human`/`data`/exit-code output for
  `run`, `plan prepare`, `task finish`, `task start` must continue to pass
  unmodified — progress events are additive and must not change final
  output shape.

## Rollout

This is one coherent design but touches four command files plus new shared
modules — implementation is expected to be phased (tracked in the
implementation plan, not here):

1. Shared `progress/` module (types, `NoopReporter`, `LineReporter`,
   `LivePanelReporter`) + `renderStatusTable`, unit-tested in isolation with
   no command wiring yet.
2. Wire into `run-plan.ts` (`run --isolate` and direct) — the highest-value
   consumer, per the original request.
3. Wire into `plan-prepare.ts` and `task-finish.ts`.
4. Guided wizard pass on `task-start.ts`/`task-finish.ts` (step headers +
   `renderStatusTable`-based review screen).

Each phase should land as its own ScopeLock contract/PR, following this
repo's existing dogfooding convention (fresh approved contract before
touching `packages/**`, TDD, targeted + full verification, no auto-merge
without explicit maintainer permission).
