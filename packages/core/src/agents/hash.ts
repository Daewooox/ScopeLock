import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Directory names never included in a skill digest (VCS + generated caches). */
const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", ".cache", "__pycache__"]);

/** SHA-256 hex over the raw bytes of a single file. */
export function hashFileBytes(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

interface WalkedFile {
  /** POSIX path relative to the walked root, so the digest ignores OS separators. */
  relPosix: string;
  absPath: string;
}

/**
 * Collect regular files under `absDir`, skipping excluded dirs and NOT following
 * symlinks (a symlinked entry is ignored by the content digest; symlink policy
 * is enforced separately in the engine). Relative paths are POSIX-normalized.
 */
function walkRegularFiles(absDir: string): WalkedFile[] {
  const out: WalkedFile[] = [];
  const stack: string[] = [absDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (EXCLUDED_DIR_NAMES.has(name)) continue;
      const abs = join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // do not follow; content-agnostic
      if (st.isDirectory()) {
        stack.push(abs);
      } else if (st.isFile()) {
        out.push({ relPosix: relative(absDir, abs).split(sep).join("/"), absPath: abs });
      }
    }
  }
  return out;
}

/**
 * Deterministic SHA-256 digest of a skill directory: hashes every regular file's
 * POSIX-relative path plus its raw bytes, in sorted path order. Consequences:
 * identical trees produce identical digests; a single byte change changes it;
 * file discovery order and OS separators do not affect it; and files outside the
 * declared directory cannot influence it (the walk is scoped to `absDir`).
 */
export function hashSkillDir(absDir: string): string {
  const files = walkRegularFiles(absDir).sort((a, b) =>
    a.relPosix < b.relPosix ? -1 : a.relPosix > b.relPosix ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relPosix);
    hash.update("\0");
    hash.update(readFileSync(file.absPath));
    hash.update("\0");
  }
  return hash.digest("hex");
}
