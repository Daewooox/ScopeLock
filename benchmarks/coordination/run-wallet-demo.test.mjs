import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWalletDemo } from "./run-wallet-demo.mjs";

test("wallet demo shows env block, safe waves, hook deny, and receipt when Swift is available", (t) => {
  const outputDir = mkdtempSync(join(tmpdir(), "scopelock-wallet-demo-test-"));
  let keptFixture = null;
  try {
    const result = runWalletDemo(["--quiet", "--offline-fixture", "--keep-fixture", "--output-dir", outputDir]);
    keptFixture = result.fixture;
    if (result.blocked) {
      t.skip(result.reason);
      return;
    }
    assert.ok(result.fixture);
    assert.ok(result.manualCommands.some((command) => command.includes("packages/cli/dist/index.js")));
    assert.ok(result.manualCommands.some((command) => command.includes("plan-parallel plan.json")));
    assert.equal(result.steps.baselineTestsPassed, true);
    assert.equal(result.steps.missingSkillBlocked, true);
    assert.equal(result.steps.fixedPreflightPassed, true);
    assert.deepEqual(result.steps.safeWaves[0], ["wallet-core-rules"]);
    assert.equal(result.steps.hookDenied, true);
    assert.equal(result.steps.finalRunPassed, true);
    assert.equal(result.steps.finalSwiftTestsPassed, true);
    assert.equal(result.steps.finalDriftClean, true);
    assert.equal(JSON.parse(readFileSync(join(outputDir, "receipt.json"), "utf8")).schemaVersion, 4);
  } finally {
    if (keptFixture !== null) rmSync(keptFixture, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});
