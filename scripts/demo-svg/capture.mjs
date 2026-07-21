import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
export const cliBinPath = join(repoRoot, "packages/cli/dist/index.js");

export function forceTtyColor() {
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  // ui.ts computes supportsColor once at module load from isTTY, NO_COLOR and
  // CI. GitHub Actions sets CI=true, which would strip ANSI colors from the
  // captured output and make CI-regenerated SVGs differ from the committed,
  // locally-generated (colored) ones. Clear both so capture is
  // environment-independent.
  delete process.env.CI;
  delete process.env.NO_COLOR;
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
  // mkdtempSync returns a path under os.tmpdir(), which on macOS is under
  // /var, itself a symlink to /private/var. `git rev-parse --show-toplevel`
  // (used internally by ScopeLock's findRepoRoot) resolves symlinks and
  // returns the physical /private/var/... path, so if `dir` here stayed
  // unresolved, every string match against real CLI output (e.g. in
  // sanitize.mjs's sanitizeHuman) would only match the tail of the path and
  // leak a dangling "/private" prefix into captured output. Resolve once,
  // here, so every downstream consumer of `dir` sees the same canonical
  // path that git and the CLI actually emit.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "scopelock-demo-svg-")));
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
