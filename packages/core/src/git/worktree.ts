import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { collectChangedFiles } from "../drift/collect.js";
import { runGitAsync } from "./exec.js";

const objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const worktreeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export type IsolationPreflight = {
  headSha: string;
};

export type IsolatedWorktree = {
  id: string;
  kind: "integration" | "task";
  path: string;
  tempRoot: string;
  baseSha: string;
};

export type WorktreeCleanupResult = {
  status: "removed" | "already-absent";
  path: string;
};

export class WorktreeError extends Error {
  constructor(
    public readonly code:
      | "DIRTY_REPO"
      | "INVALID_BASE"
      | "INVALID_ID"
      | "REPO_STATE_UNSAFE"
      | "UNSAFE_PATH"
      | "WORKTREE_CREATE_FAILED"
      | "WORKTREE_REMOVE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel.length > 0 && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function canonicalIfPresent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function gitOutput(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const result = await runGitAsync(args, cwd, { timeoutMs });
  if (!result.ok) throw new Error(result.stderr || `git ${args[0] ?? "command"} failed`);
  return result.stdout.toString("utf8").trim();
}

async function registeredWorktreePaths(repoRoot: string, timeoutMs?: number): Promise<Set<string>> {
  const raw = await gitOutput(repoRoot, ["worktree", "list", "--porcelain"], timeoutMs);
  return new Set(
    await Promise.all(
      raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith("worktree "))
        .map((line) => canonicalIfPresent(line.slice("worktree ".length))),
    ),
  );
}

export async function assertIsolationReady(
  repoRoot: string,
  expectedHeadSha?: string,
  timeoutMs?: number,
): Promise<IsolationPreflight> {
  const headSha = await gitOutput(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"], timeoutMs);
  if (!objectIdPattern.test(headSha) || (expectedHeadSha !== undefined && headSha !== expectedHeadSha)) {
    throw new WorktreeError("INVALID_BASE", "repository HEAD does not match the expected isolation base");
  }
  const collected = await collectChangedFiles(repoRoot, headSha);
  if (collected.repoState.kind !== "clean") {
    throw new WorktreeError(
      "REPO_STATE_UNSAFE",
      `repository is in ${collected.repoState.kind} state`,
    );
  }
  if (collected.files.length > 0) {
    throw new WorktreeError("DIRTY_REPO", "isolated execution requires a clean working tree");
  }
  return { headSha };
}

export async function createIsolationTempRoot(parent: string = tmpdir()): Promise<string> {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(join(parent, "scopelock-isolate-"));
}

export async function createIsolatedWorktree(input: {
  repoRoot: string;
  tempRoot: string;
  id: string;
  kind: "integration" | "task";
  baseSha: string;
  timeoutMs?: number;
}): Promise<IsolatedWorktree> {
  if (!worktreeIdPattern.test(input.id)) {
    throw new WorktreeError("INVALID_ID", `invalid isolation worktree id: ${input.id}`);
  }
  if (!objectIdPattern.test(input.baseSha)) {
    throw new WorktreeError("INVALID_BASE", "isolation base must be a full Git object id");
  }
  const path = resolve(input.tempRoot, `${input.kind}-${input.id}`);
  if (!isInside(input.tempRoot, path)) {
    throw new WorktreeError("UNSAFE_PATH", "isolated worktree path escapes its temp root");
  }
  if (await exists(path)) {
    throw new WorktreeError("WORKTREE_CREATE_FAILED", `isolated worktree path already exists: ${path}`);
  }
  const verify = await runGitAsync(
    ["rev-parse", "--verify", `${input.baseSha}^{commit}`],
    input.repoRoot,
    { timeoutMs: input.timeoutMs },
  );
  if (!verify.ok) {
    throw new WorktreeError("INVALID_BASE", verify.stderr || "isolation base commit does not exist");
  }
  const added = await runGitAsync(
    ["worktree", "add", "--detach", "--", path, input.baseSha],
    input.repoRoot,
    { timeoutMs: input.timeoutMs },
  );
  if (!added.ok) {
    throw new WorktreeError("WORKTREE_CREATE_FAILED", added.stderr || "git worktree add failed");
  }
  try {
    const actualSha = await gitOutput(path, ["rev-parse", "--verify", "HEAD^{commit}"], input.timeoutMs);
    if (actualSha !== input.baseSha) {
      throw new WorktreeError("INVALID_BASE", "created worktree does not match requested base");
    }
  } catch (error) {
    await runGitAsync(["worktree", "remove", "--force", "--", path], input.repoRoot, {
      timeoutMs: input.timeoutMs,
    });
    throw error;
  }
  return {
    id: input.id,
    kind: input.kind,
    path,
    tempRoot: resolve(input.tempRoot),
    baseSha: input.baseSha,
  };
}

export async function removeIsolatedWorktree(input: {
  repoRoot: string;
  worktree: IsolatedWorktree;
  timeoutMs?: number;
}): Promise<WorktreeCleanupResult> {
  const path = resolve(input.worktree.path);
  if (
    !isInside(input.worktree.tempRoot, path) ||
    !basename(input.worktree.tempRoot).startsWith("scopelock-isolate-")
  ) {
    throw new WorktreeError("UNSAFE_PATH", "refusing to remove a non-ScopeLock worktree path");
  }
  const registered = await registeredWorktreePaths(input.repoRoot, input.timeoutMs);
  if (!registered.has(await canonicalIfPresent(path))) {
    await rm(path, { recursive: true, force: true });
    return { status: "already-absent", path };
  }
  const removed = await runGitAsync(
    ["worktree", "remove", "--force", "--", path],
    input.repoRoot,
    { timeoutMs: input.timeoutMs },
  );
  if (!removed.ok) {
    throw new WorktreeError("WORKTREE_REMOVE_FAILED", removed.stderr || "git worktree remove failed");
  }
  return { status: "removed", path };
}
