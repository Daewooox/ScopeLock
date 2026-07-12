import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { collectChangedFiles } from "../drift/collect.js";
import { classifyPath } from "../rules/path-rules.js";
import type { ContractScope } from "../schemas/contract.js";
import type { ChangedFile, GitFileStatus } from "../schemas/drift.js";
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

export type IsolationClassification =
  | "planned"
  | "outside"
  | "forbidden"
  | "unsupported-gitlink"
  | "unsupported-symlink"
  | "unsupported-mode";

export type IsolatedChangedFile = ChangedFile & {
  oldMode: string | null;
  newMode: string | null;
  classification: IsolationClassification;
};

export type IsolationFinding = {
  code:
    | "FORBIDDEN_PATH"
    | "OUTSIDE_SCOPE"
    | "UNSUPPORTED_GITLINK"
    | "UNSUPPORTED_SYMLINK"
    | "UNSUPPORTED_MODE"
    | "PATCH_TOO_LARGE";
  path: string | null;
  detail: string;
};

export type PreparedPatch = {
  path: string;
  sha256: string;
  bytes: number;
  changedFiles: IsolatedChangedFile[];
};

export type ScopedPatchResult =
  | { accepted: true; patch: PreparedPatch | null; findings: [] }
  | { accepted: false; patch: PreparedPatch | null; findings: IsolationFinding[] };

export class WorktreeError extends Error {
  constructor(
    public readonly code:
      | "DIRTY_REPO"
      | "INVALID_BASE"
      | "INVALID_ID"
      | "INVALID_KIND"
      | "REPO_STATE_UNSAFE"
      | "PATCH_GENERATION_FAILED"
      | "PATCH_TOO_LARGE"
      | "UNSAFE_PATH"
      | "WORKTREE_CREATE_FAILED"
      | "WORKTREE_REMOVE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}

type RawDiffEntry = {
  path: string;
  previousPath: string | null;
  status: GitFileStatus;
  oldMode: string;
  newMode: string;
};

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

function statusFromRaw(code: string): GitFileStatus {
  if (code.startsWith("R")) return "renamed";
  if (code.startsWith("C")) return "copied";
  if (code.startsWith("A")) return "added";
  if (code.startsWith("D")) return "deleted";
  if (code.startsWith("U")) return "conflicted";
  return "modified";
}

function parseRawDiff(raw: Buffer): RawDiffEntry[] {
  const tokens = raw.toString("utf8").split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const entries: RawDiffEntry[] = [];
  for (let index = 0; index < tokens.length; ) {
    const metadata = tokens[index++] ?? "";
    const match = metadata.match(/^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z]\d*)$/i);
    if (match === null) {
      throw new WorktreeError("PATCH_GENERATION_FAILED", "unrecognized git raw diff record");
    }
    const code = match[3] ?? "M";
    const firstPath = tokens[index++] ?? "";
    const renamed = code.startsWith("R") || code.startsWith("C");
    const path = renamed ? (tokens[index++] ?? "") : firstPath;
    if (path.length === 0 || (renamed && firstPath.length === 0)) {
      throw new WorktreeError("PATCH_GENERATION_FAILED", "git raw diff record has an empty path");
    }
    entries.push({
      path,
      previousPath: renamed ? firstPath : null,
      status: statusFromRaw(code),
      oldMode: match[1] ?? "000000",
      newMode: match[2] ?? "000000",
    });
  }
  return entries;
}

function parseNumstat(raw: Buffer): Map<string, { insertions: number; deletions: number; isBinary: boolean }> {
  const tokens = raw.toString("utf8").split("\0");
  const stats = new Map<string, { insertions: number; deletions: number; isBinary: boolean }>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const [insertionsRaw, deletionsRaw, pathRaw = ""] = token.split("\t");
    const isBinary = insertionsRaw === "-" || deletionsRaw === "-";
    const value = {
      insertions: isBinary ? 0 : Number(insertionsRaw),
      deletions: isBinary ? 0 : Number(deletionsRaw),
      isBinary,
    };
    if (pathRaw.length > 0) {
      stats.set(pathRaw, value);
    } else {
      const currentPath = tokens[index + 2];
      if (currentPath) {
        stats.set(currentPath, value);
        index += 2;
      }
    }
  }
  return stats;
}

function modeClassification(oldMode: string, newMode: string): IsolationClassification | null {
  if (oldMode === "160000" || newMode === "160000") return "unsupported-gitlink";
  if (oldMode === "120000" || newMode === "120000") return "unsupported-symlink";
  const supported = new Set(["000000", "100644", "100755"]);
  return supported.has(oldMode) && supported.has(newMode) ? null : "unsupported-mode";
}

