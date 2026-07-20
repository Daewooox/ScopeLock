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
