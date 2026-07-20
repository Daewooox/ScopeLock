import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPilot } from "./run-pilot-demo.mjs";

test("pilot demo shows block, fix, safe waves, hook deny, and receipt v6", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "scopelock-pilot-demo-test-"));
  try {
    const result = runPilot(["--quiet", "--output-dir", outputDir]);
    assert.equal(result.steps.missingSkillBlocked, true);
    assert.equal(result.steps.fixedRunPassed, true);
    assert.deepEqual(result.steps.safeWaves, [["pilot-writer"], ["pilot-reader"]]);
    assert.equal(result.steps.hookDenied, true);
    assert.equal(JSON.parse(readFileSync(join(outputDir, "receipt.json"), "utf8")).schemaVersion, 6);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
