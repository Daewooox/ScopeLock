// scripts/demo-vhs/write-guided-source.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "write-guided-source.mjs");

describe("write-guided-source", () => {
  it("writes a source file and a matching test file into cwd/src", () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-vhs-write-"));
    try {
      const result = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(readFileSync(join(dir, "src/dark-mode.js"), "utf8"), /darkMode = true/);
      assert.match(readFileSync(join(dir, "src/dark-mode.test.js"), "utf8"), /dark mode is enabled/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
