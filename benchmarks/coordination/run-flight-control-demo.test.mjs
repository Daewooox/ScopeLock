import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDemo } from "./run-flight-control-demo.mjs";

test("one-command demo exercises the dispatcher and produces stable evidence", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "scopelock-demo-test-"));
  try {
    const result = await runDemo(["--quiet", "--output-dir", outputDir]);
    assert.equal(result.withoutScopeLock.scopeViolations, 2);
    assert.equal(result.withoutScopeLock.unresolvedConflicts, 2);
    assert.ok(result.withoutScopeLock.failedTests > 0);
    assert.equal(result.withoutScopeLock.acceptedTasks, 4);
    assert.equal(result.withScopeLock.scopeViolations, 0);
    assert.equal(result.withScopeLock.unresolvedConflicts, 0);
    assert.equal(result.withScopeLock.preventedHazards, 2);
    assert.equal(result.withScopeLock.failedTests, 0);
    assert.equal(result.withScopeLock.acceptedTasks, 5);
    assert.deepEqual(result.withScopeLock.deferredTasks, ["t4-tax-9"]);
    assert.equal(JSON.parse(readFileSync(join(outputDir, "receipt.json"), "utf8")).schemaVersion, 4);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
