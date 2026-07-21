import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { runGit, runGitAsync } from "./git/exec.js";

describe("Git argument safety", () => {
  it("rejects executable override options before synchronous Git execution", () => {
    const result = runGit(
      ["fetch", "--upload-pack=git upload-pack", "."],
      process.cwd(),
    );

    assert.equal(result.ok, false);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /unsafe git argument/u);
  });

  it("rejects executable override options before asynchronous Git execution", async () => {
    const result = await runGitAsync(
      ["fetch", "--upload-pack=git upload-pack", "."],
      process.cwd(),
    );

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
    assert.equal(result.timedOut, false);
    assert.match(result.stderr, /unsafe git argument/u);
  });

  it("rejects inline config that can launch an alias command", () => {
    const result = runGit(
      ["-c", "alias.pwn=!echo compromised", "pwn"],
      process.cwd(),
    );

    assert.equal(result.ok, false);
    assert.match(result.stderr, /unsafe git config/u);
  });

  it("rejects arbitrary Git subcommands and positional config operations", () => {
    const arbitrary = runGit(["pwn"], process.cwd());
    const config = runGit(
      ["config", "alias.pwn", "!echo compromised"],
      process.cwd(),
    );

    assert.equal(arbitrary.ok, false);
    assert.match(arbitrary.stderr, /unsafe git command/u);
    assert.equal(config.ok, false);
    assert.match(config.stderr, /unsafe git command/u);
  });

  it("does not allow an option outside its specific Git subcommand", () => {
    const result = runGit(
      ["commit", "-e", "-qm", "message"],
      process.cwd(),
    );

    assert.equal(result.ok, false);
    assert.match(result.stderr, /unsafe git argument/u);
  });

  it("rejects the ext remote helper transport", async () => {
    const result = await runGitAsync(
      ["fetch", "ext::echo compromised"],
      process.cwd(),
    );

    assert.equal(result.ok, false);
    assert.match(result.stderr, /unsafe git argument/u);
  });

  it("allows option-looking operands after an explicit terminator", () => {
    const result = runGit(
      ["ls-tree", "--name-only", "HEAD", "--", "-filename"],
      process.cwd(),
    );

    assert.equal(result.ok, true, result.stderr);
  });

  it("rejects double-dash operands even after an explicit terminator", () => {
    const result = runGit(
      ["ls-tree", "--name-only", "HEAD", "--", "--upload-pack=git upload-pack"],
      process.cwd(),
    );

    assert.equal(result.ok, false);
    assert.match(result.stderr, /unsafe git argument/u);
  });

  it("keeps ext remote helpers disabled even when repository config enables them", async () => {
    const root = await mkdtemp(join(tmpdir(), "scopelock-git-exec-"));
    try {
      assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
      assert.equal(
        spawnSync("git", ["config", "protocol.ext.allow", "always"], { cwd: root }).status,
        0,
      );
      assert.equal(
        spawnSync(
          "git",
          ["config", "remote.evil.url", "ext::git upload-pack ."],
          { cwd: root },
        ).status,
        0,
      );

      const result = await runGitAsync(
        ["fetch", "--no-tags", "--", "evil", "refs/heads/main"],
        root,
      );

      assert.equal(result.ok, false);
      assert.match(result.stderr, /transport 'ext' not allowed/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("forces an empty core.askPass for fetches", async () => {
    const root = await mkdtemp(join(tmpdir(), "scopelock-git-env-"));
    let requestCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="ScopeLock test"' });
      response.end();
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address !== null && typeof address !== "string");
      assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
      assert.equal(
        spawnSync("git", ["config", "core.askPass", "scopelock-should-not-run"], {
          cwd: root,
        }).status,
        0,
      );
      assert.equal(
        spawnSync(
          "git",
          ["config", "remote.evil.url", `http://127.0.0.1:${address.port}/repo`],
          { cwd: root },
        ).status,
        0,
      );

      const result = await runGitAsync(
        ["fetch", "--no-tags", "--", "evil", "refs/heads/main"],
        root,
      );

      assert.equal(result.ok, false);
      assert.ok(requestCount > 0, "Git must reach the authentication challenge");
      assert.doesNotMatch(result.stderr, /scopelock-should-not-run/u);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not reflect a rejected argument into error output", () => {
    const result = runGit(
      ["fetch", "--upload-pack=secret\u001b[2J", "."],
      process.cwd(),
    );

    assert.doesNotMatch(result.stderr, /secret|\u001b/u);
  });
});
