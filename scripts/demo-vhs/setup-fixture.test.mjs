// scripts/demo-vhs/setup-fixture.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const setupPath = join(scriptDir, "setup-fixture.mjs");

const posixOnly = process.platform === "win32"
  ? { skip: "demo-vhs fixture toolchain is POSIX-only" }
  : {};

describe("setup-fixture", posixOnly, () => {
  it("prints a fixture directory with both shims committed for 'guided'", () => {
    const result = spawnSync(process.execPath, [setupPath, "guided"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const dir = result.stdout;
    try {
      assert.equal(existsSync(join(dir, ".demo-fake-bin", "scopelock")), true);
      assert.equal(existsSync(join(dir, ".demo-fake-bin", "codex")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a fixture directory with plan.json and approved contracts for 'plan'", () => {
    const result = spawnSync(process.execPath, [setupPath, "plan"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const dir = result.stdout;
    try {
      assert.equal(existsSync(join(dir, "plan.json")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with a usage message on an unknown scenario", () => {
    const result = spawnSync(process.execPath, [setupPath, "nope"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage/);
  });
});
