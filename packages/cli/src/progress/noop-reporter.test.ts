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
