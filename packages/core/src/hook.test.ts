import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_SCHEMA_VERSION,
  CONTRACT_SCHEMA_VERSION,
  evaluateHookGate,
  hasScopeLockHooks,
  installHooks,
  mergeClaudeHooks,
  mergeCodexHooks,
  mergeCursorHooks,
  removeClaudeHooks,
  removeCodexHooks,
  removeCursorHooks,
  saveContract,
  scopelockConfigSchema,
  scopelockPaths,
  setActiveContractId,
  writeJsonAtomic,
  writeApprovalSeal,
  type ApprovedContract,
} from "./index.js";

function contract(): ApprovedContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "hook-contract",
    task: "Hook test",
    createdAt: "2026-07-05T00:00:00.000Z",
    baseline: {
      headSha: "a".repeat(40),
      branch: "main",
      capturedAt: "2026-07-05T00:00:00.000Z",
    },
    targetAgents: [],
    scope: {
      plannedPathPatterns: ["src/planned/**"],
      forbiddenPathPatterns: ["src/auth/**"],
      allowAllPaths: false,
      readPathPatterns: [],
    },
    nodes: [],
    risks: [],
    tests: [],
    assumptions: [],
    openQuestions: [],
  };
}

async function makeScopelockRepo(mode: "warn" | "strict") {
  const root = await mkdtemp(join(tmpdir(), "scopelock-hook-"));
  const paths = scopelockPaths(root);
  await writeJsonAtomic(
    paths.configPath,
    scopelockConfigSchema.parse({ schemaVersion: CONFIG_SCHEMA_VERSION, mode }),
  );
  await saveContract(paths, contract());
  await setActiveContractId(paths, "hook-contract");
  await writeApprovalSeal(root, contract());
  return { root, paths };
}

