import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runProgressiveDemo } from "./run-progressive-cli-demo.mjs";

test("progressive demo preserves reviewable artifacts without starting an agent", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "scopelock-progressive-demo-test-"));
  let keptFixture = null;
  try {
    const result = runProgressiveDemo(["--quiet", "--output-dir", outputDir]);
    assert.equal(result.guided.cleared, true);
    assert.equal(result.guided.allowedChanges, 2);
    assert.equal(result.guided.testsExecuted, false);
    assert.deepEqual(result.multiAgent.stages, [["config-writer"], ["summary-reader"]]);
    assert.equal(result.multiAgent.agentExecuted, false);
    assert.ok(Object.values(result.artifacts).every(existsSync));
    const ready = JSON.parse(readFileSync(result.artifacts.readyPlan, "utf8"));
    assert.deepEqual(ready.tasks.map((task) => task.command.slice(0, 2)), [
      ["codex", "exec"],
      ["codex", "exec"],
    ]);

    const kept = runProgressiveDemo(["--quiet", "--keep-fixture", "--output-dir", outputDir]);
    keptFixture = kept.fixture;
    assert.equal(typeof keptFixture, "string");
    assert.equal(existsSync(join(keptFixture, "ready-plan.json")), true);
  } finally {
    if (keptFixture !== null) rmSync(keptFixture, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  }
});
