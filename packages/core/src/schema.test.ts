import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DEGRADED_FILE_THRESHOLD,
  approvedContractSchema,
  contractFilePath,
  contractIdSchema,
  driftReportSchema,
  formatZodError,
  normalizePlanValidation,
  repoManifestSchema,
  schedulePlanSchema,
  scopelockConfigSchema,
  scopelockPaths,
  writeJsonAtomic,
} from "./index.js";

describe("review follow-ups A4/A5", () => {
  it("A5: config defaults degradedFileThreshold and accepts overrides", () => {
    assert.equal(
      scopelockConfigSchema.parse({ schemaVersion: 1 }).degradedFileThreshold,
      DEFAULT_DEGRADED_FILE_THRESHOLD,
    );
    assert.equal(
      scopelockConfigSchema.parse({ schemaVersion: 1, degradedFileThreshold: 50 })
        .degradedFileThreshold,
      50,
    );
    assert.throws(() =>
      scopelockConfigSchema.parse({ schemaVersion: 1, degradedFileThreshold: -1 }),
    );
  });

  it("A4: formatZodError compacts issues and ignores non-zod errors", () => {
    const result = approvedContractSchema.safeParse({
      schemaVersion: 1,
      id: "",
      task: "x",
      createdAt: "2026-07-05T00:00:00.000Z",
      scope: { plannedPathPatterns: [], forbiddenPathPatterns: [] },
    });
    assert.equal(result.success, false);
    const message = formatZodError(result.error);
    assert.ok(message !== null && message.includes("id:"));
    assert.ok(!message.includes("\n"));
    assert.equal(formatZodError(new Error("plain")), null);
  });
});

