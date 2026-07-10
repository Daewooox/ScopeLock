import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWalletDemo } from "./run-wallet-demo.mjs";

test("wallet demo shows env block, safe waves, hook deny, and receipt when Swift is available", (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), "scopelock-wallet-demo-test-"));
  try {
    const result = runWalletDemo(["--quiet", "--offline-fixture", "--output-dir", outputDir]);
    if (result.blocked) {
      t.skip(result.reason);
      return;
    }
    assert.equal(result.steps.baselineTestsPassed, true);
    assert.equal(result.steps.missingSkillBlocked, true);
    assert.equal(result.steps.fixedPreflightPassed, true);
    assert.deepEqual(result.steps.safeWaves[0], ["wallet-core-rules"]);
    assert.equal(result.steps.hookDenied, true);
    assert.equal(result.steps.finalRunPassed, true);
    assert.equal(result.steps.finalSwiftTestsPassed, true);
    assert.equal(result.steps.finalDriftClean, true);
    assert.equal(JSON.parse(readFileSync(join(outputDir, "receipt.json"), "utf8")).schemaVersion, 3);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
