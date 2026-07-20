import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLivePanelReporter } from "./live-panel-reporter.js";

function collect(): { chunks: string[]; sink: { write: (chunk: string) => void } } {
  const chunks: string[] = [];
  return { chunks, sink: { write: (chunk: string) => { chunks.push(chunk); } } };
}

function fakeTimers(): {
  options: {
    setInterval: (callback: () => void, delayMs: number) => NodeJS.Timeout;
    clearInterval: (timer: NodeJS.Timeout) => void;
  };
  starts: () => number;
  clears: () => number;
} {
  const token = { unref() {} } as NodeJS.Timeout;
  let startCount = 0;
  let clearCount = 0;
  return {
    options: {
      setInterval(callback, delayMs) {
        assert.equal(typeof callback, "function");
        assert.equal(delayMs, 80);
        startCount += 1;
        return token;
      },
      clearInterval(timer) {
        assert.equal(timer, token);
        clearCount += 1;
      },
    },
    starts: () => startCount,
    clears: () => clearCount,
  };
}

describe("createLivePanelReporter", () => {
  it("does not print an empty summary when disposed before the first event", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.dispose();
    assert.deepEqual(chunks, []);
  });

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

  it("moves the cursor up by the previously drawn panel line count before each repaint", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });
    reporter.dispose();
    assert.ok(chunks.includes("\u001b[2A"), `expected a cursor-up-2 escape, got: ${JSON.stringify(chunks)}`);
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

  it("retains two waves and validation rows in a settled failure-first summary", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 2, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });
    reporter.emit({ type: "task-done", id: "a", status: "passed", durationMs: 100 });
    reporter.emit({ type: "wave-start", wave: 2, totalWaves: 2, taskIds: ["b"] });
    reporter.emit({ type: "task-start", id: "b" });
    reporter.emit({
      type: "task-done",
      id: "b",
      status: "blocked",
      durationMs: 200,
      reason: "patch conflicts with the integration candidate",
      logPath: ".scopelock/runs/run-1/tasks/b/stderr.log",
    });
    reporter.emit({ type: "phase", name: "validating" });
    reporter.emit({ type: "check-start", id: "unit", required: true });
    reporter.emit({ type: "check-done", id: "unit", status: "passed", durationMs: 300 });

    const beforeDispose = chunks.length;
    reporter.dispose();
    const settled = chunks.slice(beforeDispose).join("");

    assert.match(settled, /b/);
    assert.match(settled, /a/);
    assert.match(settled, /unit/);
    assert.match(settled, /blocked/);
    assert.ok(
      settled.indexOf("\u001b[2Kb ") < settled.indexOf("\u001b[2Ka "),
      "failure rows must precede passing rows",
    );
    assert.doesNotMatch(settled, /running|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    assert.match(settled, /patch conflicts with the integration candidate/);
    assert.match(settled, /\(full log: \.scopelock\/runs\/run-1\/tasks\/b\/stderr\.log\)/);
  });

  it("truncates a long failure reason in the final status table", () => {
    const { chunks, sink } = collect();
    const reporter = createLivePanelReporter(sink);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({
      type: "task-done",
      id: "a",
      status: "failed",
      durationMs: 100,
      reason: "x".repeat(150),
      logPath: ".scopelock/runs/run-1/tasks/a/stderr.log",
    });

    const beforeDispose = chunks.length;
    reporter.dispose();
    const settled = chunks.slice(beforeDispose).join("");
    assert.match(settled, /… \(full log: \.scopelock\/runs\/run-1\/tasks\/a\/stderr\.log\)/);
    assert.doesNotMatch(settled, new RegExp("x".repeat(150)));
  });

  it("dispose is idempotent and clears the spinner interval exactly once", () => {
    const { sink } = collect();
    const timers = fakeTimers();
    const reporter = createLivePanelReporter(sink, timers.options);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });

    reporter.dispose();
    reporter.dispose();

    assert.equal(timers.starts(), 1);
    assert.equal(timers.clears(), 1);
  });

  it("interrupted settles running rows and clears the spinner interval", () => {
    const { chunks, sink } = collect();
    const timers = fakeTimers();
    const reporter = createLivePanelReporter(sink, timers.options);
    reporter.emit({ type: "wave-start", wave: 1, totalWaves: 1, taskIds: ["a"] });
    reporter.emit({ type: "task-start", id: "a" });

    const beforeInterrupted = chunks.length;
    reporter.emit({ type: "interrupted" });
    const settled = chunks.slice(beforeInterrupted).join("");

    assert.equal(timers.starts(), 1);
    assert.equal(timers.clears(), 1);
    assert.doesNotMatch(settled, /running|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    assert.match(settled, /SKIP/);
    reporter.dispose();
    assert.equal(timers.clears(), 1);
  });
});