async function fileSize(worktreePath: string, path: string): Promise<number> {
  try {
    const info = await lstat(resolve(worktreePath, path));
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

function findingFor(file: IsolatedChangedFile): IsolationFinding | null {
  if (file.classification === "planned") return null;
  const mapping = {
    forbidden: "FORBIDDEN_PATH",
    outside: "OUTSIDE_SCOPE",
    "unsupported-gitlink": "UNSUPPORTED_GITLINK",
    "unsupported-symlink": "UNSUPPORTED_SYMLINK",
    "unsupported-mode": "UNSUPPORTED_MODE",
  } as const;
  return {
    code: mapping[file.classification],
    path: file.path,
    detail: `${file.path}: ${file.classification}`,
  };
}

async function streamPatch(input: {
  worktree: IsolatedWorktree;
  patchDir: string;
  maxPatchBytes: number;
  timeoutMs?: number;
}): Promise<Omit<PreparedPatch, "changedFiles"> | null> {
  if (!Number.isSafeInteger(input.maxPatchBytes) || input.maxPatchBytes <= 0) {
    throw new WorktreeError("PATCH_GENERATION_FAILED", "maxPatchBytes must be a positive integer");
  }
  await mkdir(input.patchDir, { recursive: true, mode: 0o700 });
  const path = resolve(input.patchDir, `${input.worktree.kind}-${input.worktree.id}.patch`);
  if (!isInside(input.patchDir, path)) {
    throw new WorktreeError("UNSAFE_PATH", "patch path escapes its ScopeLock directory");
  }
  const handle = await open(path, "wx", 0o600);
  const child = spawn(
    "git",
    ["diff", "--binary", "--full-index", "--find-renames", input.worktree.baseSha, "--"],
    { cwd: input.worktree.path, stdio: ["ignore", "pipe", "pipe"] },
  );
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const closed = new Promise<number | null>((finish, reject) => {
    child.on("error", reject);
    child.on("close", finish);
  });
  const timer = input.timeoutMs
    ? setTimeout(() => child.kill("SIGTERM"), input.timeoutMs)
    : null;
  const hash = createHash("sha256");
  let bytes = 0;
  let tooLarge = false;
  let failure: unknown = null;
  try {
    for await (const chunk of child.stdout) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > input.maxPatchBytes) {
        tooLarge = true;
        child.kill("SIGTERM");
        break;
      }
      hash.update(buffer);
      await handle.write(buffer);
    }
    const exitCode = await closed;
    if (tooLarge) {
      throw new WorktreeError("PATCH_TOO_LARGE", `isolated patch exceeds ${input.maxPatchBytes} bytes`);
    }
    if (exitCode !== 0) {
      throw new WorktreeError(
        "PATCH_GENERATION_FAILED",
        Buffer.concat(stderr).toString("utf8").trim() || "git diff failed",
      );
    }
  } catch (error) {
    child.kill("SIGTERM");
    failure = error;
  } finally {
    if (timer) clearTimeout(timer);
    await handle.close();
  }
  if (failure !== null) {
    await rm(path, { force: true });
    throw failure;
  }
  if (bytes === 0) {
    await rm(path, { force: true });
    return null;
  }
  return { path, bytes, sha256: hash.digest("hex") };
}

