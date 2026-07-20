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
