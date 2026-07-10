import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeReceipt, summarizeAnalyses } from "./analyze-receipt.mjs";

function receipt(stdout = "") {
  return {
    schemaVersion: 1,
    planId: "fixture",
    startedAt: "2026-07-10T00:00:00.000Z",
    finishedAt: "2026-07-10T00:00:01.000Z",
    waves: [["t1"]],
    conflicts: [],
    cycles: [],
    deferredTasks: [],
    taskRuns: [{
      id: "t1",
      status: "passed",
      command: ["codex", "exec", "prompt"],
      exitCode: 0,
      durationMs: 1000,
      stdout,
      stderr: "",
    }],
    drift: { status: "ok" },
  };
}

test("receipt category bytes add up to the serialized receipt size", () => {
  const analysis = analyzeReceipt(receipt("unicode: Привет"));
  assert.equal(
    Object.values(analysis.categories).reduce((total, bytes) => total + bytes, 0),
    analysis.totalBytes,
  );
  assert.equal(analysis.largestTask.id, "t1");
});

test("extracts and aggregates Codex usage from the final turn event", () => {
  const event = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 3 } });
  const first = analyzeReceipt(receipt(`noise\n${event}\n`));
  const second = analyzeReceipt(receipt(event));
  assert.deepEqual(first.usage, { input_tokens: 12, output_tokens: 3 });
  assert.deepEqual(summarizeAnalyses([first, second]).usage, {
    input_tokens: 24,
    output_tokens: 6,
  });
});

test("extracts usage from raw stdout artifact when receipt output is bounded", () => {
  const dir = mkdtempSync(join(tmpdir(), "scopelock-receipt-artifact-"));
  try {
    const event = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 7 } });
    const artifactPath = join(dir, "t1.stdout.txt");
    writeFileSync(artifactPath, `preview omitted\n${event}\n`);
    const bounded = receipt("preview omitted");
    bounded.schemaVersion = 2;
    bounded.taskRuns[0].outputArtifacts = {
      stdout: { path: artifactPath, bytes: 100, sha256: "x", previewBytes: 15, truncated: true },
    };
    const analysis = analyzeReceipt(bounded);
    assert.deepEqual(analysis.usage, { input_tokens: 7 });
    assert.equal(analysis.artifacts.stdout, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects objects without task runs", () => {
  assert.throws(() => analyzeReceipt({ planId: "broken" }, "broken.json"), /taskRuns/);
});
