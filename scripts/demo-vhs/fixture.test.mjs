import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cliBinPath,
  initFixtureRepo,
  cleanupFixtureRepo,
  fakeCodexOnPath,
  writeScopelockShim,
  approveContract,
  buildScenarioFixture,
} from "./fixture.mjs";

// The fixture toolchain writes `#!/bin/sh` shims - POSIX-only by design,
// matching the demo-svg capture toolchain it replaces. CI runs this check
// on ubuntu-latest only.
const posixOnly = process.platform === "win32"
  ? { skip: "demo-vhs fixture toolchain is POSIX-only" }
  : {};

describe("fixture", posixOnly, () => {
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
      assert.equal(paths.some((p) => existsSync(join(p, "codex"))), true);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("writeScopelockShim puts a resolvable scopelock executable in .demo-fake-bin", () => {
    const dir = initFixtureRepo();
    try {
      writeScopelockShim(dir);
      const executable = join(dir, ".demo-fake-bin", "scopelock");
      assert.equal(existsSync(executable), true);
      assert.match(readFileSync(executable, "utf8"), /exec/);
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

  it("buildScenarioFixture('guided') leaves a clean working tree (shims are committed)", () => {
    const { dir } = buildScenarioFixture("guided");
    try {
      const status = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.equal(status.stdout.trim(), "");
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("buildScenarioFixture('plan') approves writer and reader contracts and writes plan.json", () => {
    const { dir } = buildScenarioFixture("plan");
    try {
      assert.equal(existsSync(join(dir, ".scopelock/contracts/writer.json")), true);
      assert.equal(existsSync(join(dir, ".scopelock/contracts/reader.json")), true);
      const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
      assert.equal(plan.tasks.length, 2);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("buildScenarioFixture throws for an unknown scenario", () => {
    assert.throws(() => buildScenarioFixture("nope"), /unknown scenario/);
  });
});
