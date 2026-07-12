import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWalletDemo } from "./run-wallet-demo.mjs";

test("wallet demo animates one spinner line before replacing it with a check", () => {
  const moduleUrl = new URL("./run-wallet-demo.mjs", import.meta.url).href;
  const script = `
    process.argv[1] = "spinner-test.mjs";
    Object.defineProperty(process.stdout, "isTTY", { value: true });
    const { createDemoUi } = await import(${JSON.stringify(moduleUrl)});
    const ui = createDemoUi(false);
    ui.start("test step");
    setTimeout(() => ui.end("test step", true), 240);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, CI: "false", NO_COLOR: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok((result.stdout.match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g) ?? []).length >= 2);
  assert.match(result.stdout, /✓ test step\n$/);
});

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
