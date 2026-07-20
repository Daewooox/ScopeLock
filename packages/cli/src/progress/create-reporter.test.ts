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
      assert.ok(stream.chunks.some((chunk) => chunk.includes("[2K")));
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
