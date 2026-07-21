import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const generatePath = join(scriptDir, "generate.mjs");

function run(args) {
  return spawnSync(process.execPath, [generatePath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

// POSIX-only, like capture.mjs (the generator drives the `#!/bin/sh` fake
// codex shim) - documented scope cut; the CI gate runs on ubuntu-latest only.
const posixOnly = process.platform === "win32"
  ? { skip: "demo-svg generation is POSIX-only" }
  : {};

describe("generate", posixOnly, () => {
  it("writes both demo SVGs with real content", () => {
    const result = run([]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const guided = readFileSync(join(repoRoot, "docs/assets/scopelock-demo.svg"), "utf8");
    const standard = readFileSync(join(repoRoot, "docs/assets/scopelock-plan-demo.svg"), "utf8");
    assert.match(guided, /Cleared/);
    assert.match(standard, /ordered safely/);
  });

  it("bakes no machine-specific absolute paths into either SVG", () => {
    run([]);
    for (const name of ["scopelock-demo.svg", "scopelock-plan-demo.svg"]) {
      const svg = readFileSync(join(repoRoot, "docs/assets", name), "utf8");
      // The same-machine determinism test below cannot catch cross-machine
      // leaks (e.g. process.execPath baked into the validation command, or
      // an unsanitized temp path) - they are identical across local runs
      // but differ on CI runners. Scan for the leak classes directly.
      assert.equal(svg.includes(process.execPath), false, `${name} leaks process.execPath`);
      for (const prefix of ["/opt/", "/home/", "/Users/", "/private/", "/var/", "/tmp/"]) {
        assert.equal(svg.includes(prefix), false, `${name} leaks a path under ${prefix}`);
      }
    }
  });

  it("produces byte-identical output across two runs", () => {
    run([]);
    const first = readFileSync(join(repoRoot, "docs/assets/scopelock-demo.svg"), "utf8");
    run([]);
    const second = readFileSync(join(repoRoot, "docs/assets/scopelock-demo.svg"), "utf8");
    assert.equal(first, second);
  });

  it("--check exits 0 right after a fresh generate, and 1 when a committed file is hand-edited", () => {
    run([]);
    const checkClean = run(["--check"]);
    assert.equal(checkClean.status, 0, checkClean.stderr || checkClean.stdout);

    const target = join(repoRoot, "docs/assets/scopelock-demo.svg");
    const original = readFileSync(target, "utf8");
    writeFileSync(target, `${original}<!-- hand edit -->`);
    const checkDirty = run(["--check"]);
    assert.equal(checkDirty.status, 1);
    assert.match(checkDirty.stdout + checkDirty.stderr, /scopelock-demo\.svg/);
    writeFileSync(target, original);
  });
});
