import { join as nodeJoin, posix as posixPath } from "node:path";

/**
 * Pure repo-relative path helpers for agent-environment preflight. No I/O, no
 * platform-specific behavior: paths in a manifest are always repo-relative and
 * are normalized to POSIX so a digest or a check never depends on the OS
 * separator. Kept dependency-free so both the manifest schema and the engine
 * can import it without a cycle.
 */

/** Convert any OS separators to POSIX `/`. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * True when `p` is a safe repo-relative path: not empty, not absolute (POSIX or
 * Windows drive), and does not escape the repository root once normalized.
 * `a/../b` is safe (stays inside); `../secret` and `a/../../x` are not.
 */
export function isRepoRelativeSafe(p: string): boolean {
  if (p.length === 0) return false;
  const posix = toPosix(p);
  if (posix.startsWith("/")) return false; // POSIX absolute
  if (/^[a-zA-Z]:/.test(posix)) return false; // Windows drive
  const normalized = posixPath.normalize(posix);
  return normalized !== ".." && !normalized.startsWith("../");
}

/**
 * Resolve a safe repo-relative path to an absolute path under `repoRoot`.
 * Throws on an unsafe path so no check ever reads outside the repository.
 */
export function resolveRepoPath(repoRoot: string, relPath: string): string {
  if (!isRepoRelativeSafe(relPath)) {
    throw new Error(`unsafe repo-relative path: ${relPath}`);
  }
  const segments = posixPath
    .normalize(toPosix(relPath))
    .split("/")
    .filter((s) => s.length > 0 && s !== ".");
  return nodeJoin(repoRoot, ...segments);
}
