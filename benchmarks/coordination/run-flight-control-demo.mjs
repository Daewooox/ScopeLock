#!/usr/bin/env node
import {
  cpSync,
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
import { execFileSync, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { analyzeReceipt } from "./analyze-receipt.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const benchmarkDir = dirname(scriptPath);
const repoRoot = resolve(benchmarkDir, "../..");
const scopelockCli = join(repoRoot, "packages/cli/dist/index.js");

const tasks = [
  { id: "t1-math", planned: ["src/math.mjs", "tests/math.test.mjs"], read: [], test: "tests/math.test.mjs" },
  { id: "t2-strings", planned: ["src/strings.mjs", "tests/strings.test.mjs"], read: [], test: "tests/strings.test.mjs" },
  { id: "t3-tax-8", planned: ["src/pricing.mjs", "tests/tax-8.test.mjs"], read: [], test: "tests/tax-8.test.mjs" },
  { id: "t4-tax-9", planned: ["src/pricing.mjs", "tests/tax-9.test.mjs"], read: [], test: "tests/tax-9.test.mjs" },
  { id: "t5-user-migration", planned: ["src/user.mjs", "tests/user.test.mjs"], read: [], test: "tests/user.test.mjs" },
  { id: "t6-welcome-reader", planned: ["src/welcome.mjs", "tests/welcome.test.mjs"], read: ["src/user.mjs"], test: "tests/welcome.test.mjs" },
];

function option(argv, name, fallback) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content, "utf8");
}

function sh(cwd, command, args) {
  const result = execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.trim();
}

