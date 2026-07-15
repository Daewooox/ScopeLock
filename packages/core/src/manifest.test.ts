import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildRepoManifest } from "./index.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function write(root: string, path: string, content = ""): Promise<void> {
  const fullPath = join(root, path);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scopelock-manifest-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "ScopeLock Test"]);
  git(root, ["config", "user.email", "test@example.com"]);
  return root;
}

describe("repo manifest builder", () => {
  it("builds a deterministic manifest from git tracked files", async () => {
    const root = await makeRepo();
    try {
      await write(root, "package.json", "{}\n");
      await write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
      await write(root, "vite.config.ts", "export default {};\n");
      await write(root, "src/main.tsx", "export {};\n");
      await write(root, "src/server.ts", "export {};\n");
      await write(root, "src/app.test.ts", "test('x', () => {});\n");
      await write(root, ".env.local", "SECRET=x\n");
      await write(root, "untracked.test.ts", "not tracked\n");
      git(root, ["add", "package.json", "pnpm-lock.yaml", "vite.config.ts", "src", ".env.local"]);
      git(root, ["commit", "-m", "fixture", "-q"]);

      const manifest = buildRepoManifest(root);

      assert.equal(resolve(manifest.root), resolve(await realpath(root)));
      assert.match(manifest.headSha ?? "", /^[a-f0-9]{40}$/);
      assert.deepEqual(manifest.packageManagers, ["pnpm"]);
      assert.deepEqual(manifest.projectTypes, ["backend", "frontend"]);
      assert.deepEqual(manifest.files, [
        ".env.local",
        "package.json",
        "pnpm-lock.yaml",
        "src/app.test.ts",
        "src/main.tsx",
        "src/server.ts",
        "vite.config.ts",
      ]);
      assert.deepEqual(manifest.testPaths, ["src/app.test.ts"]);
      assert.deepEqual(manifest.riskyPaths, [".env.local", "pnpm-lock.yaml"]);
      assert.ok(!manifest.files.includes("untracked.test.ts"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to generic when no known project markers exist", async () => {
    const root = await makeRepo();
    try {
      await write(root, "README.md", "# fixture\n");
      git(root, ["add", "README.md"]);
      git(root, ["commit", "-m", "fixture", "-q"]);

      const manifest = buildRepoManifest(root);

      assert.deepEqual(manifest.projectTypes, ["generic"]);
      assert.deepEqual(manifest.packageManagers, []);
      assert.deepEqual(manifest.testPaths, []);
      assert.deepEqual(manifest.riskyPaths, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recognizes a Swift package and its conventional test target", async () => {
    const root = await makeRepo();
    try {
      await write(root, "Package.swift", "// swift-tools-version: 6.0\n");
      await write(root, "Sources/WalletCore/Wallet.swift", "public struct Wallet {}\n");
      await write(root, "Tests/WalletCoreTests/WalletCoreTests.swift", "import Testing\n");
      git(root, ["add", "."]);
      git(root, ["commit", "-m", "fixture", "-q"]);

      const manifest = buildRepoManifest(root);

      assert.deepEqual(manifest.projectTypes, ["swift"]);
      assert.deepEqual(manifest.testPaths, ["Tests/WalletCoreTests/WalletCoreTests.swift"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