describe("ScopeLock schemas", () => {
  it("accepts filesystem-safe contract ids and rejects traversal", () => {
    for (const id of ["a", "contract-1", "phase3.5_test", "a".repeat(64)]) {
      assert.equal(contractIdSchema.parse(id), id);
    }
    for (const id of ["../config", "a/b", "/tmp/x", "C:\\tmp\\x", "UPPER", "a".repeat(65)]) {
      assert.equal(contractIdSchema.safeParse(id).success, false, id);
    }
  });
  it("parses the minimum approved contract with null baseline", () => {
    const parsed = approvedContractSchema.parse({
      schemaVersion: 1,
      id: "contract-1",
      task: "Keep agent inside venue scope",
      createdAt: "2026-07-05T00:00:00.000Z",
      scope: {
        plannedPathPatterns: ["src/venue/**"],
        forbiddenPathPatterns: ["src/auth/**"],
      },
    });

    assert.equal(parsed.baseline, null);
    assert.deepEqual(parsed.nodes, []);
    assert.deepEqual(parsed.targetAgents, []);
    // Backward compatibility (M5): older contracts with no readPathPatterns
    // at all still parse, defaulting to no declared reads.
    assert.deepEqual(parsed.scope.readPathPatterns, []);
  });

  it("parses a contract that declares readPathPatterns (M5)", () => {
    const parsed = approvedContractSchema.parse({
      schemaVersion: 1,
      id: "contract-read",
      task: "Reads shared types",
      createdAt: "2026-07-05T00:00:00.000Z",
      scope: {
        plannedPathPatterns: ["src/api/**"],
        forbiddenPathPatterns: [],
        readPathPatterns: ["src/types/**"],
      },
    });

    assert.deepEqual(parsed.scope.readPathPatterns, ["src/types/**"]);
  });

  it("parses an approved contract with baseline stamped", () => {
    const parsed = approvedContractSchema.parse({
      schemaVersion: 1,
      id: "contract-2",
      task: "Baseline test",
      createdAt: "2026-07-05T00:00:00.000Z",
      baseline: {
        headSha: "a".repeat(40),
        branch: "main",
        capturedAt: "2026-07-05T00:00:00.000Z",
      },
      scope: {},
    });

    assert.equal(parsed.baseline?.branch, "main");
  });

  it("rejects unknown node types", () => {
    const result = approvedContractSchema.safeParse({
      schemaVersion: 1,
      id: "contract-3",
      task: "Node type test",
      createdAt: "2026-07-05T00:00:00.000Z",
      scope: {},
      nodes: [
        {
          id: "n1",
          label: "Something",
          type: "banana",
          confidence: 0.5,
        },
      ],
    });

    assert.equal(result.success, false);
  });

  it("parses rename-aware drift reports", () => {
    const parsed = driftReportSchema.parse({
      schemaVersion: 1,
      contractId: "contract-1",
      checkedAt: "2026-07-05T00:00:00.000Z",
      changedFiles: [
        {
          path: "src/new.ts",
          previousPath: "src/old.ts",
          status: "renamed",
          stage: "unstaged",
        },
      ],
    });

    assert.equal(parsed.changedFiles[0]?.previousPath, "src/old.ts");
  });

  it("parses a repo manifest", () => {
    const parsed = repoManifestSchema.parse({
      schemaVersion: 1,
      root: "/repo",
      files: ["package.json"],
    });

    assert.deepEqual(parsed.projectTypes, ["generic"]);
    assert.deepEqual(
      repoManifestSchema.parse({ schemaVersion: 1, root: "/swift", projectTypes: ["swift"] }).projectTypes,
      ["swift"],
    );
  });

  it("parses config with warn default", () => {
    const parsed = scopelockConfigSchema.parse({ schemaVersion: 1 });
    assert.equal(parsed.mode, "warn");
  });

  it("parses a shell-free repository validation command", () => {
    const parsed = schedulePlanSchema.parse({
      schemaVersion: 1,
      planId: "validated",
      execution: {
        isolation: "required",
        validation: {
          cwd: "apps/mobile",
          setup: ["npm", "run", "prepare"],
          command: ["npm", "run", "check"],
        },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    });

    assert.equal(parsed.execution?.validation?.cwd, "apps/mobile");
    assert.deepEqual(parsed.execution?.validation?.setup, ["npm", "run", "prepare"]);
    assert.deepEqual(parsed.execution?.validation?.command, ["npm", "run", "check"]);
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "shell-string",
      execution: {
        isolation: "required",
        validation: { command: "npm run check" },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("accepts only portable repository-relative validation working directories", () => {
    for (const cwd of [".", "app", "packages/mobile app"]) {
      assert.equal(schedulePlanSchema.safeParse({
        schemaVersion: 1,
        planId: `valid-${cwd}`,
        execution: { validation: { cwd, command: ["flutter", "test"] } },
        tasks: [{ id: "task", contract: "task.json" }],
      }).success, true, cwd);
    }

    for (const cwd of ["", "/tmp", "C:/tmp", "C:\\tmp", "../outside", "app/../outside", "./app", "app//test", "app\\test", "app:", "app\0test"]) {
      assert.equal(schedulePlanSchema.safeParse({
        schemaVersion: 1,
        planId: "invalid-cwd",
        execution: { validation: { cwd, command: ["flutter", "test"] } },
        tasks: [{ id: "task", contract: "task.json" }],
      }).success, false, cwd);
    }
  });

  it("accepts an ordered list of shell-free validation checks", () => {
    const parsed = schedulePlanSchema.parse({
      schemaVersion: 1,
      planId: "checks",
      execution: {
        isolation: "required",
        validation: {
          cwd: "app",
          setup: ["flutter", "pub", "get"],
          checks: [
            {
              id: "widget-tests",
              command: ["flutter", "test", "test/widgets/async_submit_test.dart"],
              required: true,
            },
            {
              id: "analyze",
              command: ["flutter", "analyze"],
              cwd: "app/tools",
            },
          ],
          acceptance: { checkIds: ["widget-tests", "analyze"] },
        },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    });

    const validation = parsed.execution?.validation;
    assert.equal(validation?.checks?.length, 2);
    assert.equal(validation?.checks?.[1]?.cwd, "app/tools");
    // required defaults to true when omitted
    assert.equal(validation?.checks?.[1]?.required, true);
    assert.deepEqual(validation?.acceptance?.checkIds, ["widget-tests", "analyze"]);
  });

  it("rejects legacy command combined with checks", () => {
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "both",
      execution: {
        validation: {
          command: ["npm", "test"],
          checks: [{ id: "a", command: ["npm", "test"] }],
        },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("rejects validation with neither command nor checks", () => {
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "neither",
      execution: {
        validation: { cwd: "app" },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("rejects duplicate check ids", () => {
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "dupe",
      execution: {
        validation: {
          checks: [
            { id: "a", command: ["npm", "test"] },
            { id: "a", command: ["npm", "lint"] },
          ],
        },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("rejects acceptance ids that reference unknown checks", () => {
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "unknown-acceptance",
      execution: {
        validation: {
          checks: [{ id: "a", command: ["npm", "test"] }],
          acceptance: { checkIds: ["missing"] },
        },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("rejects acceptance ids that reference optional checks", () => {
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "optional-acceptance",
      execution: {
        validation: {
          checks: [{ id: "a", command: ["npm", "test"], required: false }],
          acceptance: { checkIds: ["a"] },
        },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("rejects invalid check ids", () => {
    for (const id of ["Bad-ID", "-leading", "has space", "", "a".repeat(65)]) {
      assert.equal(schedulePlanSchema.safeParse({
        schemaVersion: 1,
        planId: "invalid-id",
        execution: {
          validation: { checks: [{ id, command: ["npm", "test"] }] },
        },
        tasks: [{ id: "task", contract: "task.json" }],
      }).success, false, id);
    }
  });

  it("rejects more than 16 checks", () => {
    const checks = Array.from({ length: 17 }, (_, i) => ({
      id: `check-${i}`,
      command: ["npm", "test"],
    }));
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "too-many-checks",
      execution: { validation: { checks } },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("rejects empty commands and unsafe check cwd values", () => {
    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "empty-command",
      execution: { validation: { checks: [{ id: "a", command: [] }] } },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);

    assert.equal(schedulePlanSchema.safeParse({
      schemaVersion: 1,
      planId: "unsafe-check-cwd",
      execution: {
        validation: { checks: [{ id: "a", command: ["npm", "test"], cwd: "../outside" }] },
      },
      tasks: [{ id: "task", contract: "task.json" }],
    }).success, false);
  });

  it("normalizes legacy command into a single required repository-validation check", () => {
    const normalized = normalizePlanValidation({
      cwd: "apps/mobile",
      setup: ["npm", "run", "prepare"],
      command: ["npm", "run", "check"],
    });

    assert.deepEqual(normalized.setup, ["npm", "run", "prepare"]);
    assert.deepEqual(normalized.checks, [
      {
        id: "repository-validation",
        command: ["npm", "run", "check"],
        cwd: "apps/mobile",
        required: true,
      },
    ]);
    // Legacy plans have no declared acceptance ids: unverified by default.
    assert.deepEqual(normalized.acceptanceCheckIds, []);
  });

  it("normalizes modern checks, inheriting shared cwd when a check omits its own", () => {
    const normalized = normalizePlanValidation({
      cwd: "app",
      checks: [
        { id: "widget-tests", command: ["flutter", "test"], required: true },
        { id: "analyze", command: ["flutter", "analyze"], cwd: "app/tools", required: false },
      ],
      acceptance: { checkIds: ["widget-tests"] },
    });

    assert.deepEqual(normalized.checks, [
      { id: "widget-tests", command: ["flutter", "test"], cwd: "app", required: true },
      { id: "analyze", command: ["flutter", "analyze"], cwd: "app/tools", required: false },
    ]);
    assert.deepEqual(normalized.acceptanceCheckIds, ["widget-tests"]);
  });
});

describe("storage", () => {
  it("keeps contract paths inside the contracts directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-contract-path-"));
    try {
      const paths = scopelockPaths(dir);
      assert.equal(contractFilePath(paths, "safe-id"), join(paths.contractsDir, "safe-id.json"));
      assert.throws(() => contractFilePath(paths, "../../escape"));

      await mkdir(paths.dir, { recursive: true });
      await writeFile(paths.activePath, JSON.stringify("../../escape"));
      const { getActiveContractId } = await import("./storage/contracts.js");
      await assert.rejects(() => getActiveContractId(paths));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("computes the .scopelock layout from a repo root", () => {
    const paths = scopelockPaths("/repo");
    assert.equal(paths.configPath, join("/repo", ".scopelock", "config.json"));
    assert.equal(paths.contractsDir, join("/repo", ".scopelock", "contracts"));
    assert.equal(paths.draftsDir, join("/repo", ".scopelock", "drafts"));
    assert.equal(paths.activePath, join("/repo", ".scopelock", "active"));
  });

  it("writes JSON atomically and creates parent dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-test-"));
    try {
      const target = join(dir, "nested", "file.json");
      await writeJsonAtomic(target, { hello: "world" });
      const raw = await readFile(target, "utf8");
      assert.deepEqual(JSON.parse(raw), { hello: "world" });
      assert.ok(raw.endsWith("\n"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
