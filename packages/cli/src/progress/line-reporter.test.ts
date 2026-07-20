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

  it("prints redacted task failure evidence and its full-log path", () => {
    const { lines, write } = collect();
    const reporter = createLineReporter(write);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["auth"] });
    reporter.emit({
      type: "task-done",
      id: "auth",
      status: "failed",
      durationMs: 3100,
      reason: "[redacted]\nassertion failed",
      logPath: ".scopelock/runs/run-1/tasks/auth/stderr.log",
    });
    assert.equal(
      lines.at(-1),
      "[wave 1] auth: failed (3.1s) — [redacted] assertion failed"
      + " (full log: .scopelock/runs/run-1/tasks/auth/stderr.log)",
    );
  });

  it("distinguishes failed-check evidence from an honest skip reason", () => {
    const { lines, write } = collect();
    const reporter = createLineReporter(write);
    reporter.emit({
      type: "check-done",
      id: "unit",
      status: "failed",
      durationMs: 900,
      reason: "[redacted] 2 assertions failed",
      logPath: ".scopelock/runs/run-1/validation/unit.log",
    });
    reporter.emit({
      type: "check-done",
      id: "analyze",
      status: "skipped",
      durationMs: 0,
      skipReason: "an earlier required check failed",
    });
    assert.deepEqual(lines, [
      "[validation] unit: failed (0.9s) — [redacted] 2 assertions failed"
      + " (full log: .scopelock/runs/run-1/validation/unit.log)",
      "[validation] analyze: skipped (0.0s) — an earlier required check failed",
    ]);
  });

  it("removes terminal control bytes from event identifiers and evidence", () => {
    const { lines, write } = collect();
    const reporter = createLineReporter(write);
    reporter.emit({ type: "task-start", id: "evil\u001b[2J\u0007" });
    reporter.emit({
      type: "task-done",
      id: "evil",
      status: "failed",
      durationMs: 1,
      reason: "failure\u001b[2K\u0000",
      logPath: "logs/\u001b[1Aresult.txt",
    });
    assert.equal(lines.some((line) => /[\u0000-\u001f\u007f-\u009f]/u.test(line)), false);
  });

  it("labels a corrected task with its original wave", () => {
    const { lines, write } = collect();
    const reporter = createLineReporter(write);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 2, taskIds: ["a"] });
    reporter.emit({ type: "task-done", id: "a", status: "passed", durationMs: 10, wave: 1 });
    reporter.emit({ type: "wave-start", wave: 2, totalWaves: 2, taskIds: ["b"] });
    reporter.emit({
      type: "task-done",
      id: "a",
      status: "blocked",
      durationMs: 10,
      reason: "final promotion blocked",
      wave: 1,
      updated: true,
    });
    assert.equal(
      lines.at(-1),
      "[wave 1] a: blocked (0.0s) — final promotion blocked (updated)",
    );
  });
});
