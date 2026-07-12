import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createRunSignalCoordinator, spawnProcessTree } from "./process-tree.js";

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
      const childResult = JSON.parse(await readFile(out, "utf8")) as {
        cwd: string;
        arg: string;
      };
      assert.equal(await realpath(childResult.cwd), await realpath(dir));
      assert.equal(childResult.arg, "a value with spaces");
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

  it("terminates a tree registered after an earlier OS signal", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX signal delivery is not available on Windows");
      return;
    }
    const moduleUrl = new URL("./process-tree.js", import.meta.url).href;
    const script = [
      "const {createRunSignalCoordinator}=await import(process.argv[1]);",
      "const coordinator=createRunSignalCoordinator();",
      "process.send({type:'ready'});",
      "setTimeout(()=>coordinator.register({",
      "child:{},",
      "terminate(reason){process.send({type:'terminated',reason});coordinator.dispose();process.exit(0)},",
      "forceTerminate(){process.send({type:'forced'});coordinator.dispose();process.exit(0)},",
      "wait(){return new Promise(()=>{})}",
      "}),250);",
      "setTimeout(()=>process.exit(2),3000);",
    ].join("");
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, moduleUrl], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const messages: Array<{ type: string; reason?: string }> = [];
    child.on("message", (message) => messages.push(message as { type: string; reason?: string }));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`subprocess did not become ready: ${stderr}`)), 3_000);
      child.on("message", (message) => {
        if ((message as { type?: string }).type === "ready") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
    child.kill("SIGINT");
    const exitCode = await closed;
    assert.equal(exitCode, 0, stderr);
    assert.deepEqual(messages.at(-1), { type: "terminated", reason: "sigint" });
  });

  it("invokes Windows taskkill with a numeric PID-only argv", async (t) => {
    if (process.platform !== "win32") {
      t.skip("Windows taskkill is available only on Windows");
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "scopelock-taskkill-"));
    const originalPath = process.env.PATH;
    try {
      const log = join(dir, "taskkill-args.txt");
      const shim = join(dir, "taskkill.cmd");
      const systemTaskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
      await writeFile(
        shim,
        `@echo off\r\necho %* > "${log}"\r\n"${systemTaskkill}" %*\r\n`,
      );
      process.env.PATH = `${dir};${originalPath ?? ""}`;
      const tree = spawnProcessTree({
        command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
        cwd: dir,
        gracefulTimeoutMs: 100,
      });
      const pid = tree.child.pid;
      assert.ok(pid !== undefined && pid > 0);
      tree.terminate("timeout");
      const result = await tree.wait();
      const args = (await waitForFile(log)).trim().split(/\s+/);
      assert.deepEqual(args, ["/PID", String(pid), "/T", "/F"]);
      assert.equal(result.reason, "timeout");
      assert.equal(result.escalated, true);
    } finally {
      process.env.PATH = originalPath;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
