import { access, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ChangedFile, RepoMode, RepoState } from "../schemas/drift.js";
import { DEFAULT_DEGRADED_FILE_THRESHOLD } from "../schemas/config.js";
import { changedSinceBaseline } from "../git/diff.js";
import { runGitAsync } from "../git/exec.js";
import { parsePorcelainV2 } from "../git/status.js";
import { isOnlyContractSectionChange } from "../render/agents-md.js";

const AGENT_INSTRUCTION_FILES = new Set(["AGENTS.md", "CLAUDE.md"]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function gitDir(cwd: string): Promise<string | null> {
  const result = await runGitAsync(["rev-parse", "--git-dir"], cwd);
  if (!result.ok) return null;
  const raw = result.stdout.toString("utf8").trim();
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

async function repoState(cwd: string): Promise<RepoState> {
  const dir = await gitDir(cwd);
  if (dir === null) return { kind: "clean" };
  if (await exists(resolve(dir, "MERGE_HEAD"))) return { kind: "merge" };
  if (
    (await exists(resolve(dir, "rebase-merge"))) ||
    (await exists(resolve(dir, "rebase-apply")))
  ) {
    return { kind: "rebase" };
  }
  if (await exists(resolve(dir, "CHERRY_PICK_HEAD"))) {
    return { kind: "cherry-pick" };
  }
  if (await exists(resolve(dir, "REVERT_HEAD"))) return { kind: "revert" };
  if (await exists(resolve(dir, "BISECT_LOG"))) return { kind: "bisect" };
  return { kind: "clean" };
}

function isScopelockArtifact(path: string): boolean {
  return path === ".scopelock" || path.startsWith(".scopelock/");
}

async function baselineFile(
  cwd: string,
  baselineSha: string,
  path: string,
): Promise<string | null | undefined> {
  const listed = await runGitAsync(["ls-tree", "--name-only", baselineSha, "--", path], cwd);
  if (!listed.ok) return undefined;
  if (listed.stdout.toString("utf8").trim().length === 0) return null;

  const shown = await runGitAsync(["show", `${baselineSha}:${path}`], cwd);
  return shown.ok ? shown.stdout.toString("utf8") : undefined;
}

async function isOwnedInstructionChange(
  cwd: string,
  baselineSha: string,
  path: string,
): Promise<boolean> {
  const baseline = await baselineFile(cwd, baselineSha, path);
  if (baseline === undefined) return false;
  try {
    return isOnlyContractSectionChange(baseline, await readFile(resolve(cwd, path), "utf8"));
  } catch {
    return false;
  }
}

export async function collectChangedFiles(
  cwd: string,
  baselineSha: string | null,
  options: { degradedThreshold?: number } = {},
): Promise<{ files: ChangedFile[]; repoState: RepoState; repoMode: RepoMode }> {
  const degradedThreshold =
    options.degradedThreshold ?? DEFAULT_DEGRADED_FILE_THRESHOLD;
  const status = await runGitAsync(
    ["status", "--porcelain=v2", "-z", "--renames", "--untracked-files=all"],
    cwd,
  );
  if (!status.ok) {
    throw new Error(status.stderr || "git status --porcelain=v2 failed");
  }

  const committed = (
    baselineSha === null ? [] : await changedSinceBaseline(cwd, baselineSha)
  ).filter((file) => !isScopelockArtifact(file.path));
  const worktree = parsePorcelainV2(status.stdout).filter(
    (file) => !isScopelockArtifact(file.path),
  );
  const byPath = new Map<string, ChangedFile>();

  for (const file of committed) byPath.set(file.path, file);
  for (const file of worktree) byPath.set(file.path, file);

  if (baselineSha !== null) {
    for (const path of AGENT_INSTRUCTION_FILES) {
      if (byPath.has(path) && await isOwnedInstructionChange(cwd, baselineSha, path)) {
        byPath.delete(path);
      }
    }
  }

  const files = [...byPath.values()];
  return {
    files,
    repoState: await repoState(cwd),
    repoMode: files.length > degradedThreshold ? "degraded" : "normal",
  };
}
