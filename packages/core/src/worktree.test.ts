import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  WorktreeError,
  assertIsolationReady,
  createIsolatedWorktree,
  createIsolationTempRoot,
  removeIsolatedWorktree,
} from "./index.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function makeRepo(): Promise<{ root: string; repo: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "scopelock-worktree-test-"));
  const repo = join(root, "repo");
  git(root, ["init", "-q", "-b", "main", repo]);
  git(repo, ["config", "user.name", "ScopeLock Test"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  await writeFile(join(repo, "tracked.txt"), "baseline\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "baseline"]);
  return { root, repo, head: git(repo, ["rev-parse", "HEAD"]) };
}

describe("isolated Git worktree lifecycle", () => {
  it("creates a detached worktree at the exact base and removes it idempotently", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(join(fixture.root, "temp parent ü"));
      const worktree = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "task-one",
        kind: "task",
        baseSha: fixture.head,
      });
      assert.equal(git(worktree.path, ["rev-parse", "HEAD"]), fixture.head);
      assert.equal(git(worktree.path, ["branch", "--show-current"]), "");
      assert.deepEqual(await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree }), {
        status: "removed",
        path: worktree.path,
      });
      assert.deepEqual(await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree }), {
        status: "already-absent",
        path: worktree.path,
      });
      assert.equal(
        git(fixture.repo, ["worktree", "list", "--porcelain"])
          .split(/\r?\n/)
          .filter((line) => line.startsWith("worktree ")).length,
        1,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("requires a clean repository at the expected HEAD", async () => {
    const fixture = await makeRepo();
    try {
      assert.deepEqual(await assertIsolationReady(fixture.repo, fixture.head), {
        headSha: fixture.head,
      });
      await writeFile(join(fixture.repo, "untracked.txt"), "dirty\n");
      await assert.rejects(
        assertIsolationReady(fixture.repo, fixture.head),
        (error) => error instanceof WorktreeError && error.code === "DIRTY_REPO",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed for invalid ids and base object ids", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      await assert.rejects(
        createIsolatedWorktree({
          repoRoot: fixture.repo,
          tempRoot,
          id: "../escape",
          kind: "task",
          baseSha: fixture.head,
        }),
        (error) => error instanceof WorktreeError && error.code === "INVALID_ID",
      );
      await assert.rejects(
        createIsolatedWorktree({
          repoRoot: fixture.repo,
          tempRoot,
          id: "bad-base",
          kind: "task",
          baseSha: "HEAD",
        }),
        (error) => error instanceof WorktreeError && error.code === "INVALID_BASE",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses to remove a foreign worktree", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const foreign = join(fixture.root, "foreign-worktree");
      git(fixture.repo, ["worktree", "add", "--detach", foreign, fixture.head]);
      await assert.rejects(
        removeIsolatedWorktree({
          repoRoot: fixture.repo,
          worktree: {
            id: "foreign",
            kind: "task",
            path: foreign,
            tempRoot,
            baseSha: fixture.head,
          },
        }),
        (error) => error instanceof WorktreeError && error.code === "UNSAFE_PATH",
      );
      assert.equal(git(foreign, ["rev-parse", "HEAD"]), fixture.head);
      git(fixture.repo, ["worktree", "remove", "--force", foreign]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
