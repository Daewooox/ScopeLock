import { runGit } from "./exec.js";

export function gitVersion(cwd: string): string | null {
  const result = runGit(["--version"], cwd);
  return result.ok ? result.stdout : null;
}

/** Absolute path of the repo root, or null when cwd is not inside a git repo. */
export function findRepoRoot(cwd: string): string | null {
  const result = runGit(["rev-parse", "--show-toplevel"], cwd);
  return result.ok && result.stdout.length > 0 ? result.stdout : null;
}

export function headSha(cwd: string): string | null {
  const result = runGit(["rev-parse", "HEAD"], cwd);
  return result.ok ? result.stdout : null;
}

/** Branch name, or null when HEAD is detached. */
export function currentBranch(cwd: string): string | null {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!result.ok || result.stdout === "HEAD") return null;
  return result.stdout;
}

/**
 * True when `sha` resolves to a commit object in this repo. Used to catch a
 * stale contract baseline (e.g. after a history rewrite) before it reaches
 * `git diff <sha>..HEAD`, which would otherwise fail with a raw git fatal.
 */
export function commitExists(cwd: string, sha: string): boolean {
  return runGit(["cat-file", "-e", `${sha}^{commit}`], cwd).ok;
}
