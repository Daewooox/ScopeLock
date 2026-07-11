import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  headSha,
  saveContract,
  scopelockPaths,
  setActiveContractId,
  type ApprovedContract,
} from "@scopelock/core";
import { checkDriftTool, planParallelTool, scopesConflictTool } from "./tools.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scopelock-mcp-test-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "ScopeLock Test"]);
  git(root, ["config", "user.email", "test@example.com"]);
  await writeFile(join(root, "src.ts"), "export const value = 1;\n");
  await writeFile(join(root, "config.json"), "{\"ok\":true}\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial", "-q"]);
  return root;
}

function contract(id: string, planned: string[], baseline: string | null = null): ApprovedContract {
  return {
    schemaVersion: 1,
    id,
    task: id,
    createdAt: "2026-07-10T00:00:00.000Z",
    baseline:
      baseline === null
        ? null
        : {
            headSha: baseline,
            branch: "main",
            capturedAt: "2026-07-10T00:00:00.000Z",
          },
    targetAgents: [],
    scope: {
      plannedPathPatterns: planned,
      forbiddenPathPatterns: [],
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

test("plan_parallel schedules language-agnostic contract scopes", async () => {
  const root = await makeRepo();
  await writeFile(join(root, "ts.json"), JSON.stringify(contract("ts", ["src/**"]), null, 2));
  await writeFile(
    join(root, "config-json.json"),
    JSON.stringify(contract("config-json", ["config/*.json"]), null, 2),
  );
  await writeFile(
    join(root, "config-all.json"),
    JSON.stringify(contract("config-all", ["config/**"]), null, 2),
  );

  const independent = await planParallelTool({
    repoRoot: root,
    plan: {
      schemaVersion: 1,
      planId: "independent",
      tasks: [
        { id: "config-json", contract: "config-json.json" },
        { id: "ts", contract: "ts.json" },
      ],
    },
  });
  assert.deepEqual(independent.waves, [["config-json", "ts"]]);
  assert.deepEqual(independent.conflicts, []);

  const conflicted = await planParallelTool({
    repoRoot: root,
    plan: {
      schemaVersion: 1,
      planId: "conflicted",
      tasks: [
        { id: "config-all", contract: "config-all.json" },
        { id: "config-json", contract: "config-json.json" },
      ],
    },
  });
  assert.deepEqual(conflicted.waves, [["config-all"], ["config-json"]]);
  assert.equal(conflicted.conflicts[0]?.kind, "write-write");
  assert.equal(conflicted.conflicts[0]?.witness, "config/.json");
});

test("scopes_conflict returns a boolean and witness detail", () => {
  const result = scopesConflictTool({
    a: { id: "a", planned: ["config/**"], forbidden: [], read: [] },
    b: { id: "b", planned: ["config/*.yaml"], forbidden: [], read: [] },
  });
  assert.equal(result.conflict, true);
  assert.equal(result.detail?.kind, "write-write");
  assert.equal(result.detail?.witness, "config/.yaml");
});

test("check_drift reports violations for the active contract", async () => {
  const root = await makeRepo();
  const paths = scopelockPaths(root);
  const baseline = headSha(root);
  await saveContract(paths, contract("active", ["src/**"], baseline));
  await setActiveContractId(paths, "active");

  await writeFile(join(root, "config.json"), "{\"ok\":false}\n");
  const result = await checkDriftTool({ repoRoot: root });

  assert.equal(result.ok, false);
  assert.equal(result.report.contractId, "active");
  assert.equal(result.report.violations[0]?.type, "outside_scope");
});
