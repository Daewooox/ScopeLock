import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = fileURLToPath(new URL("./index.js", import.meta.url));

type RunResult = { status: number; stdout: string; stderr: string };

function runCli(cwd: string, args: string[]): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    input: "",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function makeRepo(): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "scopelock-cli-"));
  const init = spawnSync("git", ["init", "-q"], { cwd: dir });
  if (init.status !== 0) {
    await rm(dir, { recursive: true, force: true });
    return null;
  }
  spawnSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-qm", "init"], { cwd: dir });
  return dir;
}

describe("cli end-to-end", () => {
  it("init -> contract new -> approve -> check-drift respects the exit-code contract", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);

      // Write the draft outside the repo so it does not itself count as drift.
      const draftPath = join(tmpdir(), `sl-draft-${Date.now()}.json`);
      const draft = runCli(dir, [
        "contract",
        "new",
        "--task",
        "scoped change",
        "--planned",
        "src/**",
        "--forbidden",
        "secrets/**",
        "--out",
        draftPath,
      ]);
      assert.equal(draft.status, 0);

      const approve = runCli(dir, ["--json", "approve", draftPath]);
      assert.equal(approve.status, 0);
      assert.equal(JSON.parse(approve.stdout).status, "ok");

      // Clean tree after baseline -> no drift -> exit 0.
      const clean = runCli(dir, ["--json", "check-drift"]);
      assert.equal(clean.status, 0);
      assert.equal(JSON.parse(clean.stdout).data.report.violations.length, 0);

      // Write a forbidden file -> violations -> exit 1.
      await mkdir(join(dir, "secrets"), { recursive: true });
      await writeFile(join(dir, "secrets", "key.txt"), "x");
      const dirty = runCli(dir, ["--json", "check-drift"]);
      assert.equal(dirty.status, 1);
      const report = JSON.parse(dirty.stdout).data.report;
      assert.ok(report.violations.some((v: { type: string }) => v.type === "forbidden_path"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a compact error and exit 2 outside a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-nogit-"));
    try {
      const res = runCli(dir, ["--json", "check-drift"]);
      assert.equal(res.status, 2);
      assert.equal(JSON.parse(res.stdout).status, "error");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("contract new prints schema-valid JSON to stdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-cn-"));
    try {
      const res = runCli(dir, ["contract", "new", "--task", "x", "--planned", "a/**"]);
      assert.equal(res.status, 0);
      const contract = JSON.parse(res.stdout);
      assert.equal(contract.schemaVersion, 1);
      assert.deepEqual(contract.scope.plannedPathPatterns, ["a/**"]);
      assert.equal(contract.baseline, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
