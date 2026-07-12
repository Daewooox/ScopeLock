import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { spawnProcessTree } from "./process-tree.js";

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("process tree supervisor", () => {
  it("runs argv commands in the requested cwd without a shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-process-tree-"));
    try {
      const out = join(dir, "result.json");
      const tree = spawnProcessTree({
        command: [
          process.execPath,
          "-e",
          "require('node:fs').writeFileSync(process.argv[1],JSON.stringify({cwd:process.cwd(),arg:process.argv[2]}))",
          out,
          "a value with spaces",
        ],
        cwd: dir,
        gracefulTimeoutMs: 100,
      });
      const result = await tree.wait();
      assert.equal(result.exitCode, 0);
      assert.deepEqual(JSON.parse(await readFile(out, "utf8")), {
        cwd: await realpath(dir),
        arg: "a value with spaces",
      });
      assert.equal(result.reason, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("terminates a parent and its grandchild", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-process-tree-"));
    try {
      const ready = join(dir, "ready.json");
      const script = [
        "const {spawn}=require('node:child_process');",
        "const fs=require('node:fs');",
        "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
        "fs.writeFileSync(process.argv[1],JSON.stringify({parent:process.pid,child:child.pid}));",
        "setInterval(()=>{},1000);",
      ].join("");
      const tree = spawnProcessTree({
        command: [process.execPath, "-e", script, ready],
        cwd: dir,
        gracefulTimeoutMs: 100,
      });
      const pids = JSON.parse(await waitForFile(ready)) as { parent: number; child: number };
      tree.terminate("timeout");
      const result = await tree.wait();
      assert.equal(result.reason, "timeout");
      assert.equal(isAlive(pids.parent), false);
      assert.equal(isAlive(pids.child), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("force termination is idempotent", async () => {
    const tree = spawnProcessTree({
      command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
      cwd: process.cwd(),
      gracefulTimeoutMs: 5_000,
    });
    tree.forceTerminate();
    tree.forceTerminate();
    const result = await tree.wait();
    assert.equal(result.reason, "second-signal");
    assert.equal(result.escalated, true);
  });
});
