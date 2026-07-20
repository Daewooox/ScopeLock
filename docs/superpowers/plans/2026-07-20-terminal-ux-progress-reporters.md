# Terminal UX Progress Reporters (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared, standalone progress-reporting library (event types, a no-op/line/live-panel reporter trio, and a failure-first table renderer) that later phases wire into `run`, `plan prepare`, and `task finish` — fully testable in isolation, with zero consumers wired up yet.

**Architecture:** An event-driven `ProgressReporter` interface with three implementations selected by output mode (`--json` → no-op, TTY outside CI → live redrawing panel, everything else → flat line log). Consumers (future phases) will depend only on the `ProgressReporter` interface, never on a concrete reporter class.

**Tech Stack:** TypeScript, Node.js `node:test`/`node:assert/strict`, existing `packages/cli/src/ui.ts` ANSI helpers. No new runtime dependency.

## Global Constraints

- `packages/cli` depends on only `commander` at runtime today; this plan adds zero new dependencies.
- No emoji anywhere. ASCII characters and the existing braille spinner frames (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) only.
- `renderStatusTable`, the reporters, and the factory are pure additions — nothing in this plan modifies any existing exported function's signature or behavior, and no existing test may change.
- Reporter selection: `options.json === true` → no-op; `stream.isTTY === true && process.env.CI !== "true"` → live panel; otherwise → line reporter. `NO_COLOR` is not part of this selection — it only affects whether `color()` (existing helper) emits ANSI color codes when either reporter renders text.
- All new test files follow this project's existing convention exactly: `describe`/`it` from `node:test`, `assert` from `node:assert/strict`, one `.test.ts` file per source file, colocated in the same directory.
- This plan changes `packages/cli/package.json`'s `test` script from `node --test dist/*.test.js` (flat glob — would miss files under `dist/progress/`) to the quoted recursive glob `node --test 'dist/**/*.test.js'` as part of Task 1. (A bare directory argument, `node --test dist`, does not work on this project's Node version — verified during Task 1 — it resolves the directory as the package's entry module instead of discovering tests recursively.)

---

## Prerequisites (before Task 1)

This repository dogfoods ScopeLock on itself: no `packages/**` edit lands
without a fresh approved contract first. Before Task 1:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/terminal-progress-reporters

node packages/cli/dist/index.js contract new \
  --id terminal-progress-reporters-phase1 \
  --task "Add shared progress-reporting library (types, no-op/line/live-panel reporters, factory, failure-first status table) - no wiring into any command yet" \
  --planned "packages/cli/package.json" \
  --planned "packages/cli/src/progress/types.ts" \
  --planned "packages/cli/src/progress/noop-reporter.ts" \
  --planned "packages/cli/src/progress/noop-reporter.test.ts" \
  --planned "packages/cli/src/progress/line-reporter.ts" \
  --planned "packages/cli/src/progress/line-reporter.test.ts" \
  --planned "packages/cli/src/progress/live-panel-reporter.ts" \
  --planned "packages/cli/src/progress/live-panel-reporter.test.ts" \
  --planned "packages/cli/src/progress/create-reporter.ts" \
  --planned "packages/cli/src/progress/create-reporter.test.ts" \
  --planned "packages/cli/src/ui.ts" \
  --planned "packages/cli/src/ui.test.ts" \
  --forbidden "packages/cli/src/commands/**" \
  --forbidden "packages/core/**" \
  --forbidden "packages/mcp/**" \
  --forbidden ".github/workflows/**" \
  --agent claude \
  --out .scopelock/drafts/terminal-progress-reporters-phase1.json

node packages/cli/dist/index.js contract approve \
  .scopelock/drafts/terminal-progress-reporters-phase1.json
