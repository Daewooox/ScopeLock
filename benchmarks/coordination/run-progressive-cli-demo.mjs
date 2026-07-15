#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "../..");
const cli = join(repoRoot, "packages/cli/dist/index.js");

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content, "utf8");
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

function run(root, args, env) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(result.stdout || result.stderr || `scopelock ${args.join(" ")} failed`);
  }
  return JSON.parse(result.stdout);
}

function fakeCodexEnv() {
  const bin = mkdtempSync(join(tmpdir(), "scopelock-progressive-demo-bin-"));
  if (process.platform === "win32") {
    writeFileSync(join(bin, "codex.cmd"), "@echo off\r\nexit /b 0\r\n");
  } else {
    const executable = join(bin, "codex");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
  }
  return {
    bin,
    env: { ...process.env, PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}` },
  };
}

function startTask(root, env, { id, task, allow, context = [] }) {
  return run(root, [
    "--json", "task", "start", task,
    "--id", id,
    "--agent", "codex",
    ...allow.flatMap((path) => ["--allow", path]),
    ...context.flatMap((path) => ["--context", path]),
    "--test", "unit",
    "--yes",
  ], env);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "scopelock-progressive-demo-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "ScopeLock Demo"]);
  git(root, ["config", "user.email", "demo@scopelock.local"]);
  write(root, "package.json", `${JSON.stringify({
    private: true,
    scripts: { check: "node --test" },
  }, null, 2)}\n`);
  write(root, "src/greeting.js", "export const greeting = 'Hello';\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return root;
}

function runProgressiveDemo(argv) {
  const quiet = argv.includes("--quiet");
  const json = argv.includes("--json");
  const keepFixture = argv.includes("--keep-fixture");
  const outputDir = resolve(option(argv, "--output-dir", join(repoRoot, ".scopelock/reports/progressive-demo")));
  const root = createFixture();
  const harness = fakeCodexEnv();

  try {
    run(root, ["--json", "setup", "--target", "codex"], harness.env);
    startTask(root, harness.env, {
      id: "guided-greeting",
      task: "Update the greeting",
      allow: ["src/greeting.js", "tests/greeting.test.js"],
    });
    write(root, "src/greeting.js", "export const greeting = 'Hello, ScopeLock';\n");
    write(root, "tests/greeting.test.js", "// unit coverage for the greeting change\n");
    const finishResult = run(root, ["--json", "task", "finish"], harness.env);
    const finish = finishResult.data;

    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "guided task result"]);

    startTask(root, harness.env, {
      id: "config-writer",
      task: "Write feature configuration",
      allow: ["src/config.json"],
    });
    startTask(root, harness.env, {
      id: "summary-reader",
      task: "Summarize feature configuration",
      allow: ["src/summary.txt"],
      context: ["src/config.json"],
    });
    write(root, "plan.json", `${JSON.stringify({
      schemaVersion: 1,
      planId: "progressive-demo",
      tasks: [
        { id: "config-writer", contract: ".scopelock/contracts/config-writer.json" },
        { id: "summary-reader", contract: ".scopelock/contracts/summary-reader.json" },
      ],
    }, null, 2)}\n`);
    const prepared = run(root, [
      "--json", "plan", "prepare", "plan.json",
      "--target", "codex", "--out", "ready-plan.json",
    ], harness.env).data;

    mkdirSync(outputDir, { recursive: true });
    const artifacts = {
      guidedDrift: join(outputDir, "guided-drift.json"),
      guidedReport: join(outputDir, "guided-report.html"),
      inputPlan: join(outputDir, "plan.json"),
      readyPlan: join(outputDir, "ready-plan.json"),
    };
    copyFileSync(finish.reportPath, artifacts.guidedDrift);
    copyFileSync(finish.htmlPath, artifacts.guidedReport);
    copyFileSync(join(root, "plan.json"), artifacts.inputPlan);
    copyFileSync(join(root, "ready-plan.json"), artifacts.readyPlan);

    const summary = {
      generatedAt: new Date().toISOString(),
      fixture: keepFixture ? root : null,
      guided: {
        commands: ["scopelock setup", "scopelock task start", "scopelock task finish"],
        cleared: finishResult.status === "ok",
        allowedChanges: finish.summary.allowed,
        testsExecuted: false,
      },
      multiAgent: {
        stages: prepared.stages,
        readyPlanWritten: existsSync(join(root, "ready-plan.json")),
        agentExecuted: false,
      },
      artifacts,
    };
    writeFileSync(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

    if (json) {
      process.stdout.write(`${JSON.stringify({ outputDir, ...summary }, null, 2)}\n`);
    } else if (!quiet) {
      process.stdout.write([
        "ScopeLock Progressive CLI Demo",
        "Deterministic fixture; no model, API key, or agent execution.",
        "",
        "Guided single-agent flight",
        "  OK setup checked the repository and harness",
        "  OK task start approved one explicit file boundary",
        `  OK task finish cleared ${finish.summary.allowed} allowed changes`,
        "  ! tests were declared but not executed by task finish",
        "",
        "Standard multi-agent preparation",
        `  OK execution stages: ${prepared.stages.map((stage) => `[${stage.join(", ")}]`).join(" -> ")}`,
        "  OK ready plan written for review; no agent was started",
        "",
        `Artifacts: ${outputDir}`,
        ...(keepFixture
          ? [
              `Fixture: ${root}`,
              `Next: cd "${root}" && node "${cli}" run ready-plan.json --yes --isolate`,
            ]
          : ["Next: review ready-plan.json, or rerun with --keep-fixture to dispatch it"]),
      ].join("\n") + "\n");
    }
    return summary;
  } finally {
    rmSync(harness.bin, { recursive: true, force: true });
    if (!keepFixture) rmSync(root, { recursive: true, force: true });
  }
}

export { runProgressiveDemo };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runProgressiveDemo(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
