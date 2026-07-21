import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { copyFile, mkdtemp, rm, mkdir, readFile, realpath, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { approvedContractSchema, scopelockPaths, writeApprovalSeal } from "@scopelock/core";
import { findAgentExecutable, setupCommand } from "./commands/setup.js";
import { packageManagerRunCommand } from "./commands/plan-prepare.js";
import { runPlanCommand } from "./commands/run-plan.js";
import { compileScopeInputs, taskStartCommand } from "./commands/task-start.js";
import { taskFinishCommand } from "./commands/task-finish.js";
import { checkDriftCommand } from "./commands/check-drift.js";
import { CliError } from "./run.js";
import { planPrepareCommand } from "./commands/plan-prepare.js";
import type { ProgressEvent, ProgressReporter } from "./progress/types.js";

const CLI = fileURLToPath(new URL("./index.js", import.meta.url));

type RunResult = { status: number; stdout: string; stderr: string };

function runCli(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): RunResult {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    input: "",
    env,
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

function commitFixture(dir: string, message: string): void {
  assert.equal(spawnSync("git", ["add", "-A"], { cwd: dir }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-qm", message], { cwd: dir }).status, 0);
}

function isolatedExecution(validationSource = "process.exit(0)") {
  return {
    isolation: "required" as const,
    validation: { command: [process.execPath, "-e", validationSource] },
  };
}

function isolatedChecksExecution(
  checks: Array<{ id: string; command: string[]; cwd?: string; required?: boolean }>,
  setup?: string[],
) {
  return {
    isolation: "required" as const,
    validation: { ...(setup ? { setup } : {}), checks },
  };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function recordingReporter(): {
  events: ProgressEvent[];
  disposeCount: () => number;
  reporter: ProgressReporter;
} {
  const events: ProgressEvent[] = [];
  let disposed = 0;
  return {
    events,
    disposeCount: () => disposed,
    reporter: {
      emit(event) { events.push(event); },
      dispose() { disposed += 1; },
    },
  };
}

describe("public command language", () => {
  it("shows canonical command groups and hides compatibility aliases", () => {
    const help = runCli(process.cwd(), ["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Local flight control for AI coding agents/);
    assert.match(help.stdout, /Start here:\n[\s\S]*Protect one task:\n[\s\S]*Coordinate agents:/);
    assert.match(help.stdout, /Coordinate agents:\n[\s\S]*Inspect:\n[\s\S]*Advanced:\n[\s\S]*Help:/);
    assert.match(
      help.stdout,
      /Protect one task:\n\s+contract\s+create, approve, and share task boundaries\n\s+task\s+start and verify one bounded agent task\n\s+check-drift/,
    );
    assert.match(
      help.stdout,
      /Quick start:\n  scopelock setup\n  scopelock task start --help\n  scopelock task finish --help/,
    );
    assert.ok(
      help.stdout.trimEnd().split("\n").every((line) => line.length <= 80),
      "root help must fit an 80-column terminal",
    );
    assert.doesNotMatch(help.stdout, /\n\s+approve \[options\]/);
    assert.doesNotMatch(help.stdout, /\n\s+plan-parallel/);
    assert.doesNotMatch(help.stdout, /\n\s+hook\s/);
  });

  it("keeps JSON output free of human sections and ANSI", () => {
    const result = runCli(process.cwd(), ["doctor", "--json"]);
    assert.ok(result.status === 0 || result.status === 1);
    assert.doesNotMatch(result.stdout, /\u001b\[/);
    assert.doesNotMatch(result.stdout, /\nContext\n|\nChecks\n|\nNext\n/);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
  });

  it("keeps legacy commands parseable while exposing canonical equivalents", () => {
    for (const args of [
      ["contract", "approve", "--help"],
      ["approve", "--help"],
      ["plan", "schedule", "--help"],
      ["plan-parallel", "--help"],
      ["plan", "compose", "--help"],
      ["plan", "fill-commands", "--help"],
    ]) {
      const result = runCli(process.cwd(), args);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    }
  });

  it("requires exactly one effective plan path", () => {
    const missing = runCli(process.cwd(), ["--json", "run"]);
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stdout).error.code, "PLAN_REQUIRED");

    const conflicting = runCli(process.cwd(), [
      "--json",
      "run",
      "one.json",
      "--plan",
      "two.json",
    ]);
    assert.equal(conflicting.status, 2);
    assert.equal(JSON.parse(conflicting.stdout).error.code, "CONFLICTING_PLAN_PATHS");
  });

  it("exposes the guided task start without hiding the advanced contract commands", () => {
    const help = runCli(process.cwd(), ["task", "start", "--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--allow <path>/);
    assert.match(help.stdout, /--block <path>/);
    assert.match(help.stdout, /--context <path>/);
    assert.match(help.stdout, /--yes/);
    assert.match(runCli(process.cwd(), ["contract", "new", "--help"]).stdout, /--planned <glob>/);
  });

  it("rejects incomplete non-interactive task input without hanging or creating a draft", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = runCli(dir, ["--json", "task", "start", "small change"]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, "TASK_INPUT_REQUIRED");
      await assert.rejects(readFile(scopelockPaths(dir).draftsDir, "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("saves a complete non-interactive draft but requires explicit approval", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = runCli(dir, [
        "--json", "task", "start", "review first",
        "--id", "review-first",
        "--agent", "codex",
        "--allow", "src",
        "--test", "unit",
      ]);
      assert.equal(result.status, 2);
      const error = JSON.parse(result.stdout).error;
      assert.equal(error.code, "TASK_APPROVAL_REQUIRED");
      assert.match(error.message, /scopelock contract approve/);
      assert.equal(await readFile(join(scopelockPaths(dir).draftsDir, "review-first.json"), "utf8").then(Boolean), true);
      await assert.rejects(readFile(scopelockPaths(dir).activePath, "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("task finish is non-interactive and reports a missing active task", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = runCli(dir, ["--json", "task", "finish"]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, "NO_ACTIVE_CONTRACT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("guided task start", () => {
  const readySetup = async () => ({
    data: {
      targets: [{
        id: "codex" as const,
        executable: "/usr/bin/codex",
        hook: { installed: false, capabilities: { confidence: "degraded" } },
      }],
    },
    human: "",
    exitCode: 0 as const,
  });

  it("compiles friendly file and directory inputs into canonical patterns", () => {
    assert.deepEqual(
      compileScopeInputs(["src", "README.md", "tests/**", ".env", "src"], ["README.md", "src/app.ts"]),
      ["src/**", "README.md", "tests/**", ".env"],
    );
    assert.throws(() => compileScopeInputs(["../outside"], []));
    assert.throws(() => compileScopeInputs(["!src/**"], []));
  });

  it("keeps a reviewable draft and no approval when the user declines", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = await taskStartCommand({
        description: "declined task",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "declined-task",
        interactive: true,
        cwd: dir,
      }, { confirm: async () => false, setup: readySetup });
      assert.equal(result.exitCode, 0);
      assert.equal((result.data as { approved: boolean }).approved, false);
      assert.equal(await readFile(join(scopelockPaths(dir).draftsDir, "declined-task.json"), "utf8").then(Boolean), true);
      await assert.rejects(readFile(scopelockPaths(dir).activePath, "utf8"));
      await assert.rejects(readFile(join(scopelockPaths(dir).contractsDir, "declined-task.json"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the draft when approval is cancelled", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await assert.rejects(
        taskStartCommand({
          description: "cancelled task",
          agent: "codex",
          allow: ["src"],
          block: [],
          context: [],
          test: ["unit"],
          id: "cancelled-task",
          interactive: true,
          cwd: dir,
        }, { confirm: async () => { throw new Error("cancelled"); }, setup: readySetup }),
        /cancelled/,
      );
      assert.equal(await readFile(join(scopelockPaths(dir).draftsDir, "cancelled-task.json"), "utf8").then(Boolean), true);
      await assert.rejects(readFile(scopelockPaths(dir).activePath, "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns when the allowed scope covers at least half of tracked files", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "one.ts"), "one\n");
      await writeFile(join(dir, "two.txt"), "two\n");
      commitFixture(dir, "fixture files");
      const result = await taskStartCommand({
        description: "broad task",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "broad-task",
        interactive: true,
        cwd: dir,
      }, { confirm: async () => false, setup: readySetup });
      assert.match(result.human ?? "", /Broad scope/);
      assert.match(result.human ?? "", /1\/2 tracked files \(50%\)/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits three review steps and disposes the reporter on approval", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const recording = recordingReporter();
      const result = await taskStartCommand({
        description: "step events task",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "step-events-task",
        yes: true,
        interactive: false,
        cwd: dir,
        reporter: recording.reporter,
      }, { setup: readySetup });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(recording.events, [
        { type: "step", index: 1, total: 3, label: "Describe and scope the task" },
        { type: "step", index: 2, total: 3, label: "Review and approve" },
        { type: "step", index: 3, total: 3, label: "Connect the agent" },
      ]);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops after step 2 and still disposes when approval is declined", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const recording = recordingReporter();
      const result = await taskStartCommand({
        description: "declined step events task",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "declined-step-events-task",
        interactive: true,
        cwd: dir,
        reporter: recording.reporter,
      }, { confirm: async () => false, setup: readySetup });
      assert.equal(result.exitCode, 0);
      assert.equal((result.data as { approved: boolean }).approved, false);
      assert.deepEqual(recording.events, [
        { type: "step", index: 1, total: 3, label: "Describe and scope the task" },
        { type: "step", index: 2, total: 3, label: "Review and approve" },
      ]);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("approves a baseline but does not inject or start an agent by default", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = await taskStartCommand({
        description: "bounded task",
        agent: "codex",
        allow: ["src"],
        block: ["secrets"],
        context: ["README.md"],
        test: ["unit"],
        id: "bounded-task",
        yes: true,
        interactive: false,
        cwd: dir,
      }, { setup: readySetup });
      assert.equal(result.exitCode, 0);
      assert.match(result.human ?? "", /Agent started  no/);
      assert.match(result.human ?? "", /Tests executed no/);
      assert.match(result.human ?? "", /scopelock task finish/);
      const approved = approvedContractSchema.parse(JSON.parse(
        await readFile(join(scopelockPaths(dir).contractsDir, "bounded-task.json"), "utf8"),
      ));
      assert.notEqual(approved.baseline, null);
      assert.equal(JSON.parse(await readFile(scopelockPaths(dir).activePath, "utf8")), "bounded-task");
      await assert.rejects(readFile(join(dir, "AGENTS.md"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("injects only after explicit consent and preserves foreign instructions", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "AGENTS.md"), "Keep this line.\n", "utf8");
      const result = await taskStartCommand({
        description: "injected task",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "injected-task",
        yes: true,
        inject: true,
        interactive: false,
        cwd: dir,
      }, { setup: readySetup });
      assert.equal(result.exitCode, 0);
      const instructions = await readFile(join(dir, "AGENTS.md"), "utf8");
      assert.match(instructions, /^Keep this line\./);
      assert.match(instructions, /SCOPELOCK CONTRACT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing harness as attention and skips requested injection", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = await taskStartCommand({
        description: "blocked environment",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "blocked-environment",
        yes: true,
        inject: true,
        interactive: false,
        cwd: dir,
      }, {
        setup: async () => ({
          data: {
            targets: [{
              id: "codex" as const,
              executable: null,
              hook: { installed: false, capabilities: { confidence: "degraded" } },
            }],
          },
          human: "",
          exitCode: 0,
        }),
      });
      assert.equal(result.exitCode, 1);
      assert.match(result.human ?? "", /Attention:/);
      await assert.rejects(readFile(join(dir, "AGENTS.md"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finishes a clean guided task and writes a drift Flight Report", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "app.ts"), "export const value = 1;\n");
      await writeFile(join(dir, "src", "app.test.ts"), "test one\n");
      commitFixture(dir, "task fixture");
      assert.equal((await taskStartCommand({
        description: "clean finish",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "clean-finish",
        yes: true,
        interactive: false,
        cwd: dir,
      }, { setup: readySetup })).exitCode, 0);

      await writeFile(join(dir, "src", "app.ts"), "export const value = 2;\n");
      await writeFile(join(dir, "src", "app.test.ts"), "test two\n");
      const finished = await taskFinishCommand({ cwd: dir });
      assert.equal(finished.exitCode, 0);
      assert.match(finished.human ?? "", /Cleared/);
      assert.match(finished.human ?? "", /Tests executed  no/);
      const data = finished.data as { htmlPath: string; summary: { allowed: number } };
      assert.equal(data.summary.allowed, 2);
      assert.match(await readFile(data.htmlPath, "utf8"), /ScopeLock Drift Report/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finishes with attention for blocked and outside-scope changes", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "app.test.ts"), "test one\n");
      commitFixture(dir, "task fixture");
      assert.equal((await taskStartCommand({
        description: "attention finish",
        agent: "codex",
        allow: ["src"],
        block: ["secrets"],
        context: [],
        test: ["unit"],
        id: "attention-finish",
        yes: true,
        interactive: false,
        cwd: dir,
      }, { setup: readySetup })).exitCode, 0);

      await writeFile(join(dir, "src", "app.test.ts"), "test two\n");
      await mkdir(join(dir, "secrets"), { recursive: true });
      await writeFile(join(dir, "secrets", "key.txt"), "secret\n");
      await writeFile(join(dir, "outside.txt"), "outside\n");
      const finished = await taskFinishCommand({ cwd: dir });
      assert.equal(finished.exitCode, 1);
      assert.match(finished.human ?? "", /Attention required/);
      const summary = (finished.data as {
        summary: { blocked: number; outside: number };
      }).summary;
      assert.equal(summary.blocked, 1);
      assert.equal(summary.outside, 1);
      assert.match(finished.human ?? "", /Blocked changes/);
      assert.match(finished.human ?? "", /changes touched forbidden paths/);
      assert.match(finished.human ?? "", /Outside scope/);
      assert.match(finished.human ?? "", /changes fell outside the approved scope/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits checking-drift then rendering-report phases and disposes the reporter", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src", "app.ts"), "export const value = 1;\n");
      commitFixture(dir, "task fixture");
      assert.equal((await taskStartCommand({
        description: "phase events",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "phase-events-finish",
        yes: true,
        interactive: false,
        cwd: dir,
      }, { setup: readySetup })).exitCode, 0);

      const recording = recordingReporter();
      const finished = await taskFinishCommand({ cwd: dir, reporter: recording.reporter });
      assert.equal(finished.exitCode, 0);
      assert.deepEqual(recording.events, [
        { type: "phase", name: "checking-drift" },
        { type: "phase", name: "rendering-report" },
      ]);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("disposes the reporter even when there is no active contract", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const recording = recordingReporter();
      await assert.rejects(
        taskFinishCommand({ cwd: dir, reporter: recording.reporter }),
        /no active task/,
      );
      assert.equal(recording.disposeCount(), 1);
      assert.deepEqual(recording.events, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails task finish with the existing baseline recovery guidance", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal((await taskStartCommand({
        description: "lost baseline",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "lost-baseline",
        yes: true,
        interactive: false,
        cwd: dir,
      }, { setup: readySetup })).exitCode, 0);
      const contractPath = join(scopelockPaths(dir).contractsDir, "lost-baseline.json");
      const contract = approvedContractSchema.parse(JSON.parse(await readFile(contractPath, "utf8")));
      const stale = approvedContractSchema.parse({
        ...contract,
        baseline: { ...contract.baseline, headSha: "f".repeat(40) },
      });
      await writeFile(contractPath, `${JSON.stringify(stale, null, 2)}\n`);
      await writeApprovalSeal(dir, stale);
      await assert.rejects(taskFinishCommand({ cwd: dir }), /run `scopelock contract rebaseline`/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("cli end-to-end", () => {
  it("finds the bundled macOS Codex executable outside PATH", async () => {
    const root = await mkdtemp(join(tmpdir(), "scopelock-apps-"));
    try {
      const executable = join(root, "ChatGPT.app", "Contents", "Resources", "codex");
      await mkdir(dirname(executable), { recursive: true });
      await writeFile(executable, "#!/bin/sh\nexit 0\n");
      await chmod(executable, 0o755);

      assert.equal(
        findAgentExecutable("codex", { PATH: "" }, { platform: "darwin", applicationDirs: [root] }),
        executable,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("adds the local drafts ignore without replacing foreign gitignore entries", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      const path = scopelockPaths(dir).gitignorePath;
      await writeFile(path, "custom-local-file\nreports/\nactive\n", "utf8");
      assert.equal(runCli(dir, ["init"]).status, 0);
      const migrated = await readFile(path, "utf8");
      assert.equal(migrated, "custom-local-file\nreports/\nactive\ndrafts/\n");
      assert.equal(runCli(dir, ["init"]).status, 0);
      assert.equal(await readFile(path, "utf8"), migrated);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("setup is idempotent and reports honest hook confidence", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const first = runCli(dir, ["setup", "--json"]);
      assert.equal(first.status, 0, first.stderr);
      const firstData = JSON.parse(first.stdout).data;
      assert.equal(firstData.targets.length, 3);
      assert.equal(firstData.targets.find((target: { id: string }) => target.id === "cursor").hook.capabilities.canDeny, false);
      assert.equal(firstData.targets.find((target: { id: string }) => target.id === "codex").hook.capabilities.confidence, "degraded");

      const configBefore = await readFile(join(dir, ".scopelock", "config.json"), "utf8");
      const ignoreBefore = await readFile(join(dir, ".scopelock", ".gitignore"), "utf8");
      const second = runCli(dir, ["setup", "--json"]);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(await readFile(join(dir, ".scopelock", "config.json"), "utf8"), configBefore);
      assert.equal(await readFile(join(dir, ".scopelock", ".gitignore"), "utf8"), ignoreBefore);

      const human = runCli(dir, ["setup"]);
      assert.equal(human.status, 0, human.stderr);
      assert.match(human.stdout, /^Context\n[\s\S]*\nChecks\n[\s\S]*Claude Code[\s\S]*Codex CLI[\s\S]*Cursor/);
      assert.match(human.stdout, /\nResult\n[\s\S]*\nNext\n/);
      assert.equal(human.stdout.match(/^Next$/gm)?.length, 1);
      assert.equal(await readFile(join(dir, ".scopelock", "config.json"), "utf8"), configBefore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("setup records the detected Swift package profile on first initialization", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "Tests", "WalletCoreTests"), { recursive: true });
      await writeFile(join(dir, "Package.swift"), "// swift-tools-version: 6.0\n");
      await writeFile(join(dir, "Tests", "WalletCoreTests", "WalletCoreTests.swift"), "import Testing\n");
      commitFixture(dir, "swift package");

      const setup = runCli(dir, ["setup", "--json"]);
      assert.equal(setup.status, 0, setup.stderr);
      const config = JSON.parse(await readFile(join(dir, ".scopelock", "config.json"), "utf8"));
      assert.deepEqual(config.projectTypes, ["swift"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails before mutation when non-interactive hook installation is unconfirmed", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = runCli(dir, ["setup", "--target", "claude", "--install-hooks", "--json"]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, "SETUP_CONFIRMATION_REQUIRED");
      await assert.rejects(readFile(join(dir, ".scopelock", "config.json"), "utf8"), { code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown setup mode before initialization", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const result = runCli(dir, ["setup", "--mode", "unsafe", "--json"]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, "INVALID_INPUT");
      await assert.rejects(readFile(join(dir, ".scopelock", "config.json"), "utf8"), { code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("collects all confirmations before writing any hook file", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    let prompts = 0;
    try {
      await assert.rejects(
        setupCommand(
          { targets: [], mode: "warn", interactive: true, cwd: dir },
          {
            executable: () => "/fake/agent",
            confirm: async () => {
              prompts += 1;
              if (prompts === 2) throw new Error("cancelled");
              return true;
            },
          },
        ),
        /cancelled/,
      );
      assert.equal(prompts, 2);
      for (const path of [
        join(dir, ".claude", "settings.json"),
        join(dir, ".codex", "hooks.json"),
        join(dir, ".cursor", "hooks.json"),
      ]) {
        await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves foreign hooks and skips byte churn after installation", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const settingsPath = join(dir, ".claude", "settings.json");
      await mkdir(join(dir, ".claude"), { recursive: true });
      await writeFile(settingsPath, JSON.stringify({
        permissions: { allow: ["Read"] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "foreign-hook" }] }] },
      }, null, 2));

      const installed = runCli(dir, [
        "setup",
        "--target", "claude",
        "--install-hooks",
        "--yes",
        "--json",
      ]);
      assert.equal(installed.status, 0, installed.stderr);
      const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
      assert.deepEqual(parsed.permissions, { allow: ["Read"] });
      assert.ok(parsed.hooks.PreToolUse.some((entry: unknown) => JSON.stringify(entry).includes("foreign-hook")));
      assert.ok(parsed.hooks.PreToolUse.some((entry: unknown) => JSON.stringify(entry).includes("hook gate")));

      const bytes = await readFile(settingsPath, "utf8");
      const repeated = runCli(dir, [
        "setup",
        "--target", "claude",
        "--install-hooks",
        "--yes",
        "--json",
      ]);
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.equal(await readFile(settingsPath, "utf8"), bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("init -> contract new -> approve -> check-drift respects the exit-code contract", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const initialized = runCli(dir, ["init"]);
      assert.equal(initialized.status, 0);
      assert.match(initialized.stdout, /^Context\n[\s\S]*\nResult\n[\s\S]*\nNext\n/);
      assert.equal(initialized.stdout.match(/^Next$/gm)?.length, 1);

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

      const approve = runCli(dir, ["--json", "contract", "approve", draftPath]);
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
      await writeApprovalSeal(dir, approvedContractSchema.parse(contract));

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
      await writeApprovalSeal(dir, approvedContractSchema.parse(contract));

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

      const res = runCli(dir, ["--json", "plan", "schedule", "plan.json"]);
      assert.equal(res.status, 0);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.deepEqual(body.data.waves, [["t1", "t2"]]);
      assert.deepEqual(body.data.conflicts, []);

      const human = runCli(dir, ["plan", "schedule", "plan.json"]);
      assert.equal(human.status, 0);
      assert.match(human.stdout, /stage 1: \[t1, t2\]/);
      assert.doesNotMatch(human.stdout, /wave 1:/);
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

  it("hooks verify refuses to disable Codex sandbox and leaves confidence degraded", async (t) => {
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

      const verify = runCli(dir, [
        "--json",
        "hooks",
        "verify",
        "--target",
        "codex",
      ]);
      assert.equal(verify.status, 2, verify.stdout || verify.stderr);
      assert.equal(JSON.parse(verify.stdout).error.code, "HOOK_VERIFY_UNAVAILABLE");

      const manifestPath = await writeManifest(dir, {
        schemaVersion: 1,
        targets: ["codex"],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      });
      const preflight = runCli(dir, ["--json", "agents", "preflight", "--manifest", manifestPath]);
      assert.equal(preflight.status, 0);
      const codex = JSON.parse(preflight.stdout).data.report.targets[0];
      assert.equal(codex.hook.capabilities.confidence, "degraded");
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

describe("plan fill-commands", () => {
  async function writeContract(dir: string, name: string): Promise<void> {
    const path = join(dir, `${name}.json`);
    const draft = runCli(dir, [
      "contract",
      "new",
      "--task",
      `${name} task`,
      "--id",
      name,
      "--planned",
      `${name}.txt`,
      "--out",
      path,
    ]);
    assert.equal(draft.status, 0, draft.stderr);
    const approved = runCli(dir, ["approve", path]);
    assert.equal(approved.status, 0, approved.stdout || approved.stderr);
  }

  it("fills missing Codex commands, preserves overrides, and feeds run --plan", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, "a");
      await writeContract(dir, "b");
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "compose-demo",
          execution: isolatedExecution(),
          tasks: [
            { id: "a", contract: ".scopelock/contracts/a.json" },
            { id: "b", contract: ".scopelock/contracts/b.json", command: ["manual", "b"] },
          ],
        }),
      );

      const filled = runCli(dir, [
        "--json",
        "plan",
        "compose",
        "plan.json",
        "--target",
        "codex",
        "--out",
        "enriched.json",
      ]);
      assert.equal(filled.status, 0, filled.stdout || filled.stderr);
      const enriched = JSON.parse(await readFile(join(dir, "enriched.json"), "utf8"));
      assert.deepEqual(enriched.tasks[0].command.slice(0, 2), ["codex", "exec"]);
      assert.deepEqual(enriched.tasks[0].command.slice(2, 4), ["--sandbox", "workspace-write"]);
      assert.match(enriched.tasks[0].command.at(-1), /# ScopeLock Contract: a/);
      assert.equal(enriched.tasks[0].expectsChanges, true);
      assert.deepEqual(enriched.tasks[1].command, ["manual", "b"]);
      assert.equal(enriched.tasks[1].expectsChanges, undefined);
      assert.equal(enriched.execution.isolation, "required");

      const forced = runCli(dir, [
        "--json",
        "plan",
        "fill-commands",
        "plan.json",
        "--target",
        "codex",
        "--force",
        "--out",
        "forced.json",
      ]);
      assert.equal(forced.status, 0, forced.stdout || forced.stderr);
      const forcedPlan = JSON.parse(await readFile(join(dir, "forced.json"), "utf8"));
      assert.deepEqual(forcedPlan.tasks[1].command.slice(0, 2), ["codex", "exec"]);
      assert.equal(forcedPlan.tasks[1].expectsChanges, true);
      assert.equal(forcedPlan.execution.isolation, "required");

      // Keep the composed plan shape and replace only executables with a
      // deterministic test shim so CI does not require a Codex account.
      for (const task of forcedPlan.tasks) {
        task.command = [
          process.execPath,
          "-e",
          `require('node:fs').writeFileSync('${task.id}.txt','ran')`,
        ];
      }
      await writeFile(join(dir, "runnable.json"), JSON.stringify(forcedPlan));
      commitFixture(dir, "composed runnable plan");
      const run = runCli(dir, [
        "--json",
        "run",
        "runnable.json",
        "--yes",
        "--isolate",
        "--no-check-drift",
      ]);
      assert.equal(run.status, 0, run.stdout || run.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "ran");
      assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "ran");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("composes a restricted-runner prompt, never asking the agent for check_drift or MCP", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, "a");
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "restricted-prompt",
          tasks: [{ id: "a", contract: ".scopelock/contracts/a.json" }],
        }),
      );
      const result = runCli(dir, [
        "--json",
        "plan",
        "fill-commands",
        "plan.json",
        "--target",
        "codex",
      ]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const body = JSON.parse(result.stdout);
      const prompt = body.data.plan.tasks[0].command.at(-1);
      assert.doesNotMatch(prompt, /check_drift/);
      assert.doesNotMatch(prompt, /MCP/);
      assert.doesNotMatch(prompt, /run the required tests/i);
      assert.match(prompt, /ScopeLock runner/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fills a live-verified restricted Claude invocation", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, "a");
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "claude-compose",
          tasks: [{ id: "a", contract: ".scopelock/contracts/a.json" }],
        }),
      );
      const result = runCli(dir, [
        "--json",
        "plan",
        "fill-commands",
        "plan.json",
        "--target",
        "claude",
      ]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.status, "ok");
      assert.deepEqual(body.data.plan.tasks[0].command.slice(0, 2), ["claude", "-p"]);
      assert.equal(body.data.plan.tasks[0].command.includes("dontAsk"), true);
      assert.equal(body.data.plan.tasks[0].command.includes("Bash"), true);
      assert.equal(body.data.unsupported.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("composes Cursor only as an isolation-required plan", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, "a");
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-cursor",
          tasks: [{ id: "a", contract: ".scopelock/contracts/a.json" }],
        }),
      );
      const result = runCli(dir, [
        "--json",
        "plan",
        "fill-commands",
        "plan.json",
        "--target",
        "cursor",
      ]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.status, "ok");
      assert.deepEqual(body.data.unsupported, []);
      assert.equal(body.data.plan.execution.isolation, "required");
      assert.deepEqual(body.data.plan.tasks[0].command.slice(0, 6), [
        "agent", "--print", "--output-format", "stream-json", "--sandbox", "enabled",
      ]);
      assert.equal(body.data.plan.tasks[0].command.includes("--force"), false);
      await writeFile(join(dir, "cursor-plan.json"), JSON.stringify(body.data.plan));
      const direct = runCli(dir, [
        "--json", "run", "--yes", "--plan", "cursor-plan.json", "--no-check-drift",
      ]);
      assert.equal(direct.status, 2, direct.stdout || direct.stderr);
      assert.equal(JSON.parse(direct.stdout).error.code, "PLAN_REQUIRES_ISOLATION");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns exit 2 when a task contract is missing", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "missing-contract",
          tasks: [{ id: "a", contract: "missing.json" }],
        }),
      );
      const result = runCli(dir, [
        "--json",
        "plan",
        "fill-commands",
        "plan.json",
        "--target",
        "codex",
      ]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, "CONTRACT_NOT_FOUND");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to compose an unapproved draft contract", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const draft = runCli(dir, [
        "contract",
        "new",
        "--task",
        "draft task",
        "--id",
        "draft",
        "--planned",
        "draft.txt",
        "--out",
        "draft.json",
      ]);
      assert.equal(draft.status, 0, draft.stderr);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "draft-contract",
          tasks: [{ id: "draft", contract: "draft.json" }],
        }),
      );
      const result = runCli(dir, [
        "--json",
        "plan",
        "fill-commands",
        "plan.json",
        "--target",
        "codex",
      ]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, "CONTRACT_NOT_APPROVED");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns exit 2 for a malformed plan", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "plan.json"), JSON.stringify({ schemaVersion: 1, tasks: [] }));
      const result = runCli(dir, [
        "--json",
        "plan",
        "fill-commands",
        "plan.json",
        "--target",
        "codex",
      ]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).error.code, "INVALID_INPUT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("plan prepare", () => {
  it("composes Windows npm scripts without a cmd shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-windows-npm-"));
    try {
      const nodeExecutable = join(dir, "node.exe");
      const npmCli = join(dir, "node_modules", "npm", "bin", "npm-cli.js");
      await mkdir(dirname(npmCli), { recursive: true });
      await writeFile(nodeExecutable, "");
      await writeFile(npmCli, "");

      assert.deepEqual(
        await packageManagerRunCommand("npm", "check", {
          platform: "win32",
          nodeExecutable,
        }),
        [nodeExecutable, npmCli, "run", "check"],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  let fakeCodexBinPromise: Promise<string> | null = null;

  after(async () => {
    if (fakeCodexBinPromise !== null) {
      await rm(await fakeCodexBinPromise, { recursive: true, force: true });
    }
  });

  async function writeContract(
    dir: string,
    id: string,
    planned: string[],
    read: string[] = [],
  ): Promise<string> {
    const draftPath = join(dir, `${id}.json`);
    const draft = runCli(dir, [
      "contract", "new", "--task", `${id} task`, "--id", id,
      ...planned.flatMap((path) => ["--planned", path]),
      ...read.flatMap((path) => ["--read", path]),
      "--out", draftPath,
    ]);
    assert.equal(draft.status, 0, draft.stderr);
    const approved = runCli(dir, ["contract", "approve", draftPath]);
    assert.equal(approved.status, 0, approved.stdout || approved.stderr);
    return `.scopelock/contracts/${id}.json`;
  }

  async function fakeCodexEnv(dir: string): Promise<NodeJS.ProcessEnv> {
    if (process.platform === "win32") {
      fakeCodexBinPromise ??= (async () => {
        const bin = await mkdtemp(join(tmpdir(), "scopelock-fake-codex-"));
        await copyFile(process.execPath, join(bin, "codex.exe"));
        return bin;
      })();
      const bin = await fakeCodexBinPromise;
      await writeFile(join(dir, "exec"), "require('node:fs').writeFileSync('a.txt', 'ran')\n");
      return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
    }

    const bin = join(dir, "fake-bin");
    const script = join(bin, "fake-codex.cjs");
    const executable = join(bin, "codex");
    await mkdir(bin, { recursive: true });
    await writeFile(script, "require('node:fs').writeFileSync('a.txt', 'ran')\n");
    await writeFile(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`);
    await chmod(executable, 0o755);
    return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
  }

  async function gitOnlyEnv(dir: string): Promise<NodeJS.ProcessEnv> {
    const extensions = process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
    let gitPath: string | null = null;
    for (const pathDir of (process.env.PATH ?? "").split(delimiter)) {
      for (const extension of extensions) {
        const candidate = join(pathDir, `git${extension}`);
        if (existsSync(candidate)) gitPath = candidate;
      }
      if (gitPath !== null) break;
    }
    assert.ok(gitPath, "git must be discoverable for the fixture");
    return { ...process.env, PATH: dirname(gitPath) };
  }

  it("emits scheduling, preflight, and composing phases and disposes the reporter", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "phase-events-plan",
        tasks: [{ id: "a", contract, command: "echo must-be-replaced" }],
      }));
      const env = await fakeCodexEnv(dir);
      const previousCwd = process.cwd();
      const previousPath = process.env.PATH;
      process.chdir(dir);
      process.env.PATH = env.PATH;
      try {
        const recording = recordingReporter();
        const prepared = await planPrepareCommand("plan.json", {
          target: "codex",
          out: "ready.json",
          validationCwd: ".",
          validationCommand: [process.execPath],
          reporter: recording.reporter,
        });
        assert.equal(prepared.exitCode, 0, prepared.human ?? "");
        // The degraded codex hook-confidence WARN must point at the concrete
        // command that upgrades it, and must not render as "Codex CLI CLI".
        assert.match(prepared.human ?? "", /hooks verify --target codex/);
        assert.doesNotMatch(prepared.human ?? "", /Codex CLI CLI/);
        assert.deepEqual(recording.events, [
          { type: "phase", name: "scheduling" },
          { type: "phase", name: "preflight" },
          { type: "phase", name: "composing" },
        ]);
        assert.equal(recording.disposeCount(), 1);
      } finally {
        process.chdir(previousCwd);
        process.env.PATH = previousPath;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still disposes the reporter and stops after scheduling when there is a cycle", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const a = await writeContract(dir, "a", ["a.txt"], ["b.txt"]);
      const b = await writeContract(dir, "b", ["b.txt"], ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "cycle-plan",
        tasks: [{ id: "a", contract: a }, { id: "b", contract: b }],
      }));
      const previousCwd = process.cwd();
      process.chdir(dir);
      try {
        const recording = recordingReporter();
        const prepared = await planPrepareCommand("plan.json", {
          target: "codex",
          out: "ready.json",
          reporter: recording.reporter,
        });
        assert.equal(prepared.exitCode, 1);
        assert.match(prepared.human ?? "", /Unschedulable groups/);
        assert.match(prepared.human ?? "", /circular dependencies block scheduling/);
        assert.deepEqual(recording.events, [{ type: "phase", name: "scheduling" }]);
        assert.equal(recording.disposeCount(), 1);
      } finally {
        process.chdir(previousCwd);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prepares a reviewable shell-free plan with a composed validation checks array", async (t) => {
    // NOTE: this test used to also round-trip the ready plan through
    // `scopelock run --isolate` to prove `run` accepts it unchanged.
    // `run-plan.ts` now understands `execution.validation.checks` (see the
    // "run" describe block's checks-array tests below, which cover the
    // execution side directly), so that round-trip is no longer blocked on
    // missing wiring - it is simply left out here because this fixture's
    // `command` is a fake codex sandbox-exec invocation, not something worth
    // actually spawning in this test. This test only asserts what `plan
    // prepare` itself writes.
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "prepared-demo",
        tasks: [{ id: "a", contract, command: "echo must-be-replaced" }],
      }));
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready-plan.json",
        "--validation-cwd", ".",
        "--validation-command", process.execPath,
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const body = JSON.parse(prepared.stdout);
      assert.deepEqual(body.data.stages, [["a"]]);
      assert.equal(body.data.preflight.executable.found, true);
      assert.equal(body.data.preflight.workspace, null);
      const ready = JSON.parse(await readFile(join(dir, "ready-plan.json"), "utf8"));
      assert.deepEqual(ready.tasks[0].command.slice(0, 2), [body.data.preflight.executable.path, "exec"]);
      assert.deepEqual(ready.tasks[0].command.slice(2, 4), ["--sandbox", "workspace-write"]);
      assert.equal(ready.tasks[0].expectsChanges, true);
      assert.equal(ready.execution.isolation, "required");
      assert.equal(ready.execution.validation.cwd, ".");
      assert.equal(ready.execution.validation.command, undefined);
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "repository-validation");
      assert.deepEqual(ready.execution.validation.checks[0].command, [process.execPath]);
      assert.equal(ready.execution.validation.checks[0].required, true);
      assert.equal(Array.isArray(ready.tasks[0].command), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves option-like child tokens in --validation-command/--validation-setup-command byte-for-byte", async (t) => {
    // Regression test for the Pilot 4 readiness spike finding: Commander's
    // variadic <argv...> option stops collecting values at the first token
    // that looks like a flag (e.g. `--frozen`), then tries to parse it as an
    // unknown top-level ScopeLock option and fails before the command runs.
    // Reproduced live against a real pinned Python fixture with
    // `uv sync --frozen --group tests` / `uv run --frozen pytest`; this test
    // exercises the same shape with a deterministic executable so CI does
    // not depend on `uv` being installed.
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "option-like-validation-argv",
        tasks: [{ id: "a", contract, command: "echo must-be-replaced" }],
      }));
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready-plan.json",
        "--validation-setup-command", process.execPath, "--version",
        "--validation-command", process.execPath, "--version",
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready-plan.json"), "utf8"));
      assert.deepEqual(ready.execution.validation.setup, [process.execPath, "--version"]);
      assert.equal(ready.execution.validation.command, undefined);
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "repository-validation");
      assert.deepEqual(ready.execution.validation.checks[0].command, [process.execPath, "--version"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs isolated validation from a reviewed repository subdirectory", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "app"), { recursive: true });
      await writeFile(join(dir, ".gitignore"), "app/setup-ok\n");
      await writeFile(join(dir, "app", "validate.cjs"), [
        "const { basename } = require('node:path');",
        "const { readFileSync } = require('node:fs');",
        "process.exit(basename(process.cwd()) === 'app' && readFileSync('setup-ok', 'utf8') === 'yes' && readFileSync('../a.txt', 'utf8') === 'candidate' ? 0 : 9);",
      ].join("\n"));
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-cwd",
        execution: {
          isolation: "required",
          validation: {
            cwd: "app",
            setup: [process.execPath, "-e", "require('node:fs').writeFileSync('setup-ok','yes')"],
            command: [process.execPath, "validate.cjs"],
          },
        },
        tasks: [{
          id: "a",
          contract,
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation cwd fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-cwd.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "candidate");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationSetup.status, "passed");
      assert.equal(receipt.isolation.validationSetup.cwd, "app");
      assert.equal(receipt.isolation.validationChecks.length, 1);
      assert.equal(receipt.isolation.validationChecks[0].id, "repository-validation");
      assert.equal(receipt.isolation.validationChecks[0].status, "passed");
      assert.equal(receipt.isolation.validationChecks[0].cwd, "app");
      assert.equal(receipt.isolation.validationChecks[0].required, true);
      assert.equal(receipt.isolation.finalPromotion, "applied");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unavailable validation working directory before the agent starts", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["agent-ran.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "missing-validation-cwd",
        execution: {
          isolation: "required",
          validation: { cwd: "missing", command: [process.execPath, "-e", "process.exit(0)"] },
        },
        tasks: [{
          id: "a",
          contract,
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('agent-ran.txt','yes')"],
        }],
      }));
      commitFixture(dir, "missing validation cwd fixture");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);

      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.match(result.stdout || result.stderr, /INVALID_VALIDATION_CWD/);
      assert.equal(existsSync(join(dir, "agent-ran.txt")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a validation working directory symlink that escapes the repository", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const outside = await mkdtemp(join(tmpdir(), "scopelock-validation-outside-"));
    try {
      await writeFile(join(dir, ".gitignore"), "escape\n");
      const contract = await writeContract(dir, "a", ["agent-ran.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "escaped-validation-cwd",
        execution: {
          isolation: "required",
          validation: { cwd: "escape", command: [process.execPath, "-e", "process.exit(0)"] },
        },
        tasks: [{
          id: "a",
          contract,
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('agent-ran.txt','yes')"],
        }],
      }));
      commitFixture(dir, "escaped validation cwd fixture");
      await symlink(outside, join(dir, "escape"), process.platform === "win32" ? "junction" : "dir");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);

      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.match(result.stdout || result.stderr, /INVALID_VALIDATION_CWD/);
      assert.equal(existsSync(join(dir, "agent-ran.txt")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("detects an npm check script and refuses to guess when validation is unknown", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-detection",
        tasks: [{ id: "a", contract }],
      }));
      const env = await fakeCodexEnv(dir);

      const unknown = runCli(dir, [
        "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "unknown.json",
      ], env);
      assert.equal(unknown.status, 1, unknown.stdout || unknown.stderr);
      assert.match(unknown.stdout, /not detected/);
      assert.match(unknown.stdout, /pass --validation-check to supply one/);
      assert.match(unknown.stdout, /--validation-check <id> <executable>/);
      await assert.rejects(readFile(join(dir, "unknown.json"), "utf8"));

      await writeFile(join(dir, "package.json"), JSON.stringify({
        scripts: { prepare: "node generate.cjs", check: "node --test" },
      }));
      const detected = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready.json",
      ], env);
      assert.equal(detected.status, 0, detected.stdout || detected.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready.json"), "utf8"));
      assert.deepEqual(ready.execution.validation.setup, await packageManagerRunCommand("npm", "prepare"));
      assert.equal(ready.execution.validation.command, undefined);
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "npm-check");
      assert.deepEqual(ready.execution.validation.checks[0].command, await packageManagerRunCommand("npm", "check"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects an npm test script with a stable npm-test id when no check script exists", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-detection-npm-test",
        tasks: [{ id: "a", contract }],
      }));
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready.json",
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready.json"), "utf8"));
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "npm-test");
      assert.deepEqual(ready.execution.validation.checks[0].command, await packageManagerRunCommand("npm", "test"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects Package.swift with a stable swift-test id", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-detection-swift-test",
        tasks: [{ id: "a", contract }],
      }));
      await writeFile(join(dir, "Package.swift"), "");
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready.json",
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready.json"), "utf8"));
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "swift-test");
      assert.deepEqual(ready.execution.validation.checks[0].command, ["swift", "test"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects Cargo.toml with a stable cargo-test id", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-detection-cargo-test",
        tasks: [{ id: "a", contract }],
      }));
      await writeFile(join(dir, "Cargo.toml"), "");
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready.json",
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready.json"), "utf8"));
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "cargo-test");
      assert.deepEqual(ready.execution.validation.checks[0].command, ["cargo", "test"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects go.mod with a stable go-test id", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-detection-go-test",
        tasks: [{ id: "a", contract }],
      }));
      await writeFile(join(dir, "go.mod"), "");
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready.json",
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready.json"), "utf8"));
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "go-test");
      assert.deepEqual(ready.execution.validation.checks[0].command, ["go", "test", "./..."]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses explicit repeated --validation-check flags over plan checks and detection", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "explicit-checks",
        execution: {
          validation: {
            checks: [{ id: "plan-check", command: [process.execPath, "-e", "process.exit(0)"], required: true }],
          },
        },
        tasks: [{ id: "a", contract, command: "echo must-be-replaced" }],
      }));
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { check: "node --test" } }));
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready-plan.json",
        "--validation-check", "lint", process.execPath, "--version",
        "--validation-check", "unit", process.execPath, "-e", "process.exit(0)",
        "--acceptance-check", "lint",
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready-plan.json"), "utf8"));
      assert.equal(ready.execution.validation.command, undefined);
      assert.equal(ready.execution.validation.checks.length, 2);
      assert.equal(ready.execution.validation.checks[0].id, "lint");
      assert.deepEqual(ready.execution.validation.checks[0].command, [process.execPath, "--version"]);
      assert.equal(ready.execution.validation.checks[0].required, true);
      assert.equal(ready.execution.validation.checks[1].id, "unit");
      assert.deepEqual(ready.execution.validation.acceptance.checkIds, ["lint"]);
      const humanChecks = JSON.parse(prepared.stdout).data.checks as string[];
      assert.ok(humanChecks.some((line) => line.includes("Validation check lint") && line.includes("required=true")));
      assert.ok(humanChecks.some((line) => line.includes("Validation check unit")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves existing plan validation checks over auto-detection when no CLI validation flags are given", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "existing-plan-checks",
        execution: {
          validation: {
            checks: [{ id: "existing-check", command: [process.execPath, "--version"], required: true }],
          },
        },
        tasks: [{ id: "a", contract, command: "echo must-be-replaced" }],
      }));
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { check: "node --test" } }));
      const env = await fakeCodexEnv(dir);
      const prepared = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready-plan.json",
      ], env);
      assert.equal(prepared.status, 0, prepared.stdout || prepared.stderr);
      const ready = JSON.parse(await readFile(join(dir, "ready-plan.json"), "utf8"));
      assert.equal(ready.execution.validation.command, undefined);
      assert.equal(ready.execution.validation.checks.length, 1);
      assert.equal(ready.execution.validation.checks[0].id, "existing-check");
      assert.deepEqual(ready.execution.validation.checks[0].command, [process.execPath, "--version"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate validation check ids and unknown acceptance check ids before writing", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "invalid-validation-profile",
        tasks: [{ id: "a", contract, command: "echo must-be-replaced" }],
      }));
      const env = await fakeCodexEnv(dir);

      const duplicate = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready-duplicate.json",
        "--validation-check", "lint", process.execPath, "--version",
        "--validation-check", "lint", process.execPath, "-e", "process.exit(0)",
      ], env);
      assert.equal(duplicate.status, 2, duplicate.stdout || duplicate.stderr);
      assert.match(duplicate.stdout || duplicate.stderr, /INVALID_VALIDATION_PROFILE/);
      await assert.rejects(readFile(join(dir, "ready-duplicate.json"), "utf8"));

      const unknownAcceptance = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready-unknown.json",
        "--validation-check", "lint", process.execPath, "--version",
        "--acceptance-check", "does-not-exist",
      ], env);
      assert.equal(unknownAcceptance.status, 2, unknownAcceptance.stdout || unknownAcceptance.stderr);
      assert.match(unknownAcceptance.stdout || unknownAcceptance.stderr, /INVALID_VALIDATION_PROFILE/);
      await assert.rejects(readFile(join(dir, "ready-unknown.json"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not write output for an unschedulable read-write cycle", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const a = await writeContract(dir, "a", ["a.txt"], ["b.txt"]);
      const b = await writeContract(dir, "b", ["b.txt"], ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "cycle",
        tasks: [{ id: "a", contract: a }, { id: "b", contract: b }],
      }));
      const result = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready-plan.json",
      ], await fakeCodexEnv(dir));
      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).data.cycles.length, 1);
      await assert.rejects(readFile(join(dir, "ready-plan.json"), "utf8"));

      const explicitlyIgnored = runCli(dir, [
        "--json", "plan", "prepare", "plan.json", "--no-read-hazards",
        "--target", "codex", "--out", "ready-plan.json",
        "--validation-command", process.execPath,
      ], await fakeCodexEnv(dir));
      assert.equal(explicitlyIgnored.status, 0, explicitlyIgnored.stdout || explicitlyIgnored.stderr);
      assert.deepEqual(JSON.parse(explicitlyIgnored.stdout).data.stages, [["a", "b"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks a missing agent CLI and a failing workspace preflight", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contract = await writeContract(dir, "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "blocked",
        tasks: [{ id: "a", contract }],
      }));
      const missingCli = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "claude", "--out", "missing-cli.json",
      ], await gitOnlyEnv(dir));
      assert.equal(missingCli.status, 1, missingCli.stdout || missingCli.stderr);
      assert.equal(JSON.parse(missingCli.stdout).data.preflight.executable.found, false);
      await assert.rejects(readFile(join(dir, "missing-cli.json"), "utf8"));

      await writeFile(join(dir, "agents.json"), JSON.stringify({
        schemaVersion: 1,
        targets: ["codex"],
        rules: [{ id: "missing", path: "missing-rule.md", required: true }],
        policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
      }));
      const badManifest = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--manifest", "agents.json", "--out", "blocked.json",
      ], await fakeCodexEnv(dir));
      assert.equal(badManifest.status, 1, badManifest.stdout || badManifest.stderr);
      assert.ok(JSON.parse(badManifest.stdout).data.preflight.workspace.summary.violationsCount > 0);
      await assert.rejects(readFile(join(dir, "blocked.json"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails actionably for an unknown target or missing contract", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "invalid",
        tasks: [{ id: "a", contract: "missing.json" }],
      }));
      const target = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "other", "--out", "ready.json",
      ]);
      assert.equal(target.status, 2);
      assert.equal(JSON.parse(target.stdout).error.code, "UNKNOWN_TARGET");

      const contract = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready.json",
      ]);
      assert.equal(contract.status, 2);
      assert.equal(JSON.parse(contract.stdout).error.code, "CONTRACT_NOT_FOUND");
      await assert.rejects(readFile(join(dir, "ready.json"), "utf8"));

      const draft = runCli(dir, [
        "contract", "new", "--task", "draft", "--id", "draft",
        "--planned", "draft.txt", "--out", "draft.json",
      ]);
      assert.equal(draft.status, 0, draft.stderr);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "unapproved",
        tasks: [{ id: "draft", contract: "draft.json" }],
      }));
      const unapproved = runCli(dir, [
        "--json", "plan", "prepare", "plan.json",
        "--target", "codex", "--out", "ready.json",
      ]);
      assert.equal(unapproved.status, 2);
      assert.equal(JSON.parse(unapproved.stdout).error.code, "CONTRACT_NOT_APPROVED");
      await assert.rejects(readFile(join(dir, "ready.json"), "utf8"));
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
    const approved = runCli(dir, ["approve", file]);
    assert.equal(approved.status, 0, approved.stdout || approved.stderr);
  }

  it("requires explicit confirmation and rejects shell strings by default", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "trust-gate",
          tasks: [{ id: "a", contract: "a.json", command: "echo unsafe > a.txt" }],
        }),
      );

      const unconfirmed = runCli(dir, ["--json", "run", "--plan", "plan.json", "--no-check-drift"]);
      assert.equal(unconfirmed.status, 2);
      assert.equal(JSON.parse(unconfirmed.stdout).error.code, "PLAN_CONFIRMATION_REQUIRED");

      const noShellOptIn = runCli(dir, ["--json", "run", "--yes", "--plan", "plan.json", "--no-check-drift"]);
      assert.equal(noShellOptIn.status, 2);
      assert.equal(JSON.parse(noShellOptIn.stdout).error.code, "SHELL_COMMAND_NOT_ALLOWED");
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("disposes an injected reporter when run preflight throws", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      const recording = recordingReporter();
      process.chdir(dir);
      await assert.rejects(
        runPlanCommand({ plan: "missing.json", reporter: recording.reporter }),
        /missing\.json/,
      );
      assert.equal(recording.disposeCount(), 1);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cannot run an isolation-required plan in direct mode", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "isolation-required",
        execution: { isolation: "required" },
        tasks: [{
          id: "never-run",
          contract: "missing.json",
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('escaped.txt','bad')"],
        }],
      }));
      const result = runCli(dir, [
        "--json", "run", "--yes", "--allow-shell", "--plan", "plan.json", "--no-check-drift",
      ]);
      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, "PLAN_REQUIRES_ISOLATION");
      await assert.rejects(readFile(join(dir, "escaped.txt"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires validation before isolated dispatch starts", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "missing-validation",
        execution: { isolation: "required" },
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','bad')"],
        }],
      }));
      commitFixture(dir, "missing validation fixture");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);
      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, "VALIDATION_REQUIRED");
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
      assert.doesNotMatch(
        spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout,
        /scopelock-isolate-/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an argv-array shell invocation (sh -c ...) as a shell command too (M0.9)", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "trust-gate-argv-shell",
          tasks: [{ id: "a", contract: "a.json", command: ["sh", "-c", "echo unsafe > a.txt"] }],
        }),
      );

      const noShellOptIn = runCli(dir, ["--json", "run", "--yes", "--plan", "plan.json", "--no-check-drift"]);
      assert.equal(noShellOptIn.status, 2);
      assert.equal(JSON.parse(noShellOptIn.stdout).error.code, "SHELL_COMMAND_NOT_ALLOWED");
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));

      const withShellOptIn = runCli(dir, [
        "--json",
        "run",
        "--yes",
        "--allow-shell",
        "--plan",
        "plan.json",
        "--no-check-drift",
      ]);
      assert.equal(withShellOptIn.status, 0, withShellOptIn.stdout || withShellOptIn.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "unsafe\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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
        "--yes",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--store-raw-output",
        "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "a");
      assert.equal(await readFile(join(dir, "b.txt"), "utf8"), "b");

      const body = JSON.parse(res.stdout);
      assert.doesNotMatch(res.stdout, /\u001b|\[wave /);
      assert.equal(body.status, "ok");
      assert.equal(body.data.receiptPath, receiptPath);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.deepEqual(receipt.waves, [["a", "b"]]);
      assert.deepEqual(receipt.deferredTasks, []);
      assert.equal(receipt.taskRuns.length, 2);
      assert.ok(receipt.taskRuns.every((task: { status: string }) => task.status === "passed"));
      assert.match(receipt.inputs.plan.sha256, /^[a-f0-9]{64}$/);
      assert.match(receipt.inputs.contracts.a.sha256, /^[a-f0-9]{64}$/);

      const human = runCli(dir, [
        "run",
        "--yes",
        "--plan",
        "plan.json",
        "--receipt",
        join(dir, "human-receipt.json"),
        "--no-check-drift",
      ]);
      assert.equal(human.status, 0, human.stdout || human.stderr);
      assert.match(human.stdout, /^\[wave 1\/1\] starting: a, b\n/);
      assert.match(human.stdout, /\[wave 1\] a: running\n/);
      assert.match(human.stdout, /\[wave 1\] b: running\n/);
      assert.match(human.stdout, /\[wave 1\] [ab]: passed \([0-9.]+s\)\n/);
      assert.match(human.stdout, /\nScopeLock flight run: run-demo Configured gates cleared\n/);
      assert.doesNotMatch(human.stdout, /\u001b/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders not-exercised evidence as dim SKIP in the terminal summary", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "skip-labels",
        tasks: [{
          id: "a",
          contract: "a.json",
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt', 'a')"],
        }],
      }));
      const res = runCli(dir, [
        "run", "--yes", "--plan", "plan.json",
        "--receipt", join(dir, "receipt.json"),
        "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      assert.match(res.stdout, /Configured gates cleared/);
      // Informational statuses are dim SKIP, not WARN and not PASS.
      assert.match(res.stdout, /SKIP unverified/);
      assert.match(res.stdout, /SKIP not-applicable/);
      assert.match(res.stdout, /SKIP not-checked/);
      assert.doesNotMatch(res.stdout, /WARN unverified/);
      assert.doesNotMatch(res.stdout, /PASS not-applicable/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports concurrent direct-task lifecycle without serializing a wave", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeContract(dir, join(dir, "b.json"), "b", ["b.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "direct-progress",
        tasks: [
          {
            id: "a",
            contract: "a.json",
            command: [
              process.execPath,
              "-e",
              "setTimeout(()=>require('node:fs').writeFileSync('a.txt','a'),40)",
            ],
          },
          {
            id: "b",
            contract: "b.json",
            command: [
              process.execPath,
              "-e",
              "setTimeout(()=>require('node:fs').writeFileSync('b.txt','b'),5)",
            ],
          },
        ],
      }));
      const recording = recordingReporter();
      process.chdir(dir);

      await runPlanCommand({
        plan: "plan.json",
        yes: true,
        checkDrift: false,
        receipt: "receipt.json",
        reporter: recording.reporter,
      });

      assert.deepEqual(recording.events[0], {
        type: "wave-start",
        wave: 1,
        totalWaves: 1,
        taskIds: ["a", "b"],
      });
      const firstDone = recording.events.findIndex((event) => event.type === "task-done");
      const startsBeforeDone = recording.events
        .slice(0, firstDone)
        .filter((event) => event.type === "task-start")
        .map((event) => event.id)
        .sort();
      assert.deepEqual(startsBeforeDone, ["a", "b"]);
      const done = recording.events
        .filter((event) => event.type === "task-done")
        .map((event) => [event.id, event.status])
        .sort();
      assert.deepEqual(done, [["a", "passed"], ["b", "passed"]]);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not start a later direct wave before the previous wave finishes", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      await writeContract(dir, join(dir, "writer.json"), "writer", ["shared.txt"]);
      await writeContract(dir, join(dir, "reader.json"), "reader", ["observed.txt"], ["shared.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "direct-progress-waves",
        tasks: [
          {
            id: "writer",
            contract: "writer.json",
            command: [process.execPath, "-e", "require('node:fs').writeFileSync('shared.txt','ready')"],
          },
          {
            id: "reader",
            contract: "reader.json",
            command: [
              process.execPath,
              "-e",
              "const f=require('node:fs');f.writeFileSync('observed.txt',f.readFileSync('shared.txt','utf8'))",
            ],
          },
        ],
      }));
      const recording = recordingReporter();
      process.chdir(dir);

      await runPlanCommand({
        plan: "plan.json",
        yes: true,
        checkDrift: false,
        receipt: "receipt.json",
        reporter: recording.reporter,
      });

      const writerDone = recording.events.findIndex(
        (event) => event.type === "task-done" && event.id === "writer",
      );
      const waveTwo = recording.events.findIndex(
        (event) => event.type === "wave-start" && event.wave === 2,
      );
      const readerStart = recording.events.findIndex(
        (event) => event.type === "task-start" && event.id === "reader",
      );
      assert.ok(writerDone >= 0 && waveTwo > writerDone && readerStart > waveTwo);
      assert.equal(recording.disposeCount(), 1);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports isolated task, validation, promotion, and cleanup lifecycle in order", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "isolated-progress",
        execution: isolatedChecksExecution([
          { id: "unit", command: [process.execPath, "-e", "process.exit(0)"] },
          { id: "analyze", command: [process.execPath, "-e", "process.exit(0)"], required: false },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "isolated progress fixture");
      const recording = recordingReporter();
      process.chdir(dir);

      const result = await runPlanCommand({
        plan: "plan.json",
        yes: true,
        isolate: true,
        checkDrift: false,
        receipt: "receipt.json",
        reporter: recording.reporter,
      });

      assert.equal(result.exitCode, 0);
      assert.deepEqual(
        recording.events.map((event) =>
          event.type === "phase" ? `phase:${event.name}`
          : "id" in event ? `${event.type}:${event.id}`
          : event.type),
        [
          "wave-start",
          "task-start:a",
          "task-done:a",
          "phase:validating",
          "check-start:unit",
          "check-done:unit",
          "check-start:analyze",
          "check-done:analyze",
          "phase:promoting",
          "phase:cleaning-up",
        ],
      );
      assert.equal(recording.disposeCount(), 1);
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a failed required check and later checks as skipped without starting them", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "isolated-progress-failure",
        execution: isolatedChecksExecution([
          {
            id: "unit",
            command: [process.execPath, "-e", "process.stderr.write('safe failure');process.exit(7)"],
          },
          { id: "analyze", command: [process.execPath, "-e", "process.exit(0)"], required: false },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "isolated progress failure fixture");
      const recording = recordingReporter();
      process.chdir(dir);

      const result = await runPlanCommand({
        plan: "plan.json",
        yes: true,
        isolate: true,
        checkDrift: false,
        receipt: "receipt.json",
        reporter: recording.reporter,
      });

      assert.equal(result.exitCode, 1);
      const unitDone = recording.events.find(
        (event) => event.type === "check-done" && event.id === "unit",
      );
      const analyzeStart = recording.events.find(
        (event) => event.type === "check-start" && event.id === "analyze",
      );
      const analyzeDone = recording.events.find(
        (event) => event.type === "check-done" && event.id === "analyze",
      );
      assert.equal(unitDone?.type, "check-done");
      if (unitDone?.type === "check-done") {
        assert.equal(unitDone.status, "failed");
        assert.ok(unitDone.durationMs >= 0);
        assert.equal(unitDone.reason, "safe failure");
      }
      assert.equal(analyzeStart, undefined);
      assert.equal(analyzeDone?.type, "check-done");
      if (analyzeDone?.type === "check-done") {
        assert.equal(analyzeDone.status, "skipped");
        assert.match(analyzeDone.skipReason ?? "", /earlier required check failed/);
      }
      assert.ok(recording.events.some(
        (event) => event.type === "phase" && event.name === "promoting",
      ));
      assert.ok(recording.events.some(
        (event) => event.type === "phase" && event.name === "cleaning-up",
      ));
      const taskUpdates = recording.events.filter(
        (event) => event.type === "task-done" && event.id === "a",
      );
      const finalTaskUpdate = taskUpdates.at(-1);
      assert.equal(finalTaskUpdate?.type, "task-done");
      if (finalTaskUpdate?.type === "task-done") {
        assert.equal(finalTaskUpdate.status, "blocked");
        assert.equal(finalTaskUpdate.updated, true);
        assert.match(finalTaskUpdate.reason ?? "", /validation failed/);
      }
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a scope-rejected isolated task as blocked rather than passed", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      const fakeSecret = `sk-${"s".repeat(24)}`;
      const secretWithControl = `sk-${"s".repeat(12)}\u0007${"s".repeat(12)}`;
      await writeContract(dir, join(dir, "a.json"), "a", ["allowed.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "isolated-progress-scope",
        execution: isolatedExecution(),
        tasks: [{
          id: "a",
          contract: "a.json",
          command: [
            process.execPath,
            "-e",
            `require('node:fs').writeFileSync(${JSON.stringify(secretWithControl)},'blocked')`,
          ],
        }],
      }));
      commitFixture(dir, "isolated progress scope fixture");
      const recording = recordingReporter();
      process.chdir(dir);

      await runPlanCommand({
        plan: "plan.json",
        yes: true,
        isolate: true,
        checkDrift: false,
        receipt: "receipt.json",
        reporter: recording.reporter,
      });

      const taskDone = recording.events.find(
        (event) => event.type === "task-done" && event.id === "a",
      );
      assert.equal(taskDone?.type, "task-done");
      if (taskDone?.type === "task-done") {
        assert.equal(taskDone.status, "blocked");
        assert.match(taskDone.reason ?? "", /outside/);
        assert.doesNotMatch(taskDone.reason ?? "", /\u0007/);
        assert.doesNotMatch(taskDone.reason ?? "", new RegExp(fakeSecret));
        assert.match(taskDone.reason ?? "", /REDACTED/);
      }
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("corrects validation progress when restoring hidden control state fails", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "isolated-progress-restore-failure",
        execution: isolatedChecksExecution([{
          id: "unit",
          command: [
            process.execPath,
            "-e",
            "const f=require('node:fs');f.mkdirSync('.scopelock');"
            + "f.writeFileSync('.scopelock/blocker','x');process.exit(0)",
          ],
        }]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "isolated progress restore failure fixture");
      const recording = recordingReporter();
      process.chdir(dir);

      const result = await runPlanCommand({
        plan: "plan.json",
        yes: true,
        isolate: true,
        checkDrift: false,
        receipt: "receipt.json",
        reporter: recording.reporter,
      });

      assert.equal(result.exitCode, 1);
      const checkUpdates = recording.events.filter(
        (event) => event.type === "check-done" && event.id === "unit",
      );
      const finalCheckUpdate = checkUpdates.at(-1);
      assert.equal(finalCheckUpdate?.type, "check-done");
      if (finalCheckUpdate?.type === "check-done") {
        assert.equal(finalCheckUpdate.status, "failed");
        assert.equal(finalCheckUpdate.updated, true);
        assert.match(finalCheckUpdate.reason ?? "", /failed to restore validation workspace/);
      }
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports no-candidate validation checks as skipped without a running event", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const previousCwd = process.cwd();
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "isolated-progress-no-changes",
        execution: isolatedExecution(),
        tasks: [{
          id: "a",
          contract: "a.json",
          command: [process.execPath, "-e", "process.exit(0)"],
        }],
      }));
      commitFixture(dir, "isolated progress no changes fixture");
      const recording = recordingReporter();
      process.chdir(dir);

      const result = await runPlanCommand({
        plan: "plan.json",
        yes: true,
        isolate: true,
        checkDrift: false,
        receipt: "receipt.json",
        reporter: recording.reporter,
      });

      assert.equal(result.exitCode, 0);
      assert.equal(recording.events.some((event) => event.type === "check-start"), false);
      const checkDone = recording.events.find((event) => event.type === "check-done");
      assert.equal(checkDone?.type, "check-done");
      if (checkDone?.type === "check-done") {
        assert.equal(checkDone.status, "skipped");
        assert.match(checkDone.skipReason ?? "", /no candidate changes/);
      }
    } finally {
      process.chdir(previousCwd);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("isolates tasks, carries accepted output to later waves, and promotes once", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "writer.json"), "writer", ["shared.txt"]);
      await writeContract(dir, join(dir, "reader.json"), "reader", ["observed.txt"], ["shared.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-waves",
          execution: isolatedExecution(),
          tasks: [
            {
              id: "writer",
              contract: "writer.json",
              expectsChanges: true,
              command: [process.execPath, "-e", "require('node:fs').writeFileSync('shared.txt','wave-one')"],
            },
            {
              id: "reader",
              contract: "reader.json",
              expectsChanges: true,
              command: [
                process.execPath,
                "-e",
                "const f=require('node:fs');f.writeFileSync('observed.txt',f.readFileSync('shared.txt','utf8'))",
              ],
            },
          ],
        }),
      );
      commitFixture(dir, "isolated fixture");

      const receiptPath = join(dir, ".scopelock", "reports", "isolated.json");
      const result = runCli(dir, [
        "--json",
        "run",
        "--yes",
        "--isolate",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--no-check-drift",
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(await readFile(join(dir, "shared.txt"), "utf8"), "wave-one");
      assert.equal(await readFile(join(dir, "observed.txt"), "utf8"), "wave-one");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.schemaVersion, 6);
      assert.equal(receipt.inputs.executionRequirement.isolation, "required");
      assert.equal(receipt.inputs.effectiveExecutionMode, "isolated");
      assert.deepEqual(receipt.waves, [["writer"], ["reader"]]);
      assert.equal(receipt.isolation.finalPromotion, "applied");
      assert.equal(receipt.isolation.validationChecks.length, 1);
      assert.equal(receipt.isolation.validationChecks[0].id, "repository-validation");
      assert.equal(receipt.isolation.validationChecks[0].status, "passed");
      assert.equal(receipt.isolation.validationChecks[0].required, true);
      assert.equal(receipt.isolation.cleanup.status, "ok");
      assert.match(receipt.isolation.aggregatePatchSha256, /^[a-f0-9]{64}$/);
      assert.ok(receipt.taskRuns.every((task: { isolation: { outcome: string } }) =>
        task.isolation.outcome === "accepted-integration"));
      const report = runCli(dir, ["report", receiptPath]);
      assert.equal(report.status, 0, report.stdout || report.stderr);
      const html = await readFile(receiptPath.replace(/\.json$/, ".html"), "utf8");
      assert.match(html, /Final promotion/);
      assert.match(html, /Validation Checks/);
      assert.match(html, /repository-validation/);
      assert.match(html, />passed</);
      assert.match(html, /accepted-integration/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("checks drift against every task's own contract, not just the last-approved one", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      // The plan file and the contract drafts are the test harness's own
      // control-plane clutter, not agent-authored output - they must land in
      // the baseline commit (plan.json) or under the drift-exempt
      // .scopelock/contracts/ path (the approved copies) *before* the
      // baseline is captured, or they would themselves surface as
      // false-positive outside_scope violations and mask the assertion this
      // test exists to make. See collectChangedFiles's isScopelockArtifact
      // exemption in packages/core/src/drift/collect.ts.
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-multi-contract-drift",
          execution: isolatedExecution(),
          tasks: [
            {
              id: "writer",
              contract: ".scopelock/contracts/writer.json",
              expectsChanges: true,
              command: [process.execPath, "-e", "require('node:fs').writeFileSync('shared.txt','wave-one')"],
            },
            {
              id: "reader",
              contract: ".scopelock/contracts/reader.json",
              expectsChanges: true,
              command: [
                process.execPath,
                "-e",
                "const f=require('node:fs');f.writeFileSync('observed.txt',f.readFileSync('shared.txt','utf8'))",
              ],
            },
          ],
        }),
      );
      commitFixture(dir, "isolated multi-contract drift plan fixture");

      await writeContract(dir, join(tmpdir(), `sl-run-drift-writer-${Date.now()}.json`), "writer", ["shared.txt"]);
      await writeContract(
        dir,
        join(tmpdir(), `sl-run-drift-reader-${Date.now()}.json`),
        "reader",
        ["observed.txt"],
        ["shared.txt"],
      );
      commitFixture(dir, "isolated multi-contract drift contracts fixture");

      const receiptPath = join(dir, ".scopelock", "reports", "isolated-drift.json");
      const result = runCli(dir, [
        "--json",
        "run",
        "--yes",
        "--isolate",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.drift.status, "ok");
      const violations = receipt.drift.data.report.violations as { type: string; path: string | null }[];
      assert.deepEqual(
        violations.filter((v) => v.type === "outside_scope"),
        [],
      );
      assert.deepEqual(receipt.drift.data.report.contractIds.slice().sort(), ["reader", "writer"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lets a real agent hook invocation pass inside an isolated task worktree (Pilot 4 P0 regression)", async (t) => {
    // .scopelock/active and the OS-level approval seal are per-machine state
    // that `git worktree add` never copies into an isolated task worktree.
    // Before this was fixed, a real Claude/Cursor/Codex hook running inside
    // one always saw "no active contract" in strict mode and denied every
    // edit, even though the task's own contract was already approved -
    // discovered live during Pilot 4 when two real Claude Code agents found
    // the right upstream fix but could not save it. This drives the actual
    // `scopelock hook gate` entrypoint (what a real hook shells out to) from
    // inside the task's own command, through the real `run --isolate`
    // pipeline, instead of calling `evaluateHookGate` directly.
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      assert.equal(runCli(dir, ["init"]).status, 0);
      await writeFile(
        join(dir, ".scopelock", "config.json"),
        JSON.stringify({ schemaVersion: 1, mode: "strict" }),
      );
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      const hookProbe = [
        "const { spawnSync } = require('node:child_process');",
        "const fs = require('node:fs');",
        `const r = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(CLI)}, 'hook', 'gate'], { input: JSON.stringify({ tool_input: { file_path: 'a.txt' } }), encoding: 'utf8' });`,
        "if (r.status !== 0) { process.stderr.write('HOOK_DENIED: ' + r.status + ' ' + r.stderr); process.exit(1); }",
        "fs.writeFileSync('a.txt', 'allowed-by-hook');",
      ].join("\n");
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-hook-passthrough",
          execution: isolatedExecution(),
          tasks: [
            {
              id: "a",
              // References the approved copy under .scopelock/contracts/,
              // not the unstamped draft at a.json - the fix requires a real
              // baseline (see run-plan.ts's `contract.baseline !== null`
              // guard), matching exactly how a real `plan prepare` ready
              // plan references contracts in production.
              contract: ".scopelock/contracts/a.json",
              expectsChanges: true,
              command: [process.execPath, "-e", hookProbe],
            },
          ],
        }),
      );
      commitFixture(dir, "isolated hook passthrough fixture");

      const receiptPath = join(dir, "receipt.json");
      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "allowed-by-hook");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.taskRuns[0].status, "passed");
      assert.equal(receipt.taskRuns[0].isolation.outcome, "accepted-integration");
      assert.equal(receipt.isolation.finalPromotion, "applied");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks promotion when repository validation fails and hides control state", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      const validation = [
        "const fs=require('node:fs');",
        "if(fs.existsSync('.scopelock'))process.exit(9);",
        "process.exit(7);",
      ].join("");
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-failure",
        execution: isolatedExecution(validation),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      await writeFile(join(dir, ".scopelock", "validation-marker.txt"), "control-state\n");
      commitFixture(dir, "validation failure fixture");
      const markerBefore = await readFile(join(dir, ".scopelock", "validation-marker.txt"), "utf8");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-failure.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);
      assert.equal(result.status, 1, result.stdout || result.stderr);
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
      assert.equal(await readFile(join(dir, ".scopelock", "validation-marker.txt"), "utf8"), markerBefore);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationChecks.length, 1);
      assert.equal(receipt.isolation.validationChecks[0].status, "failed");
      assert.equal(receipt.isolation.validationChecks[0].exitCode, 7);
      assert.equal(receipt.isolation.validationChecks[0].required, true);
      assert.equal(receipt.isolation.finalPromotion, "blocked");
      assert.equal(receipt.taskRuns[0].status, "blocked");
      assert.equal(receipt.taskRuns[0].isolation.outcome, "not-promoted-final");
      assert.ok(receipt.taskRuns[0].isolation.findings.some(
        (finding: { code: string }) => finding.code === "VALIDATION_FAILED",
      ));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("executes an ordered list of validation checks and records order, cwd, duration, command, and redacted output", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await mkdir(join(dir, "app"), { recursive: true });
      // Git does not track empty directories - without a file inside it,
      // "app" would never make it into the isolated candidate worktree's
      // checkout, and the per-check cwd override below would fail with a
      // spurious ENOENT unrelated to what this test is proving.
      await writeFile(join(dir, "app", ".keep"), "");
      const fakeSecret = `sk-${"z".repeat(24)}`;
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-checks-success",
        execution: isolatedChecksExecution([
          {
            id: "first-check",
            command: [process.execPath, "-e", `process.stdout.write('${fakeSecret}');process.exit(0)`],
          },
          {
            id: "second-check",
            cwd: "app",
            command: [process.execPath, "-e", "process.exit(0)"],
            required: false,
          },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation checks success fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-checks-success.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--store-raw-output", "--no-check-drift",
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.schemaVersion, 6);
      assert.equal(receipt.isolation.validationChecks.length, 2);
      const [first, second] = receipt.isolation.validationChecks;
      assert.equal(first.id, "first-check");
      assert.equal(first.status, "passed");
      assert.equal(first.required, true);
      assert.equal(first.cwd, ".");
      assert.ok(typeof first.durationMs === "number" && first.durationMs >= 0);
      assert.deepEqual(first.command, [process.execPath, "-e", "process.stdout.write('[REDACTED]');process.exit(0)"]);
      assert.doesNotMatch(first.stdout, new RegExp(fakeSecret));
      assert.match(first.stdout, /REDACTED/);
      assert.equal(second.id, "second-check");
      assert.equal(second.status, "passed");
      assert.equal(second.required, false);
      assert.equal(second.cwd, "app");
      assert.ok(typeof second.durationMs === "number" && second.durationMs >= 0);
      assert.equal(receipt.isolation.finalPromotion, "applied");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps task and validation raw artifacts distinct when their ids match", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "same.json"), "same", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "artifact-namespace",
        execution: isolatedChecksExecution([{
          id: "same",
          command: [process.execPath, "-e", "process.stdout.write('validation-output')"],
        }]),
        tasks: [{
          id: "same",
          contract: "same.json",
          expectsChanges: true,
          command: [
            process.execPath,
            "-e",
            "require('node:fs').writeFileSync('a.txt','candidate');process.stdout.write('task-output')",
          ],
        }],
      }));
      commitFixture(dir, "artifact namespace fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "artifact-namespace.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--store-raw-output", "--no-check-drift",
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      const taskArtifact = receipt.taskRuns[0].outputArtifacts.stdout.path;
      const checkArtifact = receipt.isolation.validationChecks[0].outputArtifacts.stdout.path;
      assert.notEqual(taskArtifact, checkArtifact);
      assert.equal(await readFile(taskArtifact, "utf8"), "task-output");
      assert.equal(await readFile(checkArtifact, "utf8"), "validation-output");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops after the first required check fails and records later checks as skipped", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-required-failure",
        execution: isolatedChecksExecution([
          { id: "failing-check", command: [process.execPath, "-e", "process.exit(3)"] },
          { id: "never-runs", command: [process.execPath, "-e", "require('node:fs').writeFileSync('never-runs.txt','yes')"] },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation required failure fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-required-failure.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.equal(existsSync(join(dir, "never-runs.txt")), false);
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationChecks.length, 2);
      assert.equal(receipt.isolation.validationChecks[0].id, "failing-check");
      assert.equal(receipt.isolation.validationChecks[0].status, "failed");
      assert.equal(receipt.isolation.validationChecks[0].exitCode, 3);
      assert.equal(receipt.isolation.validationChecks[1].id, "never-runs");
      assert.equal(receipt.isolation.validationChecks[1].status, "skipped");
      assert.equal(receipt.isolation.validationChecks[1].exitCode, null);
      assert.match(receipt.isolation.validationChecks[1].stderr, /earlier required check failed/);
      assert.equal(receipt.isolation.finalPromotion, "blocked");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps running later checks after an optional check fails but still promotes", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-optional-failure",
        execution: isolatedChecksExecution([
          { id: "optional-check", command: [process.execPath, "-e", "process.exit(3)"], required: false },
          { id: "required-check", command: [process.execPath, "-e", "process.exit(0)"] },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation optional failure fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-optional-failure.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "candidate");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationChecks.length, 2);
      assert.equal(receipt.isolation.validationChecks[0].id, "optional-check");
      assert.equal(receipt.isolation.validationChecks[0].status, "failed");
      assert.equal(receipt.isolation.validationChecks[0].required, false);
      assert.equal(receipt.isolation.validationChecks[1].id, "required-check");
      assert.equal(receipt.isolation.validationChecks[1].status, "passed");
      assert.equal(receipt.isolation.validationChecks[1].required, true);
      assert.equal(receipt.isolation.finalPromotion, "applied");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a per-check working directory that is missing before any agent starts", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["agent-ran.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "missing-check-cwd",
        execution: isolatedChecksExecution([
          { id: "ok-check", command: [process.execPath, "-e", "process.exit(0)"] },
          { id: "missing-cwd-check", cwd: "missing", command: [process.execPath, "-e", "process.exit(0)"] },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('agent-ran.txt','yes')"],
        }],
      }));
      commitFixture(dir, "missing check cwd fixture");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);

      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.match(result.stdout || result.stderr, /INVALID_VALIDATION_CWD/);
      assert.equal(existsSync(join(dir, "agent-ran.txt")), false);
      const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.doesNotMatch(worktrees.stdout, /scopelock-isolate-/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a per-check working directory symlink that escapes the repository", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const outside = await mkdtemp(join(tmpdir(), "scopelock-validation-check-outside-"));
    try {
      await writeFile(join(dir, ".gitignore"), "escape\n");
      await writeContract(dir, join(dir, "a.json"), "a", ["agent-ran.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "escaped-check-cwd",
        execution: isolatedChecksExecution([
          { id: "ok-check", command: [process.execPath, "-e", "process.exit(0)"] },
          { id: "escaped-cwd-check", cwd: "escape", command: [process.execPath, "-e", "process.exit(0)"] },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('agent-ran.txt','yes')"],
        }],
      }));
      commitFixture(dir, "escaped check cwd fixture");
      await symlink(outside, join(dir, "escape"), process.platform === "win32" ? "junction" : "dir");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);

      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.match(result.stdout || result.stderr, /INVALID_VALIDATION_CWD/);
      assert.equal(existsSync(join(dir, "agent-ran.txt")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reuses checkout-local Node tools when validating an isolated candidate", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      const binDir = join(dir, "node_modules", ".bin");
      await mkdir(binDir, { recursive: true });
      const tool = join(binDir, "fixture-validator");
      await writeFile(tool, "#!/usr/bin/env node\nprocess.exit(require('node:fs').readFileSync('a.txt','utf8') === 'candidate' ? 0 : 8)\n");
      await chmod(tool, 0o755);
      await writeFile(
        `${tool}.cmd`,
        "@node -e \"process.exit(require('node:fs').readFileSync('a.txt','utf8') === 'candidate' ? 0 : 8)\"\r\n",
      );
      const fixtureDependency = join(dir, "node_modules", "fixture-dependency");
      await mkdir(fixtureDependency, { recursive: true });
      await writeFile(join(fixtureDependency, "index.js"), "module.exports = 'available'\n");
      await writeFile(
        join(dir, "validate.cjs"),
        "process.exit(require('fixture-dependency') === 'available' && require('./generated.cjs') === 'generated' ? 0 : 9)\n",
      );
      await writeFile(
        join(dir, "generate.cjs"),
        "require('node:fs').writeFileSync('generated.cjs', \"module.exports = 'generated'\\n\")\n",
      );
      await writeFile(join(dir, "package.json"), JSON.stringify({
        scripts: {
          prepare: "node generate.cjs",
          check: "fixture-validator && node validate.cjs",
        },
      }));
      await writeFile(join(dir, ".gitignore"), "node_modules/\ngenerated.cjs\n");
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "checkout-toolchain-validation",
        execution: {
          isolation: "required",
          validation: {
            setup: await packageManagerRunCommand("npm", "prepare"),
            command: await packageManagerRunCommand("npm", "check"),
          },
        },
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "checkout toolchain fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "checkout-toolchain.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(await readFile(join(dir, "a.txt"), "utf8"), "candidate");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationSetup.status, "passed");
      assert.equal(receipt.isolation.validationChecks.length, 1);
      const [checkoutCheck] = receipt.isolation.validationChecks;
      assert.equal(checkoutCheck.status, "passed");
      assert.deepEqual(checkoutCheck.environment.pathPrepend, [await realpath(binDir)]);
      assert.equal(checkoutCheck.environment.workspaceLinks.length, 1);
      assert.equal(
        checkoutCheck.environment.workspaceLinks[0].source,
        join(await realpath(dir), "node_modules"),
      );
      assert.match(checkoutCheck.environment.workspaceLinks[0].path, /node_modules$/);
      assert.notEqual(
        checkoutCheck.environment.workspaceLinks[0].path,
        checkoutCheck.environment.workspaceLinks[0].source,
      );
      assert.equal(receipt.isolation.finalPromotion, "applied");
      assert.equal(existsSync(join(dir, "generated.cjs")), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks promotion and skips repository validation when candidate setup fails", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-setup-failure",
        execution: isolatedChecksExecution(
          [
            {
              id: "check-one",
              command: [process.execPath, "-e", "require('node:fs').writeFileSync('validation-ran.txt','yes')"],
            },
            {
              id: "check-two",
              command: [process.execPath, "-e", "require('node:fs').writeFileSync('check-two-ran.txt','yes')"],
              required: false,
            },
          ],
          [process.execPath, "-e", "process.exit(6)"],
        ),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation setup failure fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-setup-failure.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.equal(existsSync(join(dir, "a.txt")), false);
      assert.equal(existsSync(join(dir, "validation-ran.txt")), false);
      assert.equal(existsSync(join(dir, "check-two-ran.txt")), false);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationSetup.status, "failed");
      assert.equal(receipt.isolation.validationSetup.exitCode, 6);
      assert.equal(receipt.isolation.validationChecks.length, 2);
      // Every declared check must be recorded skipped (never silently
      // omitted) when setup never lets any check start - including the
      // optional second one.
      assert.ok(receipt.isolation.validationChecks.every(
        (check: { status: string; exitCode: number | null }) =>
          check.status === "skipped" && check.exitCode === null,
      ));
      assert.equal(receipt.isolation.validationChecks[0].id, "check-one");
      assert.equal(receipt.isolation.validationChecks[1].id, "check-two");
      assert.match(receipt.isolation.validationChecks[0].stderr, /setup failed/);
      assert.equal(receipt.isolation.finalPromotion, "blocked");
      assert.ok(receipt.taskRuns[0].isolation.findings.some(
        (finding: { code: string }) => finding.code === "VALIDATION_SETUP_FAILED",
      ));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks promotion when setup or validation mutates candidate files", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "tracked.txt"), "baseline\n");
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-mutation",
        execution: isolatedChecksExecution(
          [
            { id: "check-one", command: [process.execPath, "-e", "process.exit(0)"] },
            { id: "check-two", command: [process.execPath, "-e", "process.exit(0)"] },
          ],
          [process.execPath, "-e", "require('node:fs').writeFileSync('tracked.txt','mutated')"],
        ),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation mutation fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-mutation.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      assert.equal(await readFile(join(dir, "tracked.txt"), "utf8"), "baseline\n");
      assert.equal(existsSync(join(dir, "a.txt")), false);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationSetup.status, "passed");
      assert.equal(receipt.isolation.validationChecks.length, 2);
      assert.ok(receipt.isolation.validationChecks.every(
        (check: { status: string }) => check.status === "passed",
      ));
      assert.equal(receipt.isolation.validationWorkspaceClean, false);
      assert.equal(receipt.isolation.finalPromotion, "blocked");
      assert.ok(receipt.taskRuns[0].isolation.findings.some(
        (finding: { code: string }) => finding.code === "VALIDATION_MUTATED_CANDIDATE",
      ));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks promotion when repository validation times out", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-timeout",
        execution: isolatedExecution("setInterval(()=>{},1000)"),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation timeout fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-timeout.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--timeout-ms", "250",
        "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift",
      ]);
      assert.equal(result.status, 1, result.stdout || result.stderr);
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationChecks.length, 1);
      assert.equal(receipt.isolation.validationChecks[0].status, "failed");
      assert.equal(receipt.isolation.validationChecks[0].termination.reason, "timeout");
      assert.equal(receipt.isolation.finalPromotion, "blocked");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks promotion when a later validation check times out in a multi-check plan", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-timeout-multi",
        execution: isolatedChecksExecution([
          { id: "quick-check", command: [process.execPath, "-e", "process.exit(0)"] },
          { id: "slow-check", command: [process.execPath, "-e", "setInterval(()=>{},1000)"] },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation timeout multi fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-timeout-multi.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--timeout-ms", "250",
        "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift",
      ]);
      assert.equal(result.status, 1, result.stdout || result.stderr);
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.validationChecks.length, 2);
      assert.equal(receipt.isolation.validationChecks[0].id, "quick-check");
      assert.equal(receipt.isolation.validationChecks[0].status, "passed");
      assert.equal(receipt.isolation.validationChecks[1].id, "slow-check");
      assert.equal(receipt.isolation.validationChecks[1].status, "failed");
      assert.equal(receipt.isolation.validationChecks[1].termination.reason, "timeout");
      assert.equal(receipt.isolation.finalPromotion, "blocked");
      const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.doesNotMatch(worktrees.stdout, /scopelock-isolate-/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires explicit shell permission for repository validation commands", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-shell-gate",
        execution: {
          isolation: "required",
          validation: {
            setup: ["sh", "-c", "exit 0"],
            command: [process.execPath, "-e", "process.exit(0)"],
          },
        },
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation shell fixture");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);
      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, "SHELL_COMMAND_NOT_ALLOWED");
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gates every declared check for shell permission in a multi-check plan", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-shell-gate-multi",
        execution: isolatedChecksExecution([
          { id: "safe-check", command: [process.execPath, "-e", "process.exit(0)"] },
          { id: "shell-check", command: ["sh", "-c", "exit 0"] },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation shell gate multi fixture");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);
      assert.equal(result.status, 2, result.stdout || result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.error.code, "SHELL_COMMAND_NOT_ALLOWED");
      assert.match(body.error.message, /shell-check/);
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks an expected-change empty diff but preserves an optional manual task", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "empty.json"), "empty", ["result.txt"]);
      await writeContract(dir, join(dir, "manual.json"), "manual", ["manual.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-empty-diff",
          execution: isolatedExecution(),
          tasks: [{
            id: "empty",
            contract: "empty.json",
            expectsChanges: true,
            command: [process.execPath, "-e", "process.exit(0)"],
          }, {
            id: "manual",
            contract: "manual.json",
            command: [process.execPath, "-e", "process.exit(0)"],
          }],
        }),
      );
      commitFixture(dir, "empty diff fixture");

      const receiptPath = join(dir, ".scopelock", "reports", "empty.json");
      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.finalPromotion, "no-changes");
      const empty = receipt.taskRuns.find((task: { id: string }) => task.id === "empty");
      const manual = receipt.taskRuns.find((task: { id: string }) => task.id === "manual");
      assert.equal(empty.status, "blocked");
      assert.equal(empty.isolation.outcome, "rejected-no-changes");
      assert.ok(empty.isolation.findings.some(
        (finding: { code: string }) => finding.code === "EXPECTED_CHANGES_MISSING",
      ));
      assert.equal(manual.status, "passed");
      assert.equal(manual.isolation.outcome, "no-changes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks an expected-change task whose diff is outside planned scope", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "outside.json"), "outside", ["allowed.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-outside-diff",
          execution: isolatedExecution(),
          tasks: [{
            id: "outside",
            contract: "outside.json",
            expectsChanges: true,
            command: [
              process.execPath,
              "-e",
              "require('node:fs').writeFileSync('outside.txt','no')",
            ],
          }],
        }),
      );
      commitFixture(dir, "outside diff fixture");

      const receiptPath = join(dir, ".scopelock", "reports", "outside.json");
      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      await assert.rejects(readFile(join(dir, "outside.txt"), "utf8"));
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.taskRuns[0].status, "blocked");
      assert.equal(receipt.taskRuns[0].isolation.outcome, "rejected-scope");
      assert.ok(receipt.taskRuns[0].isolation.findings.some(
        (finding: { code: string }) => finding.code === "OUTSIDE_SCOPE",
      ));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects the whole isolated patch when one write is forbidden", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      const contractPath = join(dir, "mixed.json");
      assert.equal(
        runCli(dir, [
          "contract", "new", "--task", "mixed", "--id", "mixed",
          "--planned", "allowed.txt", "--forbidden", "forbidden.txt", "--out", contractPath,
        ]).status,
        0,
      );
      assert.equal(runCli(dir, ["approve", contractPath]).status, 0);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-forbidden",
          execution: isolatedExecution(),
          tasks: [{
            id: "mixed",
            contract: "mixed.json",
            command: [
              process.execPath,
              "-e",
              "const f=require('node:fs');f.writeFileSync('allowed.txt','ok');f.writeFileSync('forbidden.txt','no')",
            ],
          }],
        }),
      );
      commitFixture(dir, "forbidden fixture");

      const receiptPath = join(dir, ".scopelock", "reports", "forbidden.json");
      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json",
        "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      await assert.rejects(readFile(join(dir, "allowed.txt"), "utf8"));
      await assert.rejects(readFile(join(dir, "forbidden.txt"), "utf8"));
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.isolation.finalPromotion, "no-changes");
      assert.equal(receipt.taskRuns[0].status, "blocked");
      assert.equal(receipt.taskRuns[0].isolation.outcome, "rejected-scope");
      assert.ok(receipt.taskRuns[0].isolation.findings.some(
        (finding: { code: string }) => finding.code === "FORBIDDEN_PATH",
      ));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses isolated dispatch when the user repository is dirty", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-dirty",
          execution: isolatedExecution(),
          tasks: [{
            id: "a",
            contract: "a.json",
            command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','ran')"],
          }],
        }),
      );
      commitFixture(dir, "dirty fixture");
      await writeFile(join(dir, "dirty.txt"), "user work");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);

      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, "ISOLATION_REQUIRES_CLEAN_REPO");
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
      assert.equal(await readFile(join(dir, "dirty.txt"), "utf8"), "user work");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("offers three safe choices and no Git mutation for a dirty repository", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-dirty-guidance",
          execution: isolatedExecution(),
          tasks: [{
            id: "a",
            contract: "a.json",
            command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','ran')"],
          }],
        }),
      );
      commitFixture(dir, "dirty guidance fixture");
      await writeFile(join(dir, "dirty.txt"), "user work");
      const statusBefore = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--no-check-drift",
      ]);

      assert.equal(result.status, 2, result.stdout || result.stderr);
      const body = JSON.parse(result.stdout);
      assert.equal(body.error.code, "ISOLATION_REQUIRES_CLEAN_REPO");
      assert.match(body.error.message, /dirty\.txt/);
      assert.match(body.error.message, /review and commit/i);
      assert.match(body.error.message, /disposable clean clone/i);
      assert.match(body.error.message, /abort/i);
      assert.match(body.error.message, /will not commit, stash, clean/i);

      const statusAfter = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;
      assert.equal(statusAfter, statusBefore);
      await assert.rejects(readFile(join(dir, "a.txt"), "utf8"));
      assert.equal(await readFile(join(dir, "dirty.txt"), "utf8"), "user work");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects isolated plans above the bounded task limit", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-too-large",
          tasks: Array.from({ length: 33 }, (_, index) => ({
            id: `task-${index}`,
            contract: `task-${index}.json`,
          })),
        }),
      );
      const result = runCli(dir, ["--json", "run", "--isolate", "--plan", "plan.json"]);
      assert.equal(result.status, 2, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, "ISOLATION_TASK_LIMIT_EXCEEDED");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cleans isolated worktrees and refuses promotion after SIGTERM", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX signal delivery is not available on Windows");
      return;
    }
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const readyPath = join(tmpdir(), `scopelock-signal-${process.pid}-${Date.now()}.ready`);
    try {
      await writeContract(dir, join(dir, "slow.json"), "slow", ["result.txt"]);
      await writeContract(dir, join(dir, "later.json"), "later", ["later.txt"], ["result.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-signal",
          execution: isolatedExecution(),
          tasks: [{
            id: "slow",
            contract: "slow.json",
            command: [
              process.execPath,
              "-e",
              "const f=require('node:fs');f.writeFileSync(process.argv[1],'ready');"
              + "setTimeout(()=>f.writeFileSync('result.txt','late'),10000)",
              readyPath,
            ],
          }, {
            id: "later",
            contract: "later.json",
            command: [process.execPath, "-e", "require('node:fs').writeFileSync('later.txt','late')"],
          }],
        }),
      );
      commitFixture(dir, "signal fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "signal.json");
      const child = spawn(
        process.execPath,
        [CLI, "run", "--yes", "--isolate", "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift"],
        { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });

      const deadline = Date.now() + 5_000;
      let registered = false;
      while (Date.now() < deadline) {
        try {
          if ((await readFile(readyPath, "utf8")) === "ready") {
            registered = true;
            break;
          }
        } catch {
          // Wait until the task process is active.
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(registered, true, "isolated task was not active before timeout");
      child.kill("SIGTERM");
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("isolated CLI did not exit after SIGTERM"));
        }, 5_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });

      assert.equal(exitCode, 1, stdout || stderr);
      assert.match(stdout, /^\[wave 1\/2\] starting: slow\n\[wave 1\] slow: running\n/);
      assert.match(stdout, /\[wave 2\] later: skipped \(0\.0s\)/);
      assert.equal(stdout.match(/^interrupted$/gm)?.length, 1);
      assert.match(stdout, /\[phase\] cleaning-up\ninterrupted\n/);
      assert.doesNotMatch(stdout, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|\u001b/);
      await assert.rejects(readFile(join(dir, "result.txt"), "utf8"));
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.taskRuns.find((task: { id: string }) => task.id === "later").status, "skipped");
      assert.equal(receipt.isolation.interrupted, true);
      assert.equal(receipt.isolation.finalPromotion, "blocked");
      assert.equal(receipt.isolation.cleanup.status, "ok");
      const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.doesNotMatch(worktrees.stdout, /scopelock-isolate-/);
    } finally {
      await rm(readyPath, { force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("interrupts an active validation check and records later checks as not started", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX signal delivery is not available on Windows");
      return;
    }
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const readyPath = join(tmpdir(), `scopelock-validation-signal-${process.pid}-${Date.now()}.ready`);
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "validation-signal",
        execution: isolatedChecksExecution([
          { id: "first", command: [process.execPath, "-e", "process.exit(0)"] },
          {
            id: "active",
            command: [
              process.execPath,
              "-e",
              "require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",
              readyPath,
            ],
          },
          {
            id: "never-starts",
            command: [process.execPath, "-e", "require('node:fs').writeFileSync('never-started.txt','yes')"],
          },
        ]),
        tasks: [{
          id: "a",
          contract: "a.json",
          expectsChanges: true,
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt','candidate')"],
        }],
      }));
      commitFixture(dir, "validation signal fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "validation-signal.json");
      const child = spawn(
        process.execPath,
        [CLI, "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift"],
        { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });

      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          if ((await readFile(readyPath, "utf8")) === "ready") break;
        } catch {
          // Wait until the second validation process is active.
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(await readFile(readyPath, "utf8"), "ready", "validation process did not become ready");
      child.kill("SIGTERM");
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("validation CLI did not exit after SIGTERM"));
        }, 5_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });

      assert.equal(exitCode, 1, stdout || stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.deepEqual(
        receipt.isolation.validationChecks.map((check: { id: string; status: string }) => [check.id, check.status]),
        [["first", "passed"], ["active", "failed"], ["never-starts", "skipped"]],
      );
      assert.equal(receipt.isolation.validationChecks[1].termination.reason, "sigterm");
      assert.equal(receipt.isolation.validationChecks[2].skipReason, "interrupted");
      assert.equal(existsSync(join(dir, "never-started.txt")), false);
      assert.equal(receipt.isolation.finalPromotion, "blocked");
      assert.equal(receipt.isolation.cleanup.status, "ok");
    } finally {
      await rm(readyPath, { force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("force-kills an isolated task tree on a second SIGINT", async (t) => {
    if (process.platform === "win32") {
      t.skip("POSIX signal delivery is not available on Windows");
      return;
    }
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const readyPath = join(tmpdir(), `scopelock-second-signal-${process.pid}-${Date.now()}.ready`);
    try {
      await writeContract(dir, join(dir, "stubborn.json"), "stubborn", ["result.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-second-signal",
          execution: isolatedExecution(),
          tasks: [{
            id: "stubborn",
            contract: "stubborn.json",
            command: [
              process.execPath,
              "-e",
              "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",
              readyPath,
            ],
          }],
        }),
      );
      commitFixture(dir, "second signal fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "second-signal.json");
      const child = spawn(
        process.execPath,
        [CLI, "--json", "run", "--yes", "--isolate", "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift"],
        { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try {
          if ((await readFile(readyPath, "utf8")) === "ready") break;
        } catch {
          // Wait until the task process has installed its signal handlers.
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(await readFile(readyPath, "utf8"), "ready", "task process did not become ready");
      const closed = new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("CLI survived the second SIGINT"));
        }, 5_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });
      const started = Date.now();
      child.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 100));
      child.kill("SIGINT");
      const exitCode = await closed;
      assert.equal(exitCode, 1, stdout || stderr);
      assert.ok(Date.now() - started < 2_000, "second signal waited for graceful timeout");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.taskRuns[0].termination.reason, "sigint");
      assert.equal(receipt.taskRuns[0].termination.escalated, true);
      assert.equal(receipt.isolation.finalPromotion, "blocked");
      assert.equal(receipt.isolation.cleanup.status, "ok");
      const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.doesNotMatch(worktrees.stdout, /scopelock-isolate-/);
    } finally {
      await rm(readyPath, { force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("kills task descendants before cleaning an isolated timeout", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    const readyPath = join(tmpdir(), `scopelock-timeout-${process.pid}-${Date.now()}.json`);
    try {
      await writeContract(dir, join(dir, "slow-tree.json"), "slow-tree", ["result.txt"]);
      const script = [
        "const {spawn}=require('node:child_process');",
        "const fs=require('node:fs');",
        "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
        `fs.writeFileSync(${JSON.stringify(readyPath)},JSON.stringify({parent:process.pid,child:child.pid}));`,
        "setInterval(()=>{},1000);",
      ].join("");
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "isolated-timeout-tree",
          execution: isolatedExecution(),
          tasks: [{
            id: "slow-tree",
            contract: "slow-tree.json",
            command: [process.execPath, "-e", script],
          }],
        }),
      );
      commitFixture(dir, "timeout tree fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "timeout-tree.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--timeout-ms", "250",
        "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      const pids = JSON.parse(await readFile(readyPath, "utf8")) as { parent: number; child: number };
      assert.equal(processIsAlive(pids.parent), false);
      assert.equal(processIsAlive(pids.child), false);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.taskRuns[0].termination.reason, "timeout");
      assert.equal(receipt.isolation.finalPromotion, "no-changes");
      assert.equal(receipt.isolation.cleanup.status, "ok");
      const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.doesNotMatch(worktrees.stdout, /scopelock-isolate-/);
    } finally {
      await rm(readyPath, { force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not apply the per-task timeout to isolation setup", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "short-timeout.json"), "short-timeout", ["result.txt"]);
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "short-task-timeout",
          execution: isolatedExecution(),
          tasks: [{
            id: "short-timeout",
            contract: "short-timeout.json",
            command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
          }],
        }),
      );
      commitFixture(dir, "short timeout fixture");
      const receiptPath = join(dir, ".scopelock", "reports", "short-timeout.json");

      const result = runCli(dir, [
        "--json", "run", "--yes", "--isolate", "--timeout-ms", "10",
        "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift",
      ]);

      assert.equal(result.status, 1, result.stdout || result.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.taskRuns[0].termination.reason, "timeout");
      assert.equal(receipt.isolation.cleanup.status, "ok");
      const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.doesNotMatch(worktrees.stdout, /scopelock-isolate-/);
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
        "--yes",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--store-raw-output",
        "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      const task = receipt.taskRuns[0];
      assert.equal(receipt.schemaVersion, 6);
      assert.equal(task.stdout.length, 400);
      assert.equal(task.outputArtifacts.stdout.bytes, 3000);
      assert.equal(task.outputArtifacts.stdout.truncated, true);
      assert.equal(await readFile(task.outputArtifacts.stdout.path, "utf8"), "x".repeat(3000));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("redacts secrets and does not store raw output by default", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "secret.json"), "secret", ["out.txt"]);
      const fakeSecret = `sk-${"a".repeat(24)}`;
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "redaction-demo",
          tasks: [{
            id: "secret",
            contract: "secret.json",
            command: [process.execPath, "-e", `process.stdout.write('${fakeSecret}')`],
          }],
        }),
      );
      const receiptPath = join(dir, "receipt.json");
      const res = runCli(dir, ["--json", "run", "--yes", "--plan", "plan.json", "--receipt", receiptPath, "--no-check-drift"]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      const raw = await readFile(receiptPath, "utf8");
      assert.doesNotMatch(raw, new RegExp(fakeSecret));
      const receipt = JSON.parse(raw);
      assert.match(receipt.taskRuns[0].stdout, /REDACTED/);
      assert.deepEqual(receipt.taskRuns[0].outputArtifacts, {});
      assert.equal(receipt.limits.rawOutputStorage, "disabled");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("redacts secrets in the persisted command, stdout, and stderr raw artifacts under --store-raw-output", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "secret2.json"), "secret2", ["out.txt"]);
      // Built from parts at test-authoring time (not a literal realistic
      // token) so this fixture doesn't itself trip secret-scanning on push,
      // the same lesson learned from redaction.test.ts fixtures.
      const fakeSecret = ["sk-", "y".repeat(24)].join("");
      const commandPadding = `/* ${"x".repeat(500)} */`;
      await writeFile(
        join(dir, "plan.json"),
        JSON.stringify({
          schemaVersion: 1,
          planId: "raw-redaction-demo",
          tasks: [{
            id: "secret2",
            contract: "secret2.json",
            command: [
              process.execPath,
              "-e",
              `process.stdout.write('${fakeSecret}'); process.stderr.write('${fakeSecret}');${commandPadding}`,
            ],
          }],
        }),
      );
      const receiptPath = join(dir, "receipt.json");
      const res = runCli(dir, [
        "--json", "run", "--yes", "--plan", "plan.json",
        "--receipt", receiptPath, "--store-raw-output", "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      const rawReceipt = await readFile(receiptPath, "utf8");
      assert.doesNotMatch(rawReceipt, new RegExp(fakeSecret));
      const receipt = JSON.parse(rawReceipt);
      const task = receipt.taskRuns[0];

      // Preview in the receipt itself (the persisted command representation).
      assert.match(JSON.stringify(task.command), /\[REDACTED\]/);
      assert.doesNotMatch(JSON.stringify(task.command), new RegExp(fakeSecret));

      // A command larger than the receipt preview limit gets its own artifact.
      // Verify that path independently instead of only checking the preview.
      assert.ok(task.outputArtifacts.command, "expected a stored command artifact");
      const storedCommand = await readFile(task.outputArtifacts.command.path, "utf8");
      assert.doesNotMatch(storedCommand, new RegExp(fakeSecret));
      assert.match(storedCommand, /\[REDACTED\]/);

      // Preview in the receipt for stdout/stderr.
      assert.match(task.stdout, /\[REDACTED\]/);
      assert.match(task.stderr, /\[REDACTED\]/);

      // The raw --store-raw-output artifact files on disk must also be
      // redacted, not just the bounded receipt preview - this is the gap
      // the original finding was about.
      assert.ok(task.outputArtifacts.stdout, "expected a stored stdout artifact");
      assert.ok(task.outputArtifacts.stderr, "expected a stored stderr artifact");
      const storedStdout = await readFile(task.outputArtifacts.stdout.path, "utf8");
      const storedStderr = await readFile(task.outputArtifacts.stderr.path, "utf8");
      assert.doesNotMatch(storedStdout, new RegExp(fakeSecret));
      assert.doesNotMatch(storedStderr, new RegExp(fakeSecret));
      assert.match(storedStdout, /\[REDACTED\]/);
      assert.match(storedStderr, /\[REDACTED\]/);
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
        "--yes",
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
        "--yes",
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
        [CLI, "--json", "run", "--yes", "--plan", "plan.json", "--no-check-drift"],
        { cwd: dir, encoding: "utf8", input: "", timeout: 2_000 },
      );

      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      assert.equal(await readFile(join(dir, "stdin-eof.txt"), "utf8"), "ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs write-write conflicts in separate scheduler stages", async (t) => {
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
        "--yes",
        "--plan",
        "plan.json",
        "--receipt",
        receiptPath,
        "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.deepEqual(body.data.receipt.waves, [["a"], ["b"]]);
      assert.deepEqual(body.data.receipt.deferredTasks, []);
      assert.equal(await readFile(join(dir, "shared.txt"), "utf8"), "b");
      assert.ok(body.data.receipt.taskRuns.every(
        (task: { status: string }) => task.status === "passed",
      ));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders a standalone escaped HTML report from a receipt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-report-"));
    try {
      const receiptPath = join(dir, "receipt.json");
      const reportPath = join(dir, "report.html");
      await writeFile(
        receiptPath,
        JSON.stringify({
          schemaVersion: 4,
          planId: "x<script>alert(1)</script>",
          startedAt: "2026-07-12T00:00:00.000Z",
          finishedAt: "2026-07-12T00:00:01.000Z",
          waves: [["a"]],
          conflicts: [],
          deferredTasks: [],
          environment: { status: "pass", mode: "strict", violationsCount: 0 },
          handoffSummary: {
            passedTasks: ["a"],
            failedTasks: [],
            skippedTasks: [],
            driftStatus: "ok",
            environmentStatus: "pass",
          },
          taskRuns: [{ id: "a", status: "passed", durationMs: 12, stderr: "" }],
          drift: { status: "ok" },
        }),
      );

      const res = runCli(dir, ["--json", "report", receiptPath, "--out", reportPath]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      const body = JSON.parse(res.stdout);
      assert.equal(body.status, "ok");
      assert.equal(body.data.reportPath, reportPath);
      const html = await readFile(reportPath, "utf8");
      assert.match(html, /ScopeLock Flight Report/);
      assert.match(html, /x&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.doesNotMatch(html, /<script>alert/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders receipt v6 evidence and ordered validation checks without using the legacy singular field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-report-v6-"));
    try {
      const receiptPath = join(dir, "receipt.json");
      const reportPath = join(dir, "report.html");
      await writeFile(receiptPath, JSON.stringify({
        schemaVersion: 6,
        planId: "v6-report",
        startedAt: "2026-07-20T00:00:00.000Z",
        finishedAt: "2026-07-20T00:00:01.000Z",
        waves: [["a"]],
        conflicts: [],
        deferredTasks: [],
        handoffSummary: { passedTasks: ["a"], failedTasks: [], skippedTasks: [], blockedTasks: [] },
        taskRuns: [{ id: "a", status: "passed", durationMs: 12, stderr: "" }],
        drift: { status: "ok" },
        evidenceSummary: {
          execution: "completed",
          scope: "clear",
          validation: "passed",
          acceptance: "verified",
          promotion: "applied",
          cleanup: "ok",
        },
        isolation: {
          mode: "worktree",
          trustTier: "workspace-gated",
          validation: { status: "failed" },
          validationChecks: [{
            id: "test<script>",
            status: "passed",
            required: true,
            cwd: "app",
            durationMs: 14,
          }],
          validationWorkspaceClean: true,
          finalPromotion: "applied",
          cleanup: { status: "ok", remaining: [] },
        },
      }));

      const result = runCli(dir, ["--json", "report", receiptPath, "--out", reportPath]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const html = await readFile(reportPath, "utf8");
      assert.match(html, /Configured gates cleared/);
      assert.match(html, /<th>Execution<div class="rowdesc">↳ did every task run finish<\/div><\/th><td class="good">completed<\/td>/);
      assert.match(html, /<th>Acceptance<div class="rowdesc">↳ the checks you declared as required evidence<\/div><\/th><td class="good">verified<\/td>/);
      assert.doesNotMatch(html, /class="runmode"/);
      assert.match(html, /Validation left the candidate unchanged/);
      assert.doesNotMatch(html, /Candidate unchanged by validation/);
      assert.match(html, /test&lt;script&gt;/);
      assert.match(html, /<td>required<\/td><td>app<\/td>/);
      assert.equal(html.includes("<script>"), false);
      assert.doesNotMatch(html, /Repository validation<\/th><td class="bad">failed/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders not-exercised evidence as muted with glosses, a run-mode summary, a stepper, and a legend", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-report-muted-"));
    try {
      const receiptPath = join(dir, "receipt.json");
      const reportPath = join(dir, "report.html");
      await writeFile(receiptPath, JSON.stringify({
        schemaVersion: 6,
        planId: "direct-report",
        startedAt: "2026-07-21T00:00:00.000Z",
        finishedAt: "2026-07-21T00:00:01.000Z",
        waves: [["a"]],
        conflicts: [],
        deferredTasks: [],
        handoffSummary: { passedTasks: ["a"], failedTasks: [], skippedTasks: [], blockedTasks: [], driftStatus: "not_checked" },
        taskRuns: [{ id: "a", status: "passed", durationMs: 12, stderr: "" }],
        evidenceSummary: {
          execution: "completed",
          scope: "not-checked",
          validation: "not-run",
          acceptance: "unverified",
          promotion: "not-applicable",
          cleanup: "not-applicable",
        },
      }));

      const result = runCli(dir, ["--json", "report", receiptPath, "--out", reportPath]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const html = await readFile(reportPath, "utf8");
      // Not-exercised statuses are muted, never amber.
      assert.doesNotMatch(html, /<td class="warn">(not-run|not-checked|unverified|not-applicable)/);
      assert.match(html, /<td class="muted">not-run <span class="gloss">- no validation checks configured for this run<\/span><\/td>/);
      assert.match(html, /<td class="muted">unverified <span class="gloss">- no acceptance checks were declared<\/span><\/td>/);
      // Run-mode summary names why the muted steps did not run.
      assert.match(html, /class="runmode"/);
      assert.match(html, /do not apply/);
      assert.match(html, /--no-check-drift/);
      // Six-node stepper and colors-only legend.
      assert.equal((html.match(/data-node=/g) ?? []).length, 6);
      assert.match(html, /class="stepper"/);
      assert.match(html, /<h2>Legend<\/h2>/);
      assert.match(html, /not a warning/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("renders escaped drift evidence without fabricating run fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-drift-report-"));
    try {
      const driftPath = join(dir, "drift.json");
      const reportPath = join(dir, "drift.html");
      await writeFile(driftPath, JSON.stringify({
        schemaVersion: 1,
        contractId: "task<script>alert(1)</script>",
        checkedAt: "2026-07-14T00:00:00.000Z",
        repoMode: "normal",
        repoState: { kind: "clean" },
        changedFiles: [{
          path: "src/<unsafe>.ts",
          previousPath: null,
          status: "modified",
          stage: "unstaged",
          isBinary: false,
          insertions: 0,
          deletions: 0,
          sizeBytes: 0,
        }],
        violations: [{
          type: "outside_scope",
          path: "src/<unsafe>.ts",
          message: "unexpected <change>",
        }],
      }));

      const result = runCli(dir, ["--json", "report", driftPath, "--out", reportPath]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).data.sourceType, "drift");
      const html = await readFile(reportPath, "utf8");
      assert.match(html, /ScopeLock Drift Report/);
      assert.match(html, /task&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.match(html, /src\/&lt;unsafe&gt;\.ts/);
      assert.doesNotMatch(html, /Execution Sequence|Passed tasks|<script>alert/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("shows every checked contract id in the drift HTML heading when contractIds is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-drift-multi-report-"));
    try {
      const driftPath = join(dir, "drift.json");
      const reportPath = join(dir, "drift.html");
      await writeFile(driftPath, JSON.stringify({
        schemaVersion: 1,
        contractId: "writer",
        contractIds: ["writer", "reader"],
        checkedAt: "2026-07-21T00:00:00.000Z",
        repoMode: "normal",
        repoState: { kind: "clean" },
        changedFiles: [],
        violations: [],
      }));

      const result = runCli(dir, ["--json", "report", driftPath, "--out", reportPath]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const html = await readFile(reportPath, "utf8");
      assert.match(html, /writer, reader/);
      assert.doesNotMatch(html, /<title>ScopeLock Drift Report - writer<\/title>/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("check-drift", () => {
  // Write drafts outside the repo (see the `check-drift` respects the
  // exit-code contract test above) so the draft file itself does not count
  // as drift once approved.
  async function writeContract(
    dir: string,
    file: string,
    id: string,
    planned: string[],
    forbidden: string[] = [],
  ): Promise<void> {
    const res = runCli(dir, [
      "contract", "new", "--task", id, "--id", id,
      ...planned.flatMap((glob) => ["--planned", glob]),
      ...forbidden.flatMap((glob) => ["--forbidden", glob]),
      "--out", file,
    ]);
    assert.equal(res.status, 0, res.stderr);
    const approved = runCli(dir, ["approve", file]);
    assert.equal(approved.status, 0, approved.stdout || approved.stderr);
  }

  it("classifies a file as planned when any contract claims it, even if another forbids it", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(tmpdir(), `sl-check-drift-a-${Date.now()}.json`), "a", ["a/**"]);
      await writeContract(dir, join(tmpdir(), `sl-check-drift-b-${Date.now()}.json`), "b", ["b/**"], ["a/**"]);
      await mkdir(join(dir, "a"), { recursive: true });
      await writeFile(join(dir, "a", "file.ts"), "content");
      const result = await checkDriftCommand({ contractIds: ["a", "b"] }, dir);
      assert.equal(result.exitCode, 0, result.human ?? "");
      const report = (result.data as { report: { violations: unknown[] } }).report;
      assert.deepEqual(report.violations, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws CONTRACT_BASELINE_MISMATCH when contracts do not share a baseline", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(tmpdir(), `sl-check-drift-a-${Date.now()}.json`), "a", ["a/**"]);
      commitFixture(dir, "advance baseline before approving b");
      await writeContract(dir, join(tmpdir(), `sl-check-drift-b-${Date.now()}.json`), "b", ["b/**"]);
      await assert.rejects(
        checkDriftCommand({ contractIds: ["a", "b"] }, dir),
        (error: unknown) =>
          error instanceof CliError
          && error.code === "CONTRACT_BASELINE_MISMATCH"
          && /rebaseline/.test(error.message)
          && error.message.includes("a:")
          && error.message.includes("b:"),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the single active contract when contractIds is omitted", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(tmpdir(), `sl-check-drift-a-${Date.now()}.json`), "a", ["a/**"]);
      const result = await checkDriftCommand({}, dir);
      assert.equal(result.exitCode, 0, result.human ?? "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