function git(cwd, args) {
  return sh(cwd, "git", args);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "scopelock-flight-control-demo-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "ScopeLock Demo"]);
  git(root, ["config", "user.email", "demo@scopelock.local"]);
  write(root, "package.json", JSON.stringify({ type: "module" }, null, 2));
  write(root, "src/math.mjs", "export const add = (a, b) => a + b;\n");
  write(root, "src/strings.mjs", "export const lower = (value) => value.toLowerCase();\n");
  write(root, "src/pricing.mjs", "export const TAX_RATE = 0.07;\nexport const total = (value) => Math.round(value * (1 + TAX_RATE));\n");
  write(root, "src/user.mjs", "export const formatUser = (user) => user.name;\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture", "-q"]);
  return root;
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function runWorker(taskId, coordinated) {
  const root = process.cwd();
  if (taskId === "t1-math") {
    write(root, "src/math.mjs", "export const add = (a, b) => a + b;\nexport const multiply = (a, b) => a * b;\n");
    write(root, "tests/math.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { multiply } from '../src/math.mjs';\ntest('multiply', () => assert.equal(multiply(3, 4), 12));\n");
  } else if (taskId === "t2-strings") {
    write(root, "src/strings.mjs", "export const lower = (value) => value.toLowerCase();\nexport const slugify = (value) => lower(value).replaceAll(' ', '-');\n");
    write(root, "tests/strings.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { slugify } from '../src/strings.mjs';\ntest('slugify', () => assert.equal(slugify('Hello World'), 'hello-world'));\n");
    if (!coordinated) write(root, "docs/telemetry.md", "Unplanned telemetry note.\n");
  } else if (taskId === "t3-tax-8" || taskId === "t4-tax-9") {
    await sleep(taskId === "t3-tax-8" ? 20 : 40);
    const rate = taskId === "t3-tax-8" ? "0.08" : "0.09";
    const expected = taskId === "t3-tax-8" ? "108" : "109";
    const testName = taskId === "t3-tax-8" ? "tax-8" : "tax-9";
    write(root, "src/pricing.mjs", `export const TAX_RATE = ${rate};\nexport const total = (value) => Math.round(value * (1 + TAX_RATE));\n`);
    write(root, `tests/${testName}.test.mjs`, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/pricing.mjs';\ntest('${testName}', () => assert.equal(total(100), ${expected}));\n`);
  } else if (taskId === "t5-user-migration") {
    await sleep(20);
    write(root, "src/user.mjs", "export const formatUser = (user) => `${user.firstName} ${user.lastName}`;\n");
    write(root, "tests/user.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatUser } from '../src/user.mjs';\ntest('new user shape', () => assert.equal(formatUser({ firstName: 'Ada', lastName: 'Lovelace' }), 'Ada Lovelace'));\n");
  } else if (taskId === "t6-welcome-reader") {
    await sleep(40);
    write(root, "src/welcome.mjs", "import { formatUser } from './user.mjs';\nexport const welcomeUser = (user) => `Welcome ${formatUser(user)}`;\n");
    const input = coordinated ? "{ firstName: 'Ada', lastName: 'Lovelace' }" : "{ name: 'Ada' }";
    const expected = coordinated ? "Welcome Ada Lovelace" : "Welcome Ada";
    write(root, "tests/welcome.test.mjs", `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { welcomeUser } from '../src/welcome.mjs';\ntest('welcome', () => assert.equal(welcomeUser(${input}), '${expected}'));\n`);
    if (!coordinated) {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      write(root, "package.json", JSON.stringify({ ...pkg, benchmarkLeak: true }, null, 2));
    }
  } else {
    throw new Error(`unknown worker task: ${taskId}`);
  }
}

function runWorkerProcess(root, task, coordinated) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [scriptPath, "--worker", task.id, ...(coordinated ? ["--coordinated"] : [])], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${task.id} failed: ${stderr}`)));
  });
}

function testFile(root, path) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawn(process.execPath, ["--test", path], { cwd: root, env, stdio: "ignore" });
  return new Promise((resolveTest) => result.on("close", (code) => resolveTest(code === 0)));
}

async function metrics(root, mode, durationMs, receipt = null) {
  const taskResults = await Promise.all(tasks.map(async (task) => {
    const exists = existsSync(join(root, task.test));
    return { id: task.id, exists, accepted: exists && await testFile(root, task.test) };
  }));
  const changed = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd: root, encoding: "utf8" }).trimEnd()
    .split("\n").filter(Boolean).map((line) => line.slice(3));
  const planned = new Set(tasks.flatMap((task) => task.planned));
  const violations = changed.filter((path) => !path.startsWith(".scopelock/") && path !== "plan.json" && !planned.has(path));
  return {
    mode,
    durationMs: Math.round(durationMs),
    scopeViolations: violations.length,
    scopeViolationPaths: violations,
    unresolvedConflicts: mode === "without_scopelock" ? 2 : 0,
    preventedHazards: receipt?.conflicts.length ?? 0,
    failedTests: taskResults.filter((task) => task.exists && !task.accepted).length,
    acceptedTasks: taskResults.filter((task) => task.accepted).length,
    totalTasks: tasks.length,
    deferredTasks: receipt?.deferredTasks ?? [],
  };
}

function setupScopeLock(root) {
  sh(root, process.execPath, [scopelockCli, "init"]);
  const contractPaths = [];
  for (const task of tasks) {
    const draft = join(root, `${task.id}.draft.json`);
    sh(root, process.execPath, [
      scopelockCli, "contract", "new", "--id", task.id, "--task", task.id,
      ...task.planned.flatMap((path) => ["--planned", path]),
      ...task.read.flatMap((path) => ["--read", path]),
      "--agent", "codex", "--out", draft,
    ]);
    sh(root, process.execPath, [scopelockCli, "approve", "--no-activate", draft]);
    rmSync(draft);
    contractPaths.push(`.scopelock/contracts/${task.id}.json`);
  }
  write(root, "plan.json", JSON.stringify({
    schemaVersion: 1,
    planId: "flight-control-demo",
    tasks: tasks.map((task, index) => ({
      id: task.id,
      contract: contractPaths[index],
      command: [process.execPath, scriptPath, "--worker", task.id, "--coordinated"],
    })),
  }, null, 2));

  git(root, ["add", "."]);
  git(root, ["commit", "-m", "ScopeLock demo setup", "-q"]);
  const runDraft = join(tmpdir(), `scopelock-demo-run-${process.pid}.json`);
  sh(root, process.execPath, [
    scopelockCli, "contract", "new", "--id", "demo-run", "--task", "Run Flight Control demo",
    ...tasks.flatMap((task) => task.planned).flatMap((path) => ["--planned", path]),
    "--planned", ".scopelock/contracts/demo-run.json", "--agent", "codex", "--test", "unit", "--out", runDraft,
  ]);
  sh(root, process.execPath, [scopelockCli, "approve", runDraft]);
  rmSync(runDraft);
}

async function runDemo(argv) {
  const keepFixture = argv.includes("--keep-fixture");
  const json = argv.includes("--json");
  const quiet = argv.includes("--quiet");
  const outputDir = resolve(option(argv, "--output-dir", join(repoRoot, ".scopelock/reports/flight-control-demo")));
  const naiveRoot = createFixture();
  const controlledRoot = createFixture();
  try {
    let started = performance.now();
    await Promise.all(tasks.map((task) => runWorkerProcess(naiveRoot, task, false)));
    const without = await metrics(naiveRoot, "without_scopelock", performance.now() - started);

    setupScopeLock(controlledRoot);
    started = performance.now();
    let dispatcherOutput = "";
    try {
      dispatcherOutput = sh(controlledRoot, process.execPath, [
        scopelockCli, "--json", "run", "--yes", "--plan", "plan.json", "--receipt", ".scopelock/reports/demo-receipt.json",
      ]);
    } catch (error) {
      if (!error.stdout || error.status !== 1) throw error;
      dispatcherOutput = String(error.stdout).trim();
    }
    const receipt = JSON.parse(dispatcherOutput).data.receipt;
    const withScopeLock = await metrics(controlledRoot, "scopelock_flight_control", performance.now() - started, receipt);
    const receiptAnalysis = analyzeReceipt(receipt, "demo-receipt.json");
    const summary = {
      generatedAt: new Date().toISOString(),
      fixture: "deterministic simulated agents; no model or API used",
      withoutScopeLock: without,
      withScopeLock,
      receiptAnalysis,
      ...(keepFixture ? { fixtureRoots: { withoutScopeLock: naiveRoot, withScopeLock: controlledRoot } } : {}),
    };

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    cpSync(join(controlledRoot, ".scopelock/reports/demo-receipt.json"), join(outputDir, "receipt.json"));

    if (quiet) {
      // Library and smoke-test callers consume the returned summary.
    } else if (json) {
      process.stdout.write(`${JSON.stringify({ outputDir, ...summary }, null, 2)}\n`);
    } else {
      const rows = [without, withScopeLock];
      const value = (row, key) => String(row[key]).padStart(12);
      process.stdout.write([
        "ScopeLock Flight Control Demo",
        "Deterministic simulated agents; no model or API used.",
        "",
        "Metric                     Without    ScopeLock",
        `Scope violations      ${value(rows[0], "scopeViolations")} ${value(rows[1], "scopeViolations")}`,
        `Unresolved conflicts  ${value(rows[0], "unresolvedConflicts")} ${value(rows[1], "unresolvedConflicts")}`,
        `Prevented hazards     ${value(rows[0], "preventedHazards")} ${value(rows[1], "preventedHazards")}`,
        `Failed tests          ${value(rows[0], "failedTests")} ${value(rows[1], "failedTests")}`,
        `Accepted tasks        ${String(`${rows[0].acceptedTasks}/${rows[0].totalTasks}`).padStart(12)} ${String(`${rows[1].acceptedTasks}/${rows[1].totalTasks}`).padStart(12)}`,
        "",
        `Waves: ${receipt.waves.map((wave) => `[${wave.join(", ")}]`).join(" -> ")}`,
        `Deferred: ${receipt.deferredTasks.join(", ")}`,
        `Receipt: ${join(outputDir, "receipt.json")} (${receiptAnalysis.totalBytes} bytes)`,
      ].join("\n") + "\n");
    }
    return summary;
  } finally {
    if (!keepFixture) {
      rmSync(naiveRoot, { recursive: true, force: true });
      rmSync(controlledRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[2] === "--worker") {
  runWorker(process.argv[3], process.argv.includes("--coordinated")).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
} else if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDemo(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { runDemo };
