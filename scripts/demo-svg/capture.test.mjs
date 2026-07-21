import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forceTtyColor,
  recordingReporter,
  initFixtureRepo,
  cleanupFixtureRepo,
  fakeCodexOnPath,
  approveContract,
  cliBinPath,
} from "./capture.mjs";

describe("capture", () => {
  it("forces stdout.isTTY to true", () => {
    forceTtyColor();
    assert.equal(process.stdout.isTTY, true);
  });

  it("recordingReporter records emitted events and dispose calls", () => {
    const recording = recordingReporter();
    recording.reporter.emit({ type: "phase", name: "scheduling" });
    recording.reporter.dispose();
    assert.deepEqual(recording.events, [{ type: "phase", name: "scheduling" }]);
  });

  it("initFixtureRepo creates a git-initialized directory", () => {
    const dir = initFixtureRepo();
    try {
      assert.equal(existsSync(join(dir, ".git")), true);
    } finally {
      cleanupFixtureRepo(dir);
    }
    assert.equal(existsSync(dir), false);
  });

  it("fakeCodexOnPath puts a resolvable codex executable on PATH", () => {
    const dir = initFixtureRepo();
    try {
      const env = fakeCodexOnPath(dir);
      const paths = env.PATH.split(":");
      const found = paths.some((p) => existsSync(join(p, "codex")));
      assert.equal(found, true);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("approveContract writes an approved contract file with a baseline", () => {
    const dir = initFixtureRepo();
    try {
      const env = fakeCodexOnPath(dir);
      approveContract(dir, cliBinPath, env, "demo-a", ["src/a.js"]);
      const contract = JSON.parse(
        readFileSync(join(dir, ".scopelock/contracts/demo-a.json"), "utf8"),
      );
      assert.equal(contract.id, "demo-a");
      assert.notEqual(contract.baseline, null);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });
});
