import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmod, mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = fileURLToPath(new URL("./index.js", import.meta.url));

type RunResult = { status: number; stdout: string; stderr: string };

function runCli(cwd: string, args: string[]): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    input: "",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function makeRepo(): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "scopelock-cli-"));
  const init = spawnSync("git", ["init", "-q"], { cwd: dir });
  if (init.status !== 0) {
    await rm(dir, { recursive: true, force: true });
    return null;
  }
  spawnSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-qm", "init"], { cwd: dir });
  return dir;
}

describe("cli end-to-end", () => {
  it("init -> contract new -> approve -> check-drift respects the exit-code contract", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);

      // Write the draft outside the repo so it does not itself count as drift.
      const draftPath = join(tmpdir(), `sl-draft-${Date.now()}.json`);
      const draft = runCli(dir, [
        "contract",
        "new",
        "--task",
        "scoped change",
        "--planned",
        "src/**",
        "--forbidden",
        "secrets/**",
        "--out",
        draftPath,
      ]);
      assert.equal(draft.status, 0);

      const approve = runCli(dir, ["--json", "approve", draftPath]);
      assert.equal(approve.status, 0);
      assert.equal(JSON.parse(approve.stdout).status, "ok");

      // Clean tree after baseline -> no drift -> exit 0.
      const clean = runCli(dir, ["--json", "check-drift"]);
      assert.equal(clean.status, 0);
      assert.equal(JSON.parse(clean.stdout).data.report.violations.length, 0);

      // Write a forbidden file -> violations -> exit 1.
      await mkdir(join(dir, "secrets"), { recursive: true });
      await writeFile(join(dir, "secrets", "key.txt"), "x");
      const dirty = runCli(dir, ["--json", "check-drift"]);
      assert.equal(dirty.status, 1);
      const report = JSON.parse(dirty.stdout).data.report;
      assert.ok(report.violations.some((v: { type: string }) => v.type === "forbidden_path"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports BASELINE_NOT_FOUND (not raw git fatal) when the baseline commit is gone", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      const draftPath = join(tmpdir(), `sl-draft-baseline-${Date.now()}.json`);
      assert.equal(
        runCli(dir, [
          "contract",
          "new",
          "--task",
          "scoped change",
          "--planned",
          "src/**",
          "--out",
          draftPath,
        ]).status,
        0,
      );
      assert.equal(runCli(dir, ["--json", "approve", draftPath]).status, 0);

      // Simulate a history rewrite: point the active contract's baseline at a
      // commit that no longer exists.
      const activeId = JSON.parse(
        await readFile(join(dir, ".scopelock", "active"), "utf8"),
      ) as string;
      const activePath = join(dir, ".scopelock", "contracts", `${activeId}.json`);
      const contract = JSON.parse(await readFile(activePath, "utf8"));
      contract.baseline.headSha = "0".repeat(40);
      await writeFile(activePath, JSON.stringify(contract));

      const res = runCli(dir, ["--json", "check-drift"]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "BASELINE_NOT_FOUND");
      assert.doesNotMatch(body.error.message, /fatal|UNEXPECTED/);
      // The guidance must point at a command that actually works: `approve`
      // would fail with CONTRACT_ID_EXISTS on an already-saved contract.
      assert.match(body.error.message, /rebaseline/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rebaseline repairs a stale baseline so check-drift works again", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      const draftPath = join(tmpdir(), `sl-rebase-${Date.now()}.json`);
      assert.equal(
        runCli(dir, [
          "contract",
          "new",
          "--task",
          "scoped change",
          "--planned",
          "src/**",
          "--out",
          draftPath,
        ]).status,
        0,
      );
      assert.equal(runCli(dir, ["--json", "approve", draftPath]).status, 0);

      const activeId = JSON.parse(
        await readFile(join(dir, ".scopelock", "active"), "utf8"),
      ) as string;
      const activePath = join(dir, ".scopelock", "contracts", `${activeId}.json`);
      const contract = JSON.parse(await readFile(activePath, "utf8"));
      const createdAt = contract.createdAt;
      contract.baseline.headSha = "0".repeat(40);
      await writeFile(activePath, JSON.stringify(contract));

      // Broken.
      assert.equal(runCli(dir, ["--json", "check-drift"]).status, 2);

      // Repair.
      const rebase = runCli(dir, ["--json", "rebaseline"]);
      assert.equal(rebase.status, 0);
      assert.equal(JSON.parse(rebase.stdout).status, "ok");

      // Works again, and the contract's identity is preserved (only baseline changed).
      assert.equal(runCli(dir, ["--json", "check-drift"]).status, 0);
      const repaired = JSON.parse(await readFile(activePath, "utf8"));
      assert.equal(repaired.id, activeId);
      assert.equal(repaired.createdAt, createdAt);
      assert.notEqual(repaired.baseline.headSha, "0".repeat(40));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rebaseline exits 2 with CONTRACT_NOT_FOUND for an unknown id", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      const res = runCli(dir, ["--json", "rebaseline", "no-such-contract"]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "CONTRACT_NOT_FOUND");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a compact error and exit 2 outside a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-nogit-"));
    try {
      const res = runCli(dir, ["--json", "check-drift"]);
      assert.equal(res.status, 2);
      assert.equal(JSON.parse(res.stdout).status, "error");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("contract new prints schema-valid JSON to stdout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-cn-"));
    try {
      const res = runCli(dir, ["contract", "new", "--task", "x", "--planned", "a/**"]);
      assert.equal(res.status, 0);
      const contract = JSON.parse(res.stdout);
      assert.equal(contract.schemaVersion, 1);
      assert.deepEqual(contract.scope.plannedPathPatterns, ["a/**"]);
      assert.equal(contract.baseline, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("plan-parallel", () => {
  async function writeContract(
    dir: string,
    file: string,
    id: string,
    planned: string[],
    read: string[] = [],
  ): Promise<void> {
    const res = runCli(dir, [
      "contract",
      "new",
      "--task",
      id,
      "--id",
      id,
      ...planned.flatMap((glob) => ["--planned", glob]),
      ...read.flatMap((glob) => ["--read", glob]),
      "--out",
      file,
    ]);
    assert.equal(res.status, 0, res.stderr);
  }

  it("schedules disjoint contracts into a single wave with no conflicts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      await writeContract(dir, join(dir, "t1.json"), "t1", ["src/ui/**"]);
      await writeContract(dir, join(dir, "t2.json"), "t2", ["src/api/**"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "disjoint-demo",
          tasks: [
            { id: "t1", contract: "t1.json" },
            { id: "t2", contract: "t2.json" },
          ],
        }),
      );

      const res = runCli(dir, ["--json", "plan-parallel", "plan.json"]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.deepEqual(body.data.waves, [["t1", "t2"]]);
      assert.deepEqual(body.data.conflicts, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes overlapping contracts into two waves with a witness", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      await writeContract(dir, join(dir, "t1.json"), "t1", ["src/shared/**"]);
      await writeContract(dir, join(dir, "t2.json"), "t2", ["src/shared/utils.ts"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "overlap-demo",
          tasks: [
            { id: "t1", contract: "t1.json" },
            { id: "t2", contract: "t2.json" },
          ],
        }),
      );

      const res = runCli(dir, ["--json", "plan-parallel", "plan.json"]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.deepEqual(body.data.waves, [["t1"], ["t2"]]);
      assert.equal(body.data.conflicts.length, 1);
      assert.equal(body.data.conflicts[0].kind, "write-write");
      assert.equal(body.data.conflicts[0].witness, "src/shared/utils.ts");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with a compact error on a missing plan file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      const res = runCli(dir, ["--json", "plan-parallel", "missing-plan.json"]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "PLAN_NOT_FOUND");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with a compact error on an invalid plan.json shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({ schemaVersion: 1, planId: "empty", tasks: [] }),
      );
      const res = runCli(dir, ["--json", "plan-parallel", "plan.json"]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "INVALID_INPUT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with INVALID_INPUT (not UNEXPECTED) on duplicate task ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      await writeContract(dir, join(dir, "t1.json"), "t1", ["src/ui/**"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "dup-demo",
          tasks: [
            { id: "t1", contract: "t1.json" },
            { id: "t1", contract: "t1.json" },
          ],
        }),
      );
      const res = runCli(dir, ["--json", "plan-parallel", "plan.json"]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "INVALID_INPUT");
      assert.match(body.error.message, /duplicate task id: t1/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("F2: --include-read-hazards orders a writer before a reader of the same path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      await writeContract(dir, join(dir, "writer.json"), "writer", ["src/shared.ts"]);
      await writeContract(
        dir,
        join(dir, "reader.json"),
        "reader",
        ["src/consumer.ts"],
        ["src/shared.ts"],
      );
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "read-hazard-demo",
          tasks: [
            { id: "writer", contract: "writer.json" },
            { id: "reader", contract: "reader.json" },
          ],
        }),
      );

      const res = runCli(dir, ["--json", "plan-parallel", "plan.json", "--include-read-hazards"]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.deepEqual(body.data.waves, [["writer"], ["reader"]]);
      assert.deepEqual(body.data.cycles, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("F2: a read-write cycle exits 1 and lists the cycle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["src/a.ts"], ["src/b.ts"]);
      await writeContract(dir, join(dir, "b.json"), "b", ["src/b.ts"], ["src/a.ts"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "cycle-demo",
          tasks: [
            { id: "a", contract: "a.json" },
            { id: "b", contract: "b.json" },
          ],
        }),
      );

      const res = runCli(dir, ["--json", "plan-parallel", "plan.json", "--include-read-hazards"]);
      assert.equal(res.status, 1);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "violations");
      assert.deepEqual(body.data.cycles, [["a", "b"]]);
      assert.deepEqual(body.data.waves, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("F1 default: without --include-read-hazards, readPathPatterns are ignored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-plan-"));
    try {
      // Same writer/reader pair as the F2 test above, but the flag is
      // omitted: read hazards must not affect the schedule (backward
      // compatibility with F1-only plans).
      await writeContract(dir, join(dir, "writer.json"), "writer", ["src/shared.ts"]);
      await writeContract(
        dir,
        join(dir, "reader.json"),
        "reader",
        ["src/consumer.ts"],
        ["src/shared.ts"],
      );
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "no-flag-demo",
          tasks: [
            { id: "writer", contract: "writer.json" },
            { id: "reader", contract: "reader.json" },
          ],
        }),
      );

      const res = runCli(dir, ["--json", "plan-parallel", "plan.json"]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.deepEqual(body.data.waves, [["reader", "writer"]]);
      assert.deepEqual(body.data.cycles, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("manifest", () => {
  it("prints a repo manifest built from tracked git files", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "package.json"), "{}\n");
      await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "index.ts"), "export {};\n");
      await writeFile(join(dir, "src", "index.test.ts"), "test('x', () => {});\n");
      await writeFile(join(dir, "untracked.test.ts"), "not tracked\n");
      spawnSync("git", ["add", "package.json", "pnpm-lock.yaml", "src"], { cwd: dir });
      spawnSync("git", ["commit", "-qm", "manifest fixture"], { cwd: dir });

      const res = runCli(dir, ["--json", "manifest"]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      const manifest = body.data.manifest;
      assert.deepEqual(manifest.packageManagers, ["pnpm"]);
      assert.deepEqual(manifest.projectTypes, ["backend"]);
      assert.ok(manifest.files.includes("src/index.ts"));
      assert.ok(!manifest.files.includes("untracked.test.ts"));
      assert.deepEqual(manifest.testPaths, ["src/index.test.ts"]);
      assert.deepEqual(manifest.riskyPaths, ["pnpm-lock.yaml"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("agents preflight", () => {
  async function seedSkill(dir: string, relDir: string, content = "SKILL.md\n"): Promise<void> {
    await mkdir(join(dir, relDir), { recursive: true });
    await writeFile(join(dir, relDir, "SKILL.md"), content);
  }

  async function writeManifest(dir: string, manifest: unknown): Promise<string> {
    const path = join(dir, "agents.json");
    await writeFile(path, JSON.stringify(manifest));
    return "agents.json";
  }

  it("passes when every target has a matching physical rule and skill", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "AGENTS.md"), "RULE\n");
      await writeFile(join(dir, "CLAUDE.md"), "RULE\n");
      await seedSkill(dir, ".agents/skills/review");
      await seedSkill(dir, ".claude/skills/review");
      await seedSkill(dir, ".cursor/skills/review");

      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["claude", "cursor", "codex"],
        rules: [{ id: "agents", path: "AGENTS.md", required: true }],
        skills: [{ name: "review", path: ".agents/skills/review", required: true }],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });

      const res = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.equal(body.data.report.summary.status, "pass");
      assert.equal(body.data.report.summary.violationsCount, 0);
      assert.equal(body.data.report.targets.length, 3);

      const claude = body.data.report.targets.find((t: { id: string }) => t.id === "claude");
      const cursor = body.data.report.targets.find((t: { id: string }) => t.id === "cursor");
      const codex = body.data.report.targets.find((t: { id: string }) => t.id === "codex");
      assert.equal(claude.hook.capabilities.confidence, "documented");
      assert.equal(claude.hook.capabilities.canDeny, true);
      assert.equal(cursor.hook.capabilities.canDeny, false);
      // codex: no dedicated hook adapter yet, always degraded (see capabilities.ts)
      assert.equal(codex.hook.capabilities.confidence, "degraded");
      assert.equal(codex.hook.installed, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reflects a real installed claude hook entry as installed=true, confidence=documented", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      assert.equal(runCli(dir, ["hooks", "install", "--target", "claude", "--local"]).status, 0);
      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["claude"],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });

      const res = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      const claude = body.data.report.targets[0];
      assert.equal(claude.hook.installed, true);
      assert.equal(claude.hook.capabilities.confidence, "documented");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reflects an installed codex hook entry as installed=true but confidence=degraded", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      assert.equal(runCli(dir, ["hooks", "install", "--target", "codex", "--local"]).status, 0);
      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["codex"],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });

      const res = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(res.status, 0);
      const codex = JSON.parse(res.stdout).data.report.targets[0];
      assert.equal(codex.hook.installed, true);
      assert.equal(codex.hook.capabilities.confidence, "degraded");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hooks verify upgrades Codex confidence to live-verified for the current hook config", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      const draftPath = join(tmpdir(), `sl-codex-verify-${Date.now()}.json`);
      assert.equal(
        runCli(dir, [
          "contract",
          "new",
          "--task",
          "codex verify",
          "--planned",
          "src/**",
          "--out",
          draftPath,
        ]).status,
        0,
      );
      assert.equal(runCli(dir, ["approve", draftPath]).status, 0);
      assert.equal(runCli(dir, ["hooks", "install", "--target", "codex", "--mode", "strict", "--local"]).status, 0);

      const fakeCodex = join(dir, process.platform === "win32" ? "fake-codex.cmd" : "fake-codex.mjs");
      await writeFile(
        fakeCodex,
        process.platform === "win32"
          ? "@echo off\r\necho Patch denied: ScopeLock forbidden path changed\r\n"
          : "#!/usr/bin/env node\nprocess.stdout.write('Patch denied: ScopeLock forbidden path changed\\n');\n",
      );
      if (process.platform !== "win32") {
        await chmod(fakeCodex, 0o755);
      }

      const verify = runCli(dir, [
        "--json",
        "hooks",
        "verify",
        "--target",
        "codex",
        "--codex-bin",
        fakeCodex,
      ]);
      assert.equal(verify.status, 0, verify.stdout || verify.stderr);
      assert.equal(JSON.parse(verify.stdout).data.confidence, "live-verified");

      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["codex"],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });
      const preflight = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(preflight.status, 0);
      const codex = JSON.parse(preflight.stdout).data.report.targets[0];
      assert.equal(codex.hook.capabilities.confidence, "live-verified");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 and reports a violation when a required skill is missing for one target", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "AGENTS.md"), "RULE\n");
      await seedSkill(dir, ".agents/skills/review");
      // codex only ever resolves the shared .agents/skills path, so remove that.
      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["codex"],
        skills: [{ name: "review", path: ".agents/skills/review", required: true }],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });
      await rm(join(dir, ".agents/skills/review"), { recursive: true, force: true });

      const res = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(res.status, 1);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "violations");
      assert.equal(body.data.report.summary.status, "fail");
      const violation = body.data.report.targets[0].violations[0];
      assert.equal(violation.code, "missing_required_skill");
      assert.equal(violation.target, "codex");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a missing optional artifact as a warning, not a violation", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["codex"],
        skills: [{ name: "review", path: ".agents/skills/review", required: false }],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });

      const res = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.data.report.summary.status, "warn");
      assert.equal(body.data.report.summary.violationsCount, 0);
      assert.equal(body.data.report.targets[0].skillResults[0].status, "warn");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--target filters the report to the requested targets", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "AGENTS.md"), "RULE\n");
      await writeFile(join(dir, "CLAUDE.md"), "RULE\n");
      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["claude", "cursor", "codex"],
        rules: [{ id: "agents", path: "AGENTS.md", required: true }],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });

      const res = runCli(dir, [
        "--json",
        "agents",
        "preflight",
        "--manifest",
        manifestPath,
        "--target",
        "claude",
      ]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.data.report.targets.length, 1);
      assert.equal(body.data.report.targets[0].id, "claude");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with UNKNOWN_TARGET for a target not declared in the manifest", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["claude"],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });

      const res = runCli(dir, [
        "--json",
        "agents",
        "preflight",
        "--manifest",
        manifestPath,
        "--target",
        "codex",
      ]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "UNKNOWN_TARGET");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with MANIFEST_NOT_FOUND for a missing manifest file", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const res = runCli(dir, ["--json", "agents", "preflight", "--manifest", "nope.json"]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "MANIFEST_NOT_FOUND");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with INVALID_INPUT for a manifest that fails schema validation", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["not-a-real-target"],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });

      const res = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(res.status, 2);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "error");
      assert.equal(body.error.code, "INVALID_INPUT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("run", () => {
  async function writeContract(
    dir: string,
    file: string,
    id: string,
    planned: string[],
    read: string[] = [],
  ): Promise<void> {
    const res = runCli(dir, [
      "contract",
      "new",
      "--task",
      id,
      "--id",
      id,
      ...planned.flatMap((glob) => ["--planned", glob]),
      ...read.flatMap((glob) => ["--read", glob]),
      "--out",
      file,
    ]);
    assert.equal(res.status, 0, res.stderr);
  }

  it("runs command tasks by waves and writes a receipt", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeContract(dir, join(dir, "b.json"), "b", ["b.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "run-demo",
          tasks: [
            {
              id: "a",
              contract: "a.json",
              command: [
                process.execPath,
                "-e",
                "require('node:fs').writeFileSync('a.txt', 'a')",
              ],
            },
            {
              id: "b",
              contract: "b.json",
              command: [
                process.execPath,
                "-e",
                "require('node:fs').writeFileSync('b.txt', 'b')",
              ],
            },
          ],
        }),
      );

      const receiptPath = join(dir, "receipt.json");
      const res = runCli(dir, [
        "--json",
        "run",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "a");
      assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "b");

      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.equal(body.data.receiptPath, receiptPath);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.deepEqual(receipt.waves, [["a", "b"]]);
      assert.deepEqual(receipt.deferredTasks, []);
      assert.equal(receipt.taskRuns.length, 2);
      assert.ok(receipt.taskRuns.every((task: { status: string }) => task.status === "passed"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps raw command output in artifacts and bounds receipt previews", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "loud.json"), "loud", ["out.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "bounded-receipt-demo",
          tasks: [
            {
              id: "loud",
              contract: "loud.json",
              command: [
                process.execPath,
                "-e",
                "require('node:fs').writeFileSync('out.txt','ok');process.stdout.write('x'.repeat(3000))",
              ],
            },
          ],
        }),
      );

      const receiptPath = join(dir, "receipt.json");
      const res = runCli(dir, [
        "--json",
        "run",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      const task = receipt.taskRuns[0];
      assert.equal(receipt.schemaVersion, 3);
      assert.equal(task.stdout.length, 400);
      assert.equal(task.outputArtifacts.stdout.bytes, 3000);
      assert.equal(task.outputArtifacts.stdout.truncated, true);
      assert.equal(await readFile(task.outputArtifacts.stdout.path, "utf8"), "x".repeat(3000));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks dispatch in strict mode when agent preflight has violations", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      await writeFile(join(dir, ".scopelock", "config.json"), JSON.stringify({ schemaVersion: 1, mode: "strict" }));
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(
        join(dir, ".scopelock", "agents.json"),
        JSON.stringify({
          schemaVersion: 1,
          targets: ["codex"],
          skills: [{ name: "review", path: ".agents/skills/review", required: true }],
          policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
        }),
      );
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "env-block-demo",
          tasks: [
            {
              id: "a",
              contract: "a.json",
              command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','ran')"],
            },
          ],
        }),
      );

      const receiptPath = join(dir, "receipt.json");
      const res = runCli(dir, [
        "--json",
        "run",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--no-check-drift",
      ]);
      assert.equal(res.status, 1, res.stdout || res.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.blockedByEnvironment, true);
      assert.equal(receipt.environment.status, "fail");
      assert.equal(receipt.taskRuns[0].status, "skipped");
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records environment violations but still dispatches in warn mode", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(
        join(dir, ".scopelock", "agents.json"),
        JSON.stringify({
          schemaVersion: 1,
          targets: ["codex"],
          skills: [{ name: "review", path: ".agents/skills/review", required: true }],
          policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
        }),
      );
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "env-warn-demo",
          tasks: [
            {
              id: "a",
              contract: "a.json",
              command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','ran')"],
            },
          ],
        }),
      );

      const receiptPath = join(dir, "receipt.json");
      const res = runCli(dir, [
        "--json",
        "run",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--no-check-drift",
      ]);
      assert.equal(res.status, 1, res.stdout || res.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.blockedByEnvironment, false);
      assert.equal(receipt.environment.status, "fail");
      assert.equal(receipt.taskRuns[0].status, "passed");
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "ran");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("closes child stdin so non-interactive commands receive EOF", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "stdin.json"), "stdin", ["stdin-eof.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "stdin-eof-demo",
          tasks: [
            {
              id: "stdin",
              contract: "stdin.json",
              command: [
                process.execPath,
                "-e",
                "process.stdin.resume();process.stdin.on('end',()=>require('node:fs').writeFileSync('stdin-eof.txt','ok'))",
              ],
            },
          ],
        }),
      );

      const result = spawnSync(
        process.execPath,
        [CLI, "--json", "run", "--plan", "plan.json", "--no-check-drift"],
        { cwd: dir, encoding: "utf8", input: "", timeout: 2_000 },
      );

      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.equal(await readFile(join(dir, "stdin-eof.txt"), "utf8"), "ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("defers one side of a write-write conflict before dispatch", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["shared.txt"]);
      await writeContract(dir, join(dir, "b.json"), "b", ["shared.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "run-conflict-demo",
          tasks: [
            {
              id: "a",
              contract: "a.json",
              command: [
                process.execPath,
                "-e",
                "require('node:fs').writeFileSync('shared.txt', 'a')",
              ],
            },
            {
              id: "b",
              contract: "b.json",
              command: [
                process.execPath,
                "-e",
                "require('node:fs').writeFileSync('shared.txt', 'b')",
              ],
            },
          ],
        }),
      );

      const receiptPath = join(dir, "receipt.json");
      const res = runCli(dir, [
        "--json",
        "run",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--no-check-drift",
      ]);
      assert.equal(res.status, 1);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "violations");
      assert.deepEqual(body.data.receipt.deferredTasks, ["b"]);
      assert.equal(await readFile(join(dir, "shared.txt"), "utf8"), "a");
      assert.equal(
        body.data.receipt.taskRuns.find((task: { id: string }) => task.id === "b").status,
        "skipped",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
