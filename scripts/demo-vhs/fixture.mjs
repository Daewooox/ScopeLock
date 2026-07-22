import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
export const cliBinPath = join(repoRoot, "packages/cli/dist/index.js");

export function initFixtureRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "scopelock-demo-vhs-")));
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

export function writeScopelockShim(dir) {
  const bin = join(dir, ".demo-fake-bin");
  mkdirSync(bin, { recursive: true });
  const executable = join(bin, "scopelock");
  writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${cliBinPath}" "$@"\n`);
  chmodSync(executable, 0o755);
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

export function buildScenarioFixture(name) {
  const dir = initFixtureRepo();
  const env = fakeCodexOnPath(dir);
  writeScopelockShim(dir);

  if (name === "guided") {
    // Both shims must be committed as part of the baseline `task start`
    // captures, or `task finish` reports them as out-of-scope drift (they
    // live outside the --allow src scope).
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["commit", "-qm", "fixture: shims"], { cwd: dir });
  } else if (name === "plan") {
    approveContract(dir, cliBinPath, env, "writer", ["src/writer.js"]);
    approveContract(dir, cliBinPath, env, "reader", ["src/reader.js"], ["src/writer.js"]);
    writeFileSync(join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      planId: "demo-standard",
      tasks: [
        { id: "writer", contract: ".scopelock/contracts/writer.json", expectsChanges: true },
        { id: "reader", contract: ".scopelock/contracts/reader.json", expectsChanges: true },
      ],
    }));
  } else {
    throw new Error(`unknown scenario: ${name}`);
  }

  return { dir, env };
}
