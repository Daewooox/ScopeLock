import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
export const cliBinPath = join(repoRoot, "packages/cli/dist/index.js");

export function forceTtyColor() {
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
}

export function recordingReporter() {
  const events = [];
  return {
    events,
    reporter: {
      emit(event) {
        events.push(event);
      },
      dispose() {},
    },
  };
}

export function initFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "scopelock-demo-svg-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "demo@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "ScopeLock Demo"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-qm", "init"], { cwd: dir });
  return dir;
}

export function cleanupFixtureRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function fakeCodexOnPath(dir) {
  const bin = join(dir, ".demo-fake-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "fake-codex.cjs");
  const executable = join(bin, "codex");
  writeFileSync(script, "require('node:fs').writeFileSync('a.txt', 'ran')\n");
  writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`);
  chmodSync(executable, 0o755);
  return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
}

export function approveContract(dir, cliPath, env, id, planned, read = []) {
  const draftPath = join(dir, `${id}.json`);
  const draft = spawnSync(process.execPath, [
    cliPath, "contract", "new", "--task", id, "--id", id,
    ...planned.flatMap((glob) => ["--planned", glob]),
    ...read.flatMap((glob) => ["--read", glob]),
    "--out", draftPath,
  ], { cwd: dir, env, encoding: "utf8" });
  if (draft.status !== 0) {
    throw new Error(`contract new failed for ${id}: ${draft.stderr || draft.stdout}`);
  }
  const approved = spawnSync(process.execPath, [cliPath, "contract", "approve", draftPath], {
    cwd: dir, env, encoding: "utf8",
  });
  if (approved.status !== 0) {
    throw new Error(`contract approve failed for ${id}: ${approved.stderr || approved.stdout}`);
  }
}
