import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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

// The capture toolchain is POSIX-only by design (the fake `codex` shim is a
// `#!/bin/sh` script) - a documented scope cut in the plan's Global
// Constraints. The CI staleness gate runs on ubuntu-latest only.
const posixOnly = process.platform === "win32"
  ? { skip: "demo-svg capture toolchain is POSIX-only" }
  : {};

describe("capture", posixOnly, () => {
  it("forces stdout.isTTY to true and clears color-disabling env vars", () => {
    process.env.CI = "true";
    process.env.NO_COLOR = "1";
    forceTtyColor();
    assert.equal(process.stdout.isTTY, true);
    // ui.ts disables color when CI=true or NO_COLOR is set; capture must
    // neutralize both so CI-regenerated SVGs match locally-generated ones.
    assert.equal(process.env.CI, undefined);
    assert.equal(process.env.NO_COLOR, undefined);
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

  it("initFixtureRepo returns an already-resolved (symlink-free) path", () => {
    const dir = initFixtureRepo();
    try {
      // If `dir` still contained an unresolved symlink component (e.g. the
      // macOS /var -> /private/var alias under os.tmpdir()), resolving it
      // again would produce a different, longer path. Asserting the
      // resolve is a no-op proves `dir` is already canonical.
      assert.equal(realpathSync(dir), dir);
    } finally {
      cleanupFixtureRepo(dir);
    }
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