describe("hook gate", () => {
  it("noops on invalid input and missing active contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "scopelock-hook-"));
    try {
      await writeJsonAtomic(
        scopelockPaths(root).configPath,
        scopelockConfigSchema.parse({ schemaVersion: CONFIG_SCHEMA_VERSION }),
      );

      assert.equal(
        (await evaluateHookGate({ cwd: root, rawInput: "not json" })).reason,
        "invalid-input",
      );
      assert.equal(
        (
          await evaluateHookGate({
            cwd: root,
            rawInput: JSON.stringify({ tool_input: { file_path: "src/x.ts" } }),
          })
        ).reason,
        "no-active-contract",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed on invalid input or missing contract in strict mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "scopelock-hook-strict-"));
    try {
      await writeJsonAtomic(
        scopelockPaths(root).configPath,
        scopelockConfigSchema.parse({ schemaVersion: CONFIG_SCHEMA_VERSION, mode: "strict" }),
      );
      assert.equal((await evaluateHookGate({ cwd: root, rawInput: "not json" })).decision, "deny");
      assert.equal(
        (
          await evaluateHookGate({
            cwd: root,
            rawInput: JSON.stringify({ tool_input: { file_path: "src/x.ts" } }),
          })
        ).reason,
        "no-active-contract",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("allows planned paths, audits warn mode and denies strict mode", async () => {
    const warn = await makeScopelockRepo("warn");
    const strict = await makeScopelockRepo("strict");
    try {
      const planned = await evaluateHookGate({
        cwd: warn.root,
        rawInput: JSON.stringify({ tool_input: { file_path: "src/planned/a.ts" } }),
      });
      assert.equal(planned.decision, "allow");

      const warned = await evaluateHookGate({
        cwd: warn.root,
        rawInput: JSON.stringify({ tool_input: { file_path: "src/other.ts" } }),
        now: "2026-07-05T00:00:00.000Z",
      });
      assert.equal(warned.decision, "warn");
      assert.match(await readFile(join(warn.paths.reportsDir, "audit.ndjson"), "utf8"), /outside/);

      const denied = await evaluateHookGate({
        cwd: strict.root,
        rawInput: JSON.stringify({ tool_input: { file_path: "src/auth/session.ts" } }),
      });
      assert.equal(denied.decision, "deny");
      assert.equal(denied.reason, "forbidden");
    } finally {
      await rm(warn.root, { recursive: true, force: true });
      await rm(strict.root, { recursive: true, force: true });
    }
  });

  it("denies any forbidden file in a Codex apply_patch payload", async () => {
    const strict = await makeScopelockRepo("strict");
    try {
      const denied = await evaluateHookGate({
        cwd: strict.root,
        rawInput: JSON.stringify({
          tool_name: "apply_patch",
          tool_input: {
            command: [
              "*** Begin Patch",
              "*** Update File: src/planned/a.ts",
              "@@",
              "-a",
              "+b",
              "*** Update File: src/auth/session.ts",
              "@@",
              "-a",
              "+b",
              "*** End Patch",
            ].join("\n"),
          },
        }),
      });

      assert.equal(denied.decision, "deny");
      assert.equal(denied.path, "src/auth/session.ts");
    } finally {
      await rm(strict.root, { recursive: true, force: true });
    }
  });

  it("protects ScopeLock state and denies writes through symlinks that escape the repo", async (t) => {
    const strict = await makeScopelockRepo("strict");
    const outside = await mkdtemp(join(tmpdir(), "scopelock-hook-outside-"));
    try {
      const protectedResult = await evaluateHookGate({
        cwd: strict.root,
        rawInput: JSON.stringify({ tool_input: { file_path: ".scopelock/config.json" } }),
      });
      assert.equal(protectedResult.reason, "self-protected");
      assert.equal(protectedResult.decision, "deny");

      await mkdir(join(strict.root, "src", "planned"), { recursive: true });
      try {
        await symlink(outside, join(strict.root, "src", "planned", "external"), "dir");
      } catch {
        t.skip("filesystem cannot create symlinks");
        return;
      }
      const escaped = await evaluateHookGate({
        cwd: strict.root,
        rawInput: JSON.stringify({ tool_input: { file_path: "src/planned/external/file.ts" } }),
      });
      assert.equal(escaped.reason, "symlink-escape");
      assert.equal(escaped.decision, "deny");
    } finally {
      await rm(strict.root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("records a hook-errors line and denies when a strict active contract is corrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "scopelock-hook-"));
    const paths = scopelockPaths(root);
    try {
      await writeJsonAtomic(
        paths.configPath,
        scopelockConfigSchema.parse({ schemaVersion: CONFIG_SCHEMA_VERSION, mode: "strict" }),
      );
      // Corrupt contract file: not schema-valid -> loadContract throws.
      await writeJsonAtomic(join(paths.contractsDir, "broken.json"), { nope: true });
      await setActiveContractId(paths, "broken");

      const result = await evaluateHookGate({
        cwd: root,
        rawInput: JSON.stringify({ tool_input: { file_path: "src/x.ts" } }),
        now: "2026-07-05T00:00:00.000Z",
      });

      assert.equal(result.decision, "deny");
      assert.equal(result.reason, "gate-error");
      const log = await readFile(join(paths.reportsDir, "hook-errors.ndjson"), "utf8");
      assert.match(log, /"error"/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("hook config merge", () => {
  it("installs and removes Claude hooks without touching foreign entries", () => {
    const foreign = { matcher: "Write", hooks: [{ type: "command", command: "echo ok" }] };
    const installed = mergeClaudeHooks({
      hooks: { PreToolUse: [foreign, { matcher: "Edit", hooks: [{ command: "scopelock hook gate" }] }] },
    });
    const reinstalled = mergeClaudeHooks(installed);
    const removed = removeClaudeHooks(reinstalled);

    assert.equal(hasScopeLockHooks(installed, "claude"), true);
    assert.deepEqual(installed, reinstalled);
    assert.deepEqual((removed.hooks as { PreToolUse: unknown[] }).PreToolUse, [foreign]);
  });

  it("installs and removes Cursor hooks without touching foreign entries", () => {
    const foreign = { command: "echo ok" };
    const installed = mergeCursorHooks({
      afterFileEdit: [foreign, { command: "scopelock hook audit" }],
    });
    const reinstalled = mergeCursorHooks(installed);
    const removed = removeCursorHooks(reinstalled);

    assert.equal(hasScopeLockHooks(installed, "cursor"), true);
    assert.deepEqual(installed, reinstalled);
    assert.deepEqual(removed.afterFileEdit, [foreign]);
  });

  it("installs and removes Codex hooks without touching foreign entries", () => {
    const foreign = { matcher: "^mcp__foreign__sentinel$", hooks: [{ command: "true" }] };
    const installed = mergeCodexHooks({
      hooks: { PreToolUse: [foreign, { matcher: "^apply_patch$", hooks: [{ command: "scopelock hook gate --format codex" }] }] },
    });
    const reinstalled = mergeCodexHooks(installed);
    const removed = removeCodexHooks(reinstalled);

    assert.equal(hasScopeLockHooks(installed, "codex"), true);
    assert.deepEqual(installed, reinstalled);
    assert.deepEqual((removed.hooks as { PreToolUse: unknown[] }).PreToolUse, [foreign]);
  });

  it("recognises custom --local command prefixes on reinstall and uninstall", () => {
    const prefix = 'node "/Users/x/My Repo/packages/cli/dist/index.js"';
    const foreign = { matcher: "Write", hooks: [{ type: "command", command: "echo ok" }] };

    const installed = mergeClaudeHooks({ hooks: { PreToolUse: [foreign] } }, prefix);
    const entry = (installed.hooks as { PreToolUse: { hooks: { command: string }[] }[] })
      .PreToolUse.at(-1);
    assert.equal(entry?.hooks[0]?.command, `${prefix} hook gate`);
    assert.equal(hasScopeLockHooks(installed, "claude"), true);

    const reinstalled = mergeClaudeHooks(installed, prefix);
    assert.deepEqual(installed, reinstalled);

    const removed = removeClaudeHooks(reinstalled);
    assert.deepEqual((removed.hooks as { PreToolUse: unknown[] }).PreToolUse, [foreign]);

    const cursorInstalled = mergeCursorHooks({ afterFileEdit: [] }, prefix);
    assert.equal(
      (cursorInstalled.afterFileEdit as { command: string }[])[0]?.command,
      `${prefix} hook audit`,
    );
    assert.equal(hasScopeLockHooks(cursorInstalled, "cursor"), true);
    assert.deepEqual(
      (removeCursorHooks(cursorInstalled).afterFileEdit as unknown[]),
      [],
    );
  });

  it("writes hook config files through installHooks", async () => {
    const root = await mkdtemp(join(tmpdir(), "scopelock-hooks-install-"));
    try {
      const path = await installHooks(root, "claude");
      const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      assert.equal(hasScopeLockHooks(raw, "claude"), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
