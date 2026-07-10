import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(benchmarkDir, "run-codex-real-agent-benchmark.mjs");

test("real-agent benchmark supports a zero-run smoke mode", () => {
  const output = execFileSync("node", [scriptPath, "--runs", "0"], { encoding: "utf8" });
  const result = JSON.parse(output);

  assert.equal(result.runs, 0);
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.summary, []);
});

test("real-agent benchmark accepts the scopelock_run mode without launching agents", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "scopelock-receipt-baseline-test-"));
  try {
    const output = execFileSync(
      "node",
      [scriptPath, "--runs", "0", "--modes", "scopelock_run", "--output-dir", outputDir],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output);

    assert.deepEqual(result.modes, ["scopelock_run"]);
    assert.deepEqual(result.results, []);
    assert.equal(JSON.parse(readFileSync(join(outputDir, "summary.json"), "utf8")).runs, 0);
    assert.equal(typeof JSON.parse(readFileSync(join(outputDir, "environment.json"), "utf8")).node, "string");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