async function hashPatch(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function applyPatch(
  repoRoot: string,
  path: string,
  check: boolean,
  timeoutMs?: number,
): Promise<{ ok: boolean; detail: string }> {
  const child = spawn("git", ["apply", ...(check ? ["--check"] : []), "--binary", "-"], {
    cwd: repoRoot,
    stdio: ["pipe", "ignore", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  createReadStream(path).pipe(child.stdin);
  const timer = timeoutMs ? setTimeout(() => child.kill("SIGTERM"), timeoutMs) : null;
  const code = await new Promise<number | null>((finish, reject) => {
    child.on("error", reject);
    child.on("close", finish);
  });
  if (timer) clearTimeout(timer);
  return {
    ok: code === 0,
    detail: Buffer.concat(stderr).toString("utf8").trim(),
  };
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

export async function prepareScopedPatch(input: {
  worktree: IsolatedWorktree;
  scope: ContractScope;
  patchDir: string;
  maxPatchBytes: number;
  timeoutMs?: number;
}): Promise<ScopedPatchResult> {
  const intent = await runGitAsync(["add", "-N", "--", "."], input.worktree.path, {
    timeoutMs: input.timeoutMs,
  });
  if (!intent.ok) {
    throw new WorktreeError("PATCH_GENERATION_FAILED", intent.stderr || "git add -N failed");
  }
  const [raw, numstat] = await Promise.all([
    runGitAsync(
      ["diff", "--raw", "-z", "--no-abbrev", "--find-renames", input.worktree.baseSha, "--"],
      input.worktree.path,
      { timeoutMs: input.timeoutMs },
    ),
    runGitAsync(
      ["diff", "--numstat", "-z", "--find-renames", input.worktree.baseSha, "--"],
      input.worktree.path,
      { timeoutMs: input.timeoutMs },
    ),
  ]);
  if (!raw.ok || !numstat.ok) {
    throw new WorktreeError(
      "PATCH_GENERATION_FAILED",
      raw.stderr || numstat.stderr || "git diff inventory failed",
    );
  }
  const stats = parseNumstat(numstat.stdout);
  const changedFiles = await Promise.all(
    parseRawDiff(raw.stdout).map(async (entry): Promise<IsolatedChangedFile> => {
      const mode = modeClassification(entry.oldMode, entry.newMode);
      const changedFile: ChangedFile = {
        path: entry.path,
        previousPath: entry.previousPath,
        status: entry.status,
        stage: "unstaged",
        isBinary: stats.get(entry.path)?.isBinary ?? false,
        insertions: stats.get(entry.path)?.insertions ?? 0,
        deletions: stats.get(entry.path)?.deletions ?? 0,
        sizeBytes: await fileSize(input.worktree.path, entry.path),
      };
      return {
        ...changedFile,
        oldMode: entry.oldMode,
        newMode: entry.newMode,
        classification: mode ?? classifyPath(changedFile, input.scope),
      };
    }),
  );
  let streamed: Omit<PreparedPatch, "changedFiles"> | null;
  try {
    streamed = await streamPatch(input);
  } catch (error) {
    if (error instanceof WorktreeError && error.code === "PATCH_TOO_LARGE") {
      return {
        accepted: false,
        patch: null,
        findings: [{ code: "PATCH_TOO_LARGE", path: null, detail: error.message }],
      };
    }
    throw error;
  }
  const patch = streamed === null ? null : { ...streamed, changedFiles };
  const findings = changedFiles
    .map(findingFor)
    .filter((finding): finding is IsolationFinding => finding !== null);
  return findings.length === 0
    ? { accepted: true, patch, findings: [] }
    : { accepted: false, patch, findings };
}

export async function prepareAggregatePatch(input: {
  worktree: IsolatedWorktree;
  patchDir: string;
  maxPatchBytes: number;
  timeoutMs?: number;
}): Promise<ScopedPatchResult> {
  return prepareScopedPatch({
    ...input,
    scope: {
      plannedPathPatterns: [],
      forbiddenPathPatterns: [],
      readPathPatterns: [],
      allowAllPaths: true,
    },
  });
}

export async function applyPreparedPatch(input: {
  repoRoot: string;
  patch: PreparedPatch;
  timeoutMs?: number;
}): Promise<{ applied: true } | { applied: false; reason: string }> {
  const current = await hashPatch(input.patch.path);
  if (current.sha256 !== input.patch.sha256 || current.bytes !== input.patch.bytes) {
    return { applied: false, reason: "prepared patch digest mismatch" };
  }
  const check = await applyPatch(input.repoRoot, input.patch.path, true, input.timeoutMs);
  if (!check.ok) return { applied: false, reason: check.detail || "git apply --check failed" };
  const applied = await applyPatch(input.repoRoot, input.patch.path, false, input.timeoutMs);
  return applied.ok
    ? { applied: true }
    : { applied: false, reason: applied.detail || "git apply failed" };
}

export async function worktreeHead(
  worktree: IsolatedWorktree,
  timeoutMs?: number,
): Promise<string> {
  const sha = await gitOutput(worktree.path, ["rev-parse", "--verify", "HEAD^{commit}"], timeoutMs);
  if (!objectIdPattern.test(sha)) {
    throw new WorktreeError("INVALID_BASE", "worktree HEAD is not a full Git object id");
  }
  return sha;
}

export async function commitIntegrationWave(input: {
  worktree: IsolatedWorktree;
  waveIndex: number;
  timeoutMs?: number;
}): Promise<{ committed: boolean; headSha: string }> {
  if (input.worktree.kind !== "integration") {
    throw new WorktreeError("INVALID_KIND", "wave commits require an integration worktree");
  }
  if (!Number.isSafeInteger(input.waveIndex) || input.waveIndex < 0) {
    throw new WorktreeError("INVALID_ID", "wave index must be a non-negative integer");
  }
  const status = await runGitAsync(
    ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    input.worktree.path,
    { timeoutMs: input.timeoutMs },
  );
  if (!status.ok) {
    throw new WorktreeError("WORKTREE_CREATE_FAILED", status.stderr || "integration status failed");
  }
  if (status.stdout.length === 0) {
    return { committed: false, headSha: await worktreeHead(input.worktree, input.timeoutMs) };
  }
  const staged = await runGitAsync(["add", "-A", "--", "."], input.worktree.path, {
    timeoutMs: input.timeoutMs,
  });
  if (!staged.ok) {
    throw new WorktreeError("WORKTREE_CREATE_FAILED", staged.stderr || "integration staging failed");
  }
  const committed = await runGitAsync(
    [
      "-c",
      "user.name=ScopeLock",
      "-c",
      "user.email=scopelock@localhost",
      "commit",
      "-qm",
      `scopelock: accept wave ${input.waveIndex}`,
    ],
    input.worktree.path,
    { timeoutMs: input.timeoutMs },
  );
  if (!committed.ok) {
    throw new WorktreeError("WORKTREE_CREATE_FAILED", committed.stderr || "integration commit failed");
  }
  return { committed: true, headSha: await worktreeHead(input.worktree, input.timeoutMs) };
}
