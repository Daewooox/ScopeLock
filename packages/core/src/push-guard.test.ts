import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPushSafety } from "./index.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr}`,
  );
  return result.stdout.trim();
}

async function makeRemoteFixture(): Promise<{
  root: string;
  remote: string;
  local: string;
  peer: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "scopelock-push-guard-"));
  const remote = join(root, "remote.git");
  const local = join(root, "local");
  const peer = join(root, "peer");

  git(root, ["init", "--bare", "-q", remote]);
  git(root, ["clone", "-q", remote, local]);
  git(local, ["switch", "-c", "main"]);
  git(local, ["config", "user.email", "test@example.com"]);
  git(local, ["config", "user.name", "ScopeLock Test"]);
  await writeFile(join(local, "file.txt"), "initial\n");
  git(local, ["add", "."]);
  git(local, ["commit", "-qm", "initial"]);
  git(local, ["push", "-q", "-u", "origin", "main"]);

  git(root, ["clone", "-q", remote, peer]);
  git(peer, ["switch", "main"]);
  git(peer, ["config", "user.email", "peer@example.com"]);
  git(peer, ["config", "user.name", "ScopeLock Peer"]);

  return { root, remote, local, peer };
}

describe("push safety guard", () => {
  it("treats a missing remote ref as safe for a new branch", async () => {
    const fixture = await makeRemoteFixture();
    try {
      const localSha = git(fixture.local, ["rev-parse", "HEAD"]);

      const verdict = await checkPushSafety({
        repoRoot: fixture.local,
        remote: "origin",
        remoteRef: "refs/heads/new-branch",
        localSha,
      });

      assert.deepEqual(verdict, {
        safe: true,
        lease: {
          remoteRef: "refs/heads/new-branch",
          expectedRemoteSha: null,
        },
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("allows a local fast-forward update when local already includes remote", async () => {
    const fixture = await makeRemoteFixture();
    try {
      await writeFile(join(fixture.local, "file.txt"), "initial\nlocal\n");
      git(fixture.local, ["add", "."]);
      git(fixture.local, ["commit", "-qm", "local ahead"]);
      const localSha = git(fixture.local, ["rev-parse", "HEAD"]);

      const verdict = await checkPushSafety({
        repoRoot: fixture.local,
        remote: "origin",
        remoteRef: "refs/heads/main",
        localSha,
      });

      const expectedRemoteSha = git(fixture.local, [
        "rev-parse",
        "refs/remotes/origin/main",
      ]);
      assert.deepEqual(verdict, {
        safe: true,
        lease: { remoteRef: "refs/heads/main", expectedRemoteSha },
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects when the remote has a commit local does not include", async () => {
    const fixture = await makeRemoteFixture();
    try {
      await writeFile(join(fixture.peer, "remote.txt"), "remote-only\n");
      git(fixture.peer, ["add", "."]);
      git(fixture.peer, ["commit", "-qm", "remote only"]);
      const remoteOnlySha = git(fixture.peer, ["rev-parse", "HEAD"]);
      git(fixture.peer, ["push", "-q", "origin", "main"]);
      const localSha = git(fixture.local, ["rev-parse", "HEAD"]);

      const verdict = await checkPushSafety({
        repoRoot: fixture.local,
        remote: "origin",
        remoteRef: "refs/heads/main",
        localSha,
      });

      assert.equal(verdict.safe, false);
      assert.deepEqual(
        verdict.safe ? [] : verdict.unincorporated,
        [remoteOnlySha],
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when fetch cannot complete before timeout", async () => {
    const fixture = await makeRemoteFixture();
    try {
      const localSha = git(fixture.local, ["rev-parse", "HEAD"]);

      const verdict = await checkPushSafety({
        repoRoot: fixture.local,
        remote: "origin",
        remoteRef: "refs/heads/main",
        localSha,
        timeoutMs: 0,
      });

      assert.deepEqual(verdict, { safe: false, unincorporated: [] });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not execute git options supplied as the remote name", async () => {
    const fixture = await makeRemoteFixture();
    try {
      const marker = join(fixture.root, "remote-injection");
      const localSha = git(fixture.local, ["rev-parse", "HEAD"]);

      const verdict = await checkPushSafety({
        repoRoot: fixture.local,
        remote: `--upload-pack=touch ${marker}`,
        remoteRef: "refs/heads/main",
        localSha,
      });

      assert.deepEqual(verdict, { safe: false, unincorporated: [] });
      await assert.rejects(access(marker));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not execute git options supplied as the remote ref", async () => {
    const fixture = await makeRemoteFixture();
    try {
      const marker = join(fixture.root, "ref-injection");
      const localSha = git(fixture.local, ["rev-parse", "HEAD"]);

      const verdict = await checkPushSafety({
        repoRoot: fixture.local,
        remote: "origin",
        remoteRef: `--upload-pack=touch ${marker}`,
        localSha,
      });

      assert.deepEqual(verdict, { safe: false, unincorporated: [] });
      await assert.rejects(access(marker));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
