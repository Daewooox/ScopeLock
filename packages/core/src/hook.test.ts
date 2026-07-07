import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_SCHEMA_VERSION,
  CONTRACT_SCHEMA_VERSION,
  evaluateHookGate,
  hasScopeLockHooks,
  installHooks,
  mergeClaudeHooks,
  mergeCursorHooks,
  removeClaudeHooks,
  removeCursorHooks,
  saveContract,
  scopelockConfigSchema,
  scopelockPaths,
  setActiveContractId,
  writeJsonAtomic,
  type ApprovedContract,
} from "./index.js";

function contract(): ApprovedContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "hook-contract",
    task: "Hook test",
    createdAt: "2026-07-05T00:00:00.000Z",
    baseline: null,
    targetAgents: [],
    scope: {
      plannedPathPatterns: ["src/planned/**"],
      forbiddenPathPatterns: ["src/auth/**"],
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

  it("A1: records a hook-errors line and noops when the active contract is corrupt", async () => {
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

      assert.equal(result.decision, "noop");
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
