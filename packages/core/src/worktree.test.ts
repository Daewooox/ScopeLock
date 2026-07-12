import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import {
  WorktreeError,
  applyPreparedPatch,
  assertIsolationReady,
  createIsolatedWorktree,
  createIsolationTempRoot,
  commitIntegrationWave,
  prepareScopedPatch,
  removeIsolatedWorktree,
  worktreeHead,
} from "./index.js";
import type { ApprovedContract } from "./index.js";

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
  git(repo, ["config", "core.autocrlf", "false"]);
  await mkdir(join(repo, "allowed"), { recursive: true });
  await mkdir(join(repo, "forbidden"), { recursive: true });
  await writeFile(join(repo, "tracked.txt"), "baseline\n");
  await writeFile(join(repo, "allowed/text.txt"), "baseline text\n");
  await writeFile(join(repo, "allowed/delete.txt"), "delete me\n");
  await writeFile(join(repo, "allowed/rename-old.txt"), "rename me\n");
  await writeFile(join(repo, "allowed/blob.bin"), Buffer.from([0, 1, 2, 255]));
  await writeFile(join(repo, "forbidden/secret.txt"), "protected\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "baseline"]);
  return { root, repo, head: git(repo, ["rev-parse", "HEAD"]) };
}

function contract(head: string): ApprovedContract {
  return {
    schemaVersion: 1,
    id: "isolation-test",
    task: "test isolated patches",
    createdAt: new Date(0).toISOString(),
    baseline: { headSha: head, branch: "main", capturedAt: new Date(0).toISOString() },
    targetAgents: ["codex"],
    scope: {
      plannedPathPatterns: ["allowed/**"],
      forbiddenPathPatterns: ["forbidden/**"],
      readPathPatterns: [],
      allowAllPaths: false,
    },
    nodes: [],
    risks: [],
    tests: [],
    assumptions: [],
    openQuestions: [],
  };
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

  it("fails closed and preserves the path when git cannot remove a worktree", async () => {
    const fixture = await makeRepo();
    const originalPath = process.env.PATH;
    let worktree: Awaited<ReturnType<typeof createIsolatedWorktree>> | null = null;
    let blocker: ReturnType<typeof spawn> | null = null;
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      worktree = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "remove-failure",
        kind: "task",
        baseSha: fixture.head,
      });
      if (process.platform === "win32") {
        blocker = spawn(
          process.execPath,
          ["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"],
          { cwd: worktree.path, stdio: ["ignore", "pipe", "pipe"] },
        );
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("worktree blocker did not start")), 5_000);
          blocker?.once("error", reject);
          blocker?.stdout?.once("data", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } else {
        const shimDir = join(fixture.root, "fake-bin");
        await mkdir(shimDir);
        const lookup = spawnSync("which", ["git"], { encoding: "utf8" });
        const realGit = lookup.stdout.split(/\r?\n/).find(Boolean);
        assert.ok(realGit, "real git executable not found");
        const shim = join(shimDir, "git");
        await writeFile(
          shim,
          `#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = remove ]; then echo injected remove failure >&2; exit 1; fi\nexec "${realGit}" "$@"\n`,
        );
        await chmod(shim, 0o755);
        process.env.PATH = `${shimDir}${delimiter}${originalPath ?? ""}`;
      }
      await assert.rejects(
        removeIsolatedWorktree({ repoRoot: fixture.repo, worktree }),
        (error) => error instanceof WorktreeError &&
          error.code === "WORKTREE_REMOVE_FAILED" &&
          (process.platform === "win32" || error.message.includes("injected remove failure")),
      );
      process.env.PATH = originalPath;
      await access(worktree.path);
    } finally {
      process.env.PATH = originalPath;
      if (blocker !== null) {
        const closed = new Promise((resolve) => blocker?.once("close", resolve));
        blocker.kill("SIGKILL");
        await closed;
      }
      if (worktree !== null) {
        await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree }).catch(() => {});
      }
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("prepares and applies a sealed patch with text, new, delete, rename, binary, and mode changes", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const task = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "scope",
        kind: "task",
        baseSha: fixture.head,
      });
      const integration = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "integration",
        kind: "integration",
        baseSha: fixture.head,
      });
      await writeFile(join(task.path, "allowed/text.txt"), "changed text\n");
      await writeFile(join(task.path, "allowed/new.txt"), "new\n");
      await rm(join(task.path, "allowed/delete.txt"));
      await rename(
        join(task.path, "allowed/rename-old.txt"),
        join(task.path, "allowed/rename-new.txt"),
      );
      await writeFile(join(task.path, "allowed/blob.bin"), Buffer.from([9, 0, 8, 255]));
      await chmod(join(task.path, "allowed/text.txt"), 0o755);

      const prepared = await prepareScopedPatch({
        worktree: task,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 1024 * 1024,
      });
      assert.equal(prepared.accepted, true);
      assert.ok(prepared.patch);
      assert.ok(prepared.patch.changedFiles.every((file) => file.classification === "planned"));
      assert.ok(prepared.patch.changedFiles.some((file) => file.previousPath === "allowed/rename-old.txt"));
      assert.ok(prepared.patch.changedFiles.some((file) => file.isBinary));
      assert.deepEqual(await applyPreparedPatch({ repoRoot: integration.path, patch: prepared.patch }), {
        applied: true,
      });
      assert.equal(await readFile(join(integration.path, "allowed/new.txt"), "utf8"), "new\n");
      assert.deepEqual(await readFile(join(integration.path, "allowed/blob.bin")), Buffer.from([9, 0, 8, 255]));
      await assert.rejects(readFile(join(integration.path, "allowed/delete.txt"), "utf8"));
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: task });
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: integration });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a whole patch when any path is forbidden", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const task = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "forbidden",
        kind: "task",
        baseSha: fixture.head,
      });
      await writeFile(join(task.path, "allowed/new.txt"), "allowed\n");
      await rename(
        join(task.path, "forbidden/secret.txt"),
        join(task.path, "allowed/moved-secret.txt"),
      );
      const prepared = await prepareScopedPatch({
        worktree: task,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 1024 * 1024,
      });
      assert.equal(prepared.accepted, false);
      assert.ok(prepared.findings.some((finding) => finding.code === "FORBIDDEN_PATH"));
      assert.ok(
        prepared.patch?.changedFiles.some(
          (file) =>
            file.path === "allowed/moved-secret.txt" &&
            file.previousPath === "forbidden/secret.txt" &&
            file.classification === "forbidden",
        ),
      );
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: task });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when a patch exceeds its byte limit", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const task = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "large",
        kind: "task",
        baseSha: fixture.head,
      });
      await writeFile(join(task.path, "allowed/large.txt"), "x".repeat(4096));
      const prepared = await prepareScopedPatch({
        worktree: task,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 32,
      });
      assert.equal(prepared.accepted, false);
      assert.deepEqual(prepared.findings.map((finding) => finding.code), ["PATCH_TOO_LARGE"]);
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: task });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses a prepared patch after its bytes are tampered with", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const task = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "tamper",
        kind: "task",
        baseSha: fixture.head,
      });
      await writeFile(join(task.path, "allowed/new.txt"), "new\n");
      const prepared = await prepareScopedPatch({
        worktree: task,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 1024 * 1024,
      });
      assert.equal(prepared.accepted, true);
      assert.ok(prepared.patch);
      await writeFile(prepared.patch.path, "tampered\n");
      const applied = await applyPreparedPatch({ repoRoot: fixture.repo, patch: prepared.patch });
      assert.equal(applied.applied, false);
      assert.match(applied.applied ? "" : applied.reason, /digest mismatch/);
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: task });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("includes committed changes together with later untracked changes", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const task = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "committed",
        kind: "task",
        baseSha: fixture.head,
      });
      git(task.path, ["config", "user.name", "Agent"]);
      git(task.path, ["config", "user.email", "agent@example.com"]);
      await writeFile(join(task.path, "allowed/text.txt"), "committed change\n");
      git(task.path, ["add", "allowed/text.txt"]);
      git(task.path, ["commit", "-qm", "agent commit"]);
      await writeFile(join(task.path, "allowed/after.txt"), "untracked after commit\n");
      const prepared = await prepareScopedPatch({
        worktree: task,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 1024 * 1024,
      });
      assert.equal(prepared.accepted, true);
      assert.deepEqual(
        prepared.patch?.changedFiles.map((file) => file.path).sort(),
        ["allowed/after.txt", "allowed/text.txt"],
      );
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: task });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed for a gitlink change", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const task = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "gitlink",
        kind: "task",
        baseSha: fixture.head,
      });
      git(task.path, [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${fixture.head},allowed/submodule`,
      ]);
      await mkdir(join(task.path, "allowed/submodule"));
      const prepared = await prepareScopedPatch({
        worktree: task,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 1024 * 1024,
      });
      assert.equal(prepared.accepted, false);
      assert.ok(prepared.findings.some((finding) => finding.code === "UNSUPPORTED_GITLINK"));
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: task });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it(
    "fails closed for a symlink change",
    { skip: process.platform === "win32" },
    async () => {
      const fixture = await makeRepo();
      try {
        const tempRoot = await createIsolationTempRoot(fixture.root);
        const task = await createIsolatedWorktree({
          repoRoot: fixture.repo,
          tempRoot,
          id: "symlink",
          kind: "task",
          baseSha: fixture.head,
        });
        await symlink("../../outside", join(task.path, "allowed/link"));
        const prepared = await prepareScopedPatch({
          worktree: task,
          scope: contract(fixture.head).scope,
          patchDir: join(tempRoot, "patches"),
          maxPatchBytes: 1024 * 1024,
        });
        assert.equal(prepared.accepted, false);
        assert.ok(prepared.findings.some((finding) => finding.code === "UNSUPPORTED_SYMLINK"));
        await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: task });
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
  );

  it("carries accepted output into the next wave without touching the user tree", async () => {
    const fixture = await makeRepo();
    try {
      const tempRoot = await createIsolationTempRoot(fixture.root);
      const integration = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "integration-waves",
        kind: "integration",
        baseSha: fixture.head,
      });
      const first = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "wave-one",
        kind: "task",
        baseSha: fixture.head,
      });
      await writeFile(join(first.path, "allowed/wave-one.txt"), "first wave\n");
      const firstPatch = await prepareScopedPatch({
        worktree: first,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 1024 * 1024,
      });
      assert.equal(firstPatch.accepted, true);
      assert.ok(firstPatch.patch);
      assert.deepEqual(
        await applyPreparedPatch({ repoRoot: integration.path, patch: firstPatch.patch }),
        { applied: true },
      );
      const waveOne = await commitIntegrationWave({ worktree: integration, waveIndex: 1 });
      assert.equal(waveOne.committed, true);
      assert.notEqual(waveOne.headSha, fixture.head);

      const second = await createIsolatedWorktree({
        repoRoot: fixture.repo,
        tempRoot,
        id: "wave-two",
        kind: "task",
        baseSha: waveOne.headSha,
      });
      assert.equal(await readFile(join(second.path, "allowed/wave-one.txt"), "utf8"), "first wave\n");
      await writeFile(
        join(second.path, "allowed/wave-two.txt"),
        `reader saw: ${(await readFile(join(second.path, "allowed/wave-one.txt"), "utf8")).trim()}\n`,
      );
      const secondPatch = await prepareScopedPatch({
        worktree: second,
        scope: contract(fixture.head).scope,
        patchDir: join(tempRoot, "patches"),
        maxPatchBytes: 1024 * 1024,
      });
      assert.equal(secondPatch.accepted, true);
      assert.ok(secondPatch.patch);
      assert.deepEqual(
        await applyPreparedPatch({ repoRoot: integration.path, patch: secondPatch.patch }),
        { applied: true },
      );
      const waveTwo = await commitIntegrationWave({ worktree: integration, waveIndex: 2 });
      assert.equal(waveTwo.committed, true);
      assert.equal(await worktreeHead(integration), waveTwo.headSha);
      assert.equal(
        await readFile(join(integration.path, "allowed/wave-two.txt"), "utf8"),
        "reader saw: first wave\n",
      );
      await assert.rejects(readFile(join(fixture.repo, "allowed/wave-one.txt"), "utf8"));
      await assert.rejects(readFile(join(fixture.repo, "allowed/wave-two.txt"), "utf8"));

      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: first });
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: second });
      await removeIsolatedWorktree({ repoRoot: fixture.repo, worktree: integration });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
