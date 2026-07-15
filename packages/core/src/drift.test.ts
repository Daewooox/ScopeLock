import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDriftReport,
  changedSinceBaseline,
  classifyPath,
  collectChangedFiles,
  driftReportFileName,
  highRiskViolations,
  injectContractSection,
  missingTestsViolation,
  parsePorcelainV2,
  type ApprovedContract,
  type ChangedFile,
} from "./index.js";

function changed(path: string): ChangedFile {
  return {
    path,
    previousPath: null,
    status: "modified",
    stage: "unstaged",
    isBinary: false,
    insertions: 0,
    deletions: 0,
    sizeBytes: 0,
  };
}

function contract(overrides: Partial<ApprovedContract> = {}): ApprovedContract {
  return {
    schemaVersion: 1,
    id: "contract-1",
    task: "Test contract",
    createdAt: "2026-07-05T00:00:00.000Z",
    baseline: null,
    targetAgents: [],
    scope: {
      plannedPathPatterns: ["src/**"],
      forbiddenPathPatterns: ["src/auth/**"],
      allowAllPaths: false,
      readPathPatterns: [],
    },
    nodes: [],
    risks: [],
    tests: [{ type: "unit", command: "pnpm test", required: true }],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
}

describe("porcelain v2 parser", () => {
  it("parses modified, untracked, rename, unicode and conflict records", () => {
    const raw = Buffer.from(
      [
        "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb src/app.ts",
        "1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/space name.ts",
        "? src/новый.ts",
        "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new.ts",
        "src/old.ts",
        "u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc src/conflict.ts",
        "",
      ].join("\0"),
    );

    const files = parsePorcelainV2(raw);

    assert.deepEqual(
      files.map((file) => [file.path, file.previousPath, file.status, file.stage]),
      [
        ["src/app.ts", null, "modified", "staged"],
        ["src/space name.ts", null, "modified", "unstaged"],
        ["src/новый.ts", null, "untracked", "untracked"],
        ["src/new.ts", "src/old.ts", "renamed", "staged"],
        ["src/conflict.ts", null, "conflicted", "conflicted"],
      ],
    );
  });
});

describe("rules and engine", () => {
  it("lets forbidden beat planned and checks rename previousPath", () => {
    const file = {
      path: "src/new.ts",
      previousPath: "src/auth/old.ts",
      status: "renamed" as const,
      stage: "staged" as const,
      isBinary: false,
      insertions: 0,
      deletions: 0,
      sizeBytes: 0,
    };

    assert.equal(classifyPath(file, contract().scope), "forbidden");
  });

  it("defaults an empty planned scope to deny-all unless explicitly unrestricted", () => {
    const c = contract({
      scope: { plannedPathPatterns: [], forbiddenPathPatterns: [], readPathPatterns: [], allowAllPaths: false },
    });
    const file = {
      path: "anywhere/file.ts",
      previousPath: null,
      status: "modified" as const,
      stage: "unstaged" as const,
      isBinary: false,
      insertions: 0,
      deletions: 0,
      sizeBytes: 0,
    };

    assert.equal(classifyPath(file, c.scope), "outside");
    assert.equal(classifyPath(file, { ...c.scope, allowAllPaths: true }), "planned");
  });

  it("flags missing tests only when required tests exist and no test file changed", () => {
    const changed = [
      {
        path: "src/app.ts",
        previousPath: null,
        status: "modified" as const,
        stage: "unstaged" as const,
        isBinary: false,
        insertions: 0,
        deletions: 0,
        sizeBytes: 0,
      },
    ];

    assert.equal(missingTestsViolation(changed, contract({ tests: [] })), null);
    assert.notEqual(missingTestsViolation(changed, contract()), null);
    assert.equal(
      missingTestsViolation(
        [{ ...changed[0], path: "src/app.test.ts" }],
        contract(),
      ),
      null,
    );
    assert.equal(
      missingTestsViolation(
        [{ ...changed[0], path: "Tests/WalletCoreTests/WalletCoreTests.swift" }],
        contract(),
        ["generic"],
      ),
      null,
    );
  });

  it("builds a drift report with outside scope, high-risk and repo state violations", () => {
    const report = buildDriftReport({
      contract: contract(),
      files: [
        {
          path: ".github/workflows/ci.yml",
          previousPath: null,
          status: "modified",
          stage: "unstaged",
          isBinary: false,
          insertions: 0,
          deletions: 0,
          sizeBytes: 0,
        },
      ],
      repoState: { kind: "merge" },
      repoMode: "normal",
      checkedAt: "2026-07-05T00:00:00.000Z",
    });

    assert.deepEqual(
      report.violations.map((violation) => violation.type),
      ["outside_scope", "high_risk_file", "missing_tests", "repo_state"],
    );
  });
});

describe("review fixes R1/R2", () => {
  it("R1: builds a Windows-safe drift report filename without colons", () => {
    const name = driftReportFileName("2026-07-05T21:00:00.000Z");
    assert.equal(name, "drift-2026-07-05T21-00-00.000Z.json");
    assert.ok(!name.includes(":"));
  });

  it("R2: flags high-risk files nested below the repo root", () => {
    const paths = highRiskViolations([
      changed("services/api/.env.local"),
      changed("apps/mobile/ios/App/Package.swift"),
      changed("infra/docker/Dockerfile.prod"),
      changed("frontend/package-lock.json"),
    ]).map((violation) => violation.path);

    assert.deepEqual(paths, [
      "services/api/.env.local",
      "apps/mobile/ios/App/Package.swift",
      "infra/docker/Dockerfile.prod",
      "frontend/package-lock.json",
    ]);
  });

  it("R2: does not flag ordinary nested source files", () => {
    assert.equal(highRiskViolations([changed("src/app/main.ts")]).length, 0);
  });
});

describe("git integration", () => {
  async function makeRepo(): Promise<string | null> {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-git-"));
    const init = spawnSync("git", ["init", "-q"], { cwd: dir });
    if (init.status !== 0) {
      await rm(dir, { recursive: true, force: true });
      return null;
    }
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    spawnSync("git", ["config", "user.name", "ScopeLock Test"], { cwd: dir });
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "app.ts"), "export const a = 1;\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["commit", "-qm", "initial"], { cwd: dir });
    return dir;
  }

  it("sees committed changes after baseline", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const baseline = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: dir,
        encoding: "utf8",
      }).stdout.trim();
      await writeFile(join(dir, "src", "outside.ts"), "export const b = 2;\n");
      spawnSync("git", ["add", "."], { cwd: dir });
      spawnSync("git", ["commit", "-qm", "after baseline"], { cwd: dir });

      const files = await changedSinceBaseline(dir, baseline);
      assert.equal(files[0]?.path, "src/outside.ts");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports merge-in-progress repo state", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], {
        cwd: dir,
        encoding: "utf8",
      }).stdout.trim();
      await writeFile(join(dir, gitDir, "MERGE_HEAD"), "deadbeef\n");
      const collected = await collectChangedFiles(dir, null);
      assert.equal(collected.repoState.kind, "merge");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores only the ScopeLock-owned instruction block", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const instructions = "Foreign instruction.\n";
      await writeFile(join(dir, "AGENTS.md"), instructions);
      spawnSync("git", ["add", "AGENTS.md"], { cwd: dir });
      spawnSync("git", ["commit", "-qm", "add instructions"], { cwd: dir });
      const baseline = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: dir,
        encoding: "utf8",
      }).stdout.trim();

      const injected = injectContractSection(instructions, "Current ScopeLock contract");
      await writeFile(join(dir, "AGENTS.md"), injected);
      assert.equal(
        (await collectChangedFiles(dir, baseline)).files.some((file) => file.path === "AGENTS.md"),
        false,
      );

      await writeFile(join(dir, "AGENTS.md"), `${injected}Foreign mutation.\n`);
      assert.equal(
        (await collectChangedFiles(dir, baseline)).files.some((file) => file.path === "AGENTS.md"),
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