```

The `--forbidden packages/cli/src/commands/**` line is deliberate: this
plan must not touch any command file. If a task in this plan seems to need
a command-file edit, stop — that would mean the task drifted into Phase 2
(wiring) scope, which is out of scope here (see the end of this document).

---

### Task 1: Test-runner discovery + shared types + no-op reporter

**Files:**
- Modify: `packages/cli/package.json` (the `"test"` script)
- Create: `packages/cli/src/progress/types.ts`
- Create: `packages/cli/src/progress/noop-reporter.ts`
- Create: `packages/cli/src/progress/noop-reporter.test.ts`

**Interfaces:**
- Produces (used by every later task in this plan): `ProgressEvent` (discriminated union), `ProgressReporter = { emit(event: ProgressEvent): void; dispose(): void }`, `TaskStatus = "passed" | "failed" | "blocked" | "skipped"`, `CheckStatus = "passed" | "failed" | "skipped"`.

- [ ] **Step 1: Fix test-runner discovery for a nested source directory**

Open `packages/cli/package.json` and change the `test` script:

```json
"test": "node --test 'dist/**/*.test.js'"
```

(Was `"node --test dist/*.test.js"` — a flat glob that only matches top-level files, would miss anything under `dist/progress/`. Passing a bare directory (`node --test dist`) does NOT work on this project's Node version — Node v26 resolves a bare directory argument as the package's own entry module and executes it, it does not switch into recursive test-discovery mode. The quoted recursive glob is the correct fix; verified locally: `node --test 'dist/**/*.test.js'` finds files under `dist/progress/` and passes, `node --test dist` does not run tests at all.)

- [ ] **Step 2: Verify the existing suite still runs under the new script**

Run: `pnpm --filter @scopelock/cli build && pnpm --filter @scopelock/cli test 2>&1 | tail -15`
Expected: the same pass count as before this change (all existing `dist/*.test.js` files still found and green) — confirms the directory-mode invocation is at least as inclusive as the old flat glob.

- [ ] **Step 3: Write `types.ts` (no test — pure type declarations, nothing to assert)**

Create `packages/cli/src/progress/types.ts`:

```ts
export type TaskStatus = "passed" | "failed" | "blocked" | "skipped";
export type CheckStatus = "passed" | "failed" | "skipped";

export type ProgressEvent =
  | { type: "wave-start"; wave: number; totalWaves: number; taskIds: string[] }
  | { type: "task-start"; id: string }
  | { type: "task-done"; id: string; status: TaskStatus; durationMs: number }
  | { type: "check-start"; id: string; required: boolean }
  | { type: "check-done"; id: string; status: CheckStatus; durationMs: number; skipReason?: string }
  | { type: "phase"; name: "validating" | "promoting" | "cleaning-up" }
  | { type: "step"; index: number; total: number; label: string }
  | { type: "interrupted" };

export type ProgressReporter = {
  emit(event: ProgressEvent): void;
  dispose(): void;
};
```

- [ ] **Step 4: Write the failing test for the no-op reporter**

Create `packages/cli/src/progress/noop-reporter.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createNoopReporter } from "./noop-reporter.js";

describe("createNoopReporter", () => {
  it("accepts every event type without throwing and dispose is a no-op", () => {
    const reporter = createNoopReporter();
    assert.doesNotThrow(() => {
      reporter.emit({ type: "wave-start", wave: 1, totalWaves: 2, taskIds: ["a"] });
      reporter.emit({ type: "task-start", id: "a" });
      reporter.emit({ type: "task-done", id: "a", status: "passed", durationMs: 100 });
      reporter.emit({ type: "check-start", id: "unit-tests", required: true });
      reporter.emit({ type: "check-done", id: "unit-tests", status: "passed", durationMs: 50 });
      reporter.emit({ type: "phase", name: "promoting" });
      reporter.emit({ type: "step", index: 1, total: 4, label: "Describe" });
      reporter.emit({ type: "interrupted" });
      reporter.dispose();
    });
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `tsc` error, `Cannot find module './noop-reporter.js'` (the module doesn't exist yet).

- [ ] **Step 6: Implement the no-op reporter**

Create `packages/cli/src/progress/noop-reporter.ts`:

```ts
import type { ProgressReporter } from "./types.js";

export function createNoopReporter(): ProgressReporter {
  return {
    emit(): void {},
    dispose(): void {},
  };
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && node --test dist/progress/noop-reporter.test.js`
Expected: PASS, 1 test.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/package.json packages/cli/src/progress/types.ts packages/cli/src/progress/noop-reporter.ts packages/cli/src/progress/noop-reporter.test.ts
git commit -m "feat(cli): add progress event types and a no-op reporter"
```

---

### Task 2: Line reporter (CI / non-TTY fallback)

**Files:**
- Create: `packages/cli/src/progress/line-reporter.ts`
- Create: `packages/cli/src/progress/line-reporter.test.ts`

**Interfaces:**
- Consumes: `ProgressEvent`, `ProgressReporter` (Task 1).
- Produces: `createLineReporter(write: (line: string) => void): ProgressReporter` — used by Task 4's factory.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/progress/line-reporter.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLineReporter } from "./line-reporter.js";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

describe("createLineReporter", () => {
  it("writes one line per event, tagging task lines with the current wave", () => {
    const { lines, write } = collect();
    const reporter = createLineReporter(write);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 2, taskIds: ["a", "b"] });
    reporter.emit({ type: "task-start", id: "a" });
    reporter.emit({ type: "task-done", id: "a", status: "passed", durationMs: 12400 });
    reporter.dispose();
    assert.deepEqual(lines, [
      "[wave 1/2] starting: a, b",
      "[wave 1] a: running",
      "[wave 1] a: passed (12.4s)",
    ]);
  });

  it("formats validation checks (including optional/skip), phases, steps, and interrupted", () => {
    const { lines, write } = collect();
    const reporter = createLineReporter(write);
    reporter.emit({ type: "check-start", id: "redirect-test", required: true });
    reporter.emit({ type: "check-done", id: "redirect-test", status: "passed", durationMs: 600 });
    reporter.emit({ type: "check-start", id: "analyze", required: false });
    reporter.emit({
      type: "check-done", id: "analyze", status: "skipped", durationMs: 0,
      skipReason: "an earlier required check failed",
    });
    reporter.emit({ type: "phase", name: "promoting" });
    reporter.emit({ type: "step", index: 2, total: 4, label: "Review scope" });
    reporter.emit({ type: "interrupted" });
    assert.deepEqual(lines, [
      "[validation] redirect-test: running",
      "[validation] redirect-test: passed (0.6s)",
      "[validation] analyze: running (optional)",
      "[validation] analyze: skipped (0.0s) — an earlier required check failed",
      "[phase] promoting",
      "Step 2 of 4 — Review scope",
      "interrupted",
    ]);
  });

  it("falls back to a bare [task] prefix when no wave-start preceded a task event", () => {
    const { lines, write } = collect();
    const reporter = createLineReporter(write);
    reporter.emit({ type: "task-start", id: "solo" });
    assert.deepEqual(lines, ["[task] solo: running"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './line-reporter.js'`.

- [ ] **Step 3: Implement the line reporter**

Create `packages/cli/src/progress/line-reporter.ts`:

```ts
import type { ProgressEvent, ProgressReporter } from "./types.js";

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function waveLabel(wave: number | null): string {
  return wave === null ? "[task]" : `[wave ${wave}]`;
}

export function createLineReporter(write: (line: string) => void): ProgressReporter {
  let currentWave: number | null = null;

  const emit = (event: ProgressEvent): void => {
    switch (event.type) {
      case "wave-start":
        currentWave = event.wave;
        write(`[wave ${event.wave}/${event.totalWaves}] starting: ${event.taskIds.join(", ")}`);
        return;
      case "task-start":
        write(`${waveLabel(currentWave)} ${event.id}: running`);
        return;
      case "task-done":
        write(`${waveLabel(currentWave)} ${event.id}: ${event.status} (${formatSeconds(event.durationMs)})`);
        return;
      case "check-start":
        write(`[validation] ${event.id}: running${event.required ? "" : " (optional)"}`);
        return;
      case "check-done":
        write(
          `[validation] ${event.id}: ${event.status} (${formatSeconds(event.durationMs)})`
          + (event.skipReason !== undefined ? ` — ${event.skipReason}` : ""),
        );
        return;
      case "phase":
        write(`[phase] ${event.name}`);
        return;
      case "step":
        write(`Step ${event.index} of ${event.total} — ${event.label}`);
        return;
      case "interrupted":
        write("interrupted");
        return;
    }
  };

  return { emit, dispose(): void {} };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && node --test dist/progress/line-reporter.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/progress/line-reporter.ts packages/cli/src/progress/line-reporter.test.ts
git commit -m "feat(cli): add flat line-log progress reporter for CI/non-TTY"
```

---

### Task 3: Live panel reporter (interactive TTY)

**Files:**
- Create: `packages/cli/src/progress/live-panel-reporter.ts`
- Create: `packages/cli/src/progress/live-panel-reporter.test.ts`

**Interfaces:**
- Consumes: `ProgressEvent`, `ProgressReporter`, `TaskStatus`, `CheckStatus` (Task 1).
- Produces: `type Sink = { write(chunk: string): void }`, `createLivePanelReporter(sink: Sink): ProgressReporter` — `Sink` and the factory are used by Task 4's factory.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/progress/live-panel-reporter.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLivePanelReporter } from "./live-panel-reporter.js";

function collect(): { chunks: string[]; sink: { write: (chunk: string) => void } } {
  const chunks: string[] = [];
  return { chunks, sink: { write: (chunk: string) => { chunks.push(chunk); } } };
}

describe("createLivePanelReporter", () => {
  it("draws a wave header and one pending row per task", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a", "b"] });
    reporter.dispose();
    const output = chunks.join("");
    assert.match(output, /Wave 1\/1/);
    assert.match(output, /· a {5}pending/);
    assert.match(output, /· b {5}pending/);
  });

  it("shows a spinner glyph and running state immediately on task-start", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });
    reporter.dispose();
    const output = chunks.join("");
    assert.match(output, /⠋ a {5}running/);
  });

  it("shows a checkmark and duration on task-done", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });
    reporter.emit({ type: "task-done", id: "a", status: "passed", durationMs: 12400 });
    reporter.dispose();
    const output = chunks.join("");
    assert.match(output, /✓ a {5}passed 12\.4s/);
  });

  it("moves the cursor up by the previously drawn line count before each repaint", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });
    reporter.dispose();
    assert.ok(chunks.includes("\u001b[1A"), `expected a cursor-up-1 escape, got: ${JSON.stringify(chunks)}`);
  });

  it("finalizes rows and prints a plain line on a phase change, without a dangling row", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });
    reporter.emit({ type: "phase", name: "promoting" });
    reporter.dispose();
    const output = chunks.join("");
    assert.match(output, /promoting/);
  });

  it("dispose clears the spinner timer so the process can exit", () => {
    const { sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });
    // If dispose() failed to clear the interval, this test file's process
    // would hang past its own duration waiting on an unref'd-but-still-live
    // timer in some environments; asserting dispose() doesn't throw is the
    // practical signal here since node:test doesn't expose active-handle
    // introspection directly.
    assert.doesNotThrow(() => reporter.dispose());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './live-panel-reporter.js'`.

- [ ] **Step 3: Implement the live panel reporter**

Create `packages/cli/src/progress/live-panel-reporter.ts`:

```ts
import type { CheckStatus, ProgressEvent, ProgressReporter, TaskStatus } from "./types.js";

export type Sink = { write(chunk: string): void };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

type RowStatus = "pending" | "running" | TaskStatus | CheckStatus;

type Row = {
  id: string;
  label: string;
  status: RowStatus;
  durationMs?: number;
  skipReason?: string;
};

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function rowGlyph(status: RowStatus, frame: string): string {
  if (status === "pending") return "·";
  if (status === "running") return frame;
  if (status === "passed") return "✓";
  if (status === "failed") return "✗";
  if (status === "blocked") return "!";
  return "○"; // skipped
}

function renderRow(row: Row, frame: string): string {
  const glyph = rowGlyph(row.status, frame);
  const state = row.status === "pending" || row.status === "running" ? row.status : row.status;
  const duration = row.durationMs !== undefined ? ` ${formatSeconds(row.durationMs)}` : "";
  const detail = row.skipReason !== undefined ? ` — ${row.skipReason}` : "";
  return `  ${glyph} ${row.label}     ${state}${duration}${detail}`;
}

export function createLivePanelReporter(sink: Sink): ProgressReporter {
  let rows: Row[] = [];
  let linesDrawn = 0;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | null = null;

  const repaint = (): void => {
    if (linesDrawn > 0) sink.write(`\u001b[${linesDrawn}A`);
    for (const row of rows) {
      sink.write(`\u001b[2K${renderRow(row, SPINNER_FRAMES[frameIndex] ?? "")}\n`);
    }
    linesDrawn = rows.length;
  };

  const ensureTimer = (): void => {
    const anyRunning = rows.some((row) => row.status === "running");
    if (anyRunning && timer === null) {
      timer = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        repaint();
      }, SPINNER_INTERVAL_MS);
      timer.unref();
    }
    if (!anyRunning && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const findOrCreate = (id: string, label: string): Row => {
    const existing = rows.find((row) => row.id === id);
    if (existing !== undefined) return existing;
    const created: Row = { id, label, status: "pending" };
    rows.push(created);
    return created;
  };

  const flush = (): void => {
    repaint();
    rows = [];
    linesDrawn = 0;
  };

  const emit = (event: ProgressEvent): void => {
    switch (event.type) {
      case "wave-start": {
        flush();
        sink.write(`Wave ${event.wave}/${event.totalWaves}\n`);
        for (const id of event.taskIds) findOrCreate(id, id);
        repaint();
        break;
      }
      case "task-start": {
        const row = findOrCreate(event.id, event.id);
        row.status = "running";
        ensureTimer();
        repaint();
        break;
      }
      case "task-done": {
        const row = findOrCreate(event.id, event.id);
        row.status = event.status;
        row.durationMs = event.durationMs;
        ensureTimer();
        repaint();
        break;
      }
      case "check-start": {
        const row = findOrCreate(event.id, event.required ? event.id : `${event.id} (optional)`);
        row.status = "running";
        ensureTimer();
        repaint();
        break;
      }
      case "check-done": {
        const row = findOrCreate(event.id, event.id);
        row.status = event.status;
        row.durationMs = event.durationMs;
        row.skipReason = event.skipReason;
        ensureTimer();
        repaint();
        break;
      }
      case "phase": {
        flush();
        sink.write(`${event.name}\n`);
        break;
      }
      case "step": {
        flush();
        sink.write(`Step ${event.index} of ${event.total} — ${event.label}\n`);
        break;
      }
      case "interrupted": {
        flush();
        sink.write("interrupted\n");
        break;
      }
    }
  };

  return {
    emit,
    dispose(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      flush();
    },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && node --test dist/progress/live-panel-reporter.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/progress/live-panel-reporter.ts packages/cli/src/progress/live-panel-reporter.test.ts
git commit -m "feat(cli): add live redrawing panel progress reporter"
```

---

### Task 4: Reporter factory

**Files:**
- Create: `packages/cli/src/progress/create-reporter.ts`
- Create: `packages/cli/src/progress/create-reporter.test.ts`

**Interfaces:**
- Consumes: `createNoopReporter` (Task 1), `createLineReporter` (Task 2), `createLivePanelReporter`, `type Sink` (Task 3).
- Produces: `type ReporterStream = Sink & { isTTY?: boolean }`, `createReporter(stream: ReporterStream, options: { json: boolean }): ProgressReporter` — this is the only export future phases (run-plan.ts, etc.) will call.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/progress/create-reporter.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReporter } from "./create-reporter.js";

function fakeStream(isTTY: boolean): { isTTY: boolean; write: (chunk: string) => void; chunks: string[] } {
  const chunks: string[] = [];
  return { isTTY, write: (chunk: string) => { chunks.push(chunk); }, chunks };
}

describe("createReporter", () => {
  it("returns a no-op reporter for --json regardless of TTY", () => {
    const stream = fakeStream(true);
    const reporter = createReporter(stream, { json: true });
    reporter.emit({ type: "phase", name: "promoting" });
    reporter.dispose();
    assert.deepEqual(stream.chunks, []);
  });

  it("returns a live panel reporter for an interactive TTY outside CI", () => {
    const previousCi = process.env.CI;
    delete process.env.CI;
    try {
      const stream = fakeStream(true);
      const reporter = createReporter(stream, { json: false });
      reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
      reporter.dispose();
      const output = stream.chunks.join("");
      assert.match(output, /Wave 1\/1/);
      assert.ok(stream.chunks.some((chunk) => chunk.includes("\u001b[2K")));
    } finally {
      if (previousCi === undefined) delete process.env.CI; else process.env.CI = previousCi;
    }
  });

  it("returns a line reporter when CI=true even on a TTY stream", () => {
    const previousCi = process.env.CI;
    process.env.CI = "true";
    try {
      const stream = fakeStream(true);
      const reporter = createReporter(stream, { json: false });
      reporter.emit({ type: "phase", name: "promoting" });
      reporter.dispose();
      assert.deepEqual(stream.chunks, ["[phase] promoting\n"]);
    } finally {
      if (previousCi === undefined) delete process.env.CI; else process.env.CI = previousCi;
    }
  });

  it("returns a line reporter for a non-TTY stream", () => {
    const stream = fakeStream(false);
    const reporter = createReporter(stream, { json: false });
    reporter.emit({ type: "phase", name: "promoting" });
    reporter.dispose();
    assert.deepEqual(stream.chunks, ["[phase] promoting\n"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './create-reporter.js'`.

- [ ] **Step 3: Implement the factory**

Create `packages/cli/src/progress/create-reporter.ts`:

```ts
import { createLineReporter } from "./line-reporter.js";
import { createLivePanelReporter, type Sink } from "./live-panel-reporter.js";
import { createNoopReporter } from "./noop-reporter.js";
import type { ProgressReporter } from "./types.js";

export type ReporterStream = Sink & { isTTY?: boolean };

export function createReporter(stream: ReporterStream, options: { json: boolean }): ProgressReporter {
  if (options.json) return createNoopReporter();
  if (stream.isTTY === true && process.env.CI !== "true") return createLivePanelReporter(stream);
  return createLineReporter((line) => stream.write(`${line}\n`));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && node --test dist/progress/create-reporter.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/progress/create-reporter.ts packages/cli/src/progress/create-reporter.test.ts
git commit -m "feat(cli): add output-mode-aware progress reporter factory"
```

---

### Task 5: Failure-first status table

**Files:**
- Modify: `packages/cli/src/ui.ts`
- Create: `packages/cli/src/ui.test.ts`

**Interfaces:**
- Produces (used by future wiring phases, not by this plan's own tasks): `StatusRowStatus = "pass" | "warn" | "fail" | "skip"`, `type StatusRow = { id: string; status: StatusRowStatus; cells: string[]; reason?: string; logPath?: string }`, `renderStatusTable(idHeader: string, restHeaders: string[], rows: StatusRow[]): string`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/ui.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderStatusTable } from "./ui.js";

describe("renderStatusTable", () => {
  it("dims a passing row's cells and adds no reason line", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "a", status: "pass", cells: ["12.4s"] },
    ]);
    const lines = output.split("\n");
    assert.equal(lines.length, 2); // header + one row, no reason sub-line
    assert.match(lines[1] ?? "", /a/);
  });

  it("keeps a failing row at full brightness and adds a truncated reason sub-line", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "b", status: "fail", cells: ["3.1s"], reason: "assertion failed: expected true, got false" },
    ]);
    const lines = output.split("\n");
    assert.equal(lines.length, 3); // header + row + reason sub-line
    assert.match(lines[2] ?? "", /↳ assertion failed: expected true, got false/);
  });

  it("truncates a long reason and appends the full-log path when present", () => {
    const longReason = "x".repeat(150);
    const output = renderStatusTable("Task", ["Time"], [
      { id: "c", status: "warn", cells: ["1.0s"], reason: longReason, logPath: "/tmp/artifact.txt" },
    ]);
    const reasonLine = output.split("\n")[2] ?? "";
    assert.match(reasonLine, /…/);
    assert.match(reasonLine, /\(full log: \/tmp\/artifact\.txt\)/);
    assert.ok(!reasonLine.includes("x".repeat(150)), "reason should be truncated, not shown in full");
  });

  it("shows a skip reason even though skip is not fail/warn", () => {
    const output = renderStatusTable("Check", ["Time"], [
      { id: "analyze", status: "skip", cells: ["0.0s"], reason: "an earlier required check failed" },
    ]);
    const lines = output.split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[2] ?? "", /↳ an earlier required check failed/);
  });

  it("aligns columns by the widest cell in each column, including the id column", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "short", status: "pass", cells: ["1s"] },
      { id: "a-much-longer-task-id", status: "pass", cells: ["2s"] },
    ]);
    const lines = output.split("\n");
    const headerIdColumnWidth = (lines[0] ?? "").indexOf("Status");
    assert.ok(headerIdColumnWidth >= "a-much-longer-task-id".length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -20`
Expected: FAIL — `renderStatusTable` is not exported from `./ui.js`.

- [ ] **Step 3: Implement `renderStatusTable`**

Open `packages/cli/src/ui.ts`. Add this after the existing `renderSections` function and before `stripAnsi`:

```ts
export type StatusRowStatus = "pass" | "warn" | "fail" | "skip";

export type StatusRow = {
  id: string;
  status: StatusRowStatus;
  cells: string[];
  reason?: string;
  logPath?: string;
};

const REASON_TRUNCATE_LENGTH = 100;

export function renderStatusTable(idHeader: string, restHeaders: string[], rows: StatusRow[]): string {
  const headers = [idHeader, "Status", ...restHeaders];
  const cellsFor = (row: StatusRow): string[] => [row.id, statusLabel(row.status), ...row.cells];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(cellsFor(row)[index] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, index) => padAnsi(cell, widths[index] ?? 0)).join("  ");
  const headerLine = line(headers.map((header) => color(header, "dim")));
  const rowLines = rows.flatMap((row) => {
    const cells = cellsFor(row);
    const rendered = row.status === "pass" ? [line(cells.map((cell) => color(cell, "dim")))] : [line(cells)];
    if (row.status !== "pass" && row.reason !== undefined) {
      const truncated = row.reason.length > REASON_TRUNCATE_LENGTH
        ? `${row.reason.slice(0, REASON_TRUNCATE_LENGTH)}…`
        : row.reason;
      const logSuffix = row.logPath !== undefined ? ` (full log: ${row.logPath})` : "";
      rendered.push(color(`    ↳ ${truncated}${logSuffix}`, "dim"));
    }
    return rendered;
  });
  return [headerLine, ...rowLines].join("\n");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @scopelock/cli build && node --test dist/ui.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/ui.ts packages/cli/src/ui.test.ts
git commit -m "feat(cli): add failure-first renderStatusTable"
```

---

## Final verification (run once, after Task 5)

- [ ] **Full package check**

```bash
pnpm --filter @scopelock/cli typecheck
pnpm --filter @scopelock/cli build
pnpm --filter @scopelock/cli test 2>&1 | tail -20
```

Expected: typecheck clean, build clean, full suite green — existing test count plus 19 new tests (noop 1, line 3, live-panel 6, create-reporter 4, ui 5), zero regressions in any existing file.

- [ ] **Repo-wide gate**

```bash
pnpm typecheck && pnpm build && pnpm test
node packages/cli/dist/index.js check-drift
git diff --check
```

Expected: all green, `check-drift` reports zero violations under this task's approved ScopeLock contract, diff has no whitespace errors.

## Out of scope for this plan (tracked in the design spec's rollout section)

- Wiring `createReporter`/`ProgressReporter` into `run-plan.ts`, `plan-prepare.ts`, or `task-finish.ts` — no command emits any `ProgressEvent` yet after this plan; the reporter classes exist and are fully tested but unconsumed.
- The Guided wizard step headers and `renderStatusTable`-based review screen in `task-start.ts`/`task-finish.ts`.
- Making the live panel's final state visually hand off into a `renderStatusTable`-rendered summary — that integration belongs to the wiring phase, once the caller has real receipt data (stderr, artifact paths) to populate `StatusRow.reason`/`logPath`, which `ProgressEvent` alone does not carry for tasks (only `check-done.skipReason` exists at the event level).
