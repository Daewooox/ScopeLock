import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DEGRADED_FILE_THRESHOLD,
  approvedContractSchema,
  driftReportSchema,
  formatZodError,
  repoManifestSchema,
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
  });

  it("parses config with warn default", () => {
    const parsed = scopelockConfigSchema.parse({ schemaVersion: 1 });
    assert.equal(parsed.mode, "warn");
  });
});

describe("storage", () => {
  it("computes the .scopelock layout from a repo root", () => {
    const paths = scopelockPaths("/repo");
    assert.equal(paths.configPath, join("/repo", ".scopelock", "config.json"));
    assert.equal(paths.contractsDir, join("/repo", ".scopelock", "contracts"));
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
