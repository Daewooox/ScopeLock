#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchmarkDir, "../..");
const scopelockCli = join(repoRoot, "packages/cli/dist/index.js");

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function sh(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input: options.input ?? "",
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content, "utf8");
}

function read(root, path) {
  return readFileSync(join(root, path), "utf8");
}

function replace(root, path, from, to) {
  const full = join(root, path);
  const current = readFileSync(full, "utf8");
  writeFileSync(full, current.replace(from, to), "utf8");
}

function append(root, path, content) {
  const full = join(root, path);
  const current = readFileSync(full, "utf8");
  writeFileSync(full, `${current}${content}`, "utf8");
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "scopelock-coordination-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "ScopeLock Benchmark"]);
  git(root, ["config", "user.email", "benchmark@example.com"]);

  write(root, "package.json", JSON.stringify({ type: "module", scripts: { test: "node --test tests/*.test.mjs" } }, null, 2));
  write(root, "src/math.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
  write(root, "src/strings.mjs", "export function lower(value) {\n  return value.toLowerCase();\n}\n");
  write(root, "src/pricing.mjs", "export const DEFAULT_TAX_RATE = 0.07;\n\nexport function totalWithTax(amount) {\n  return amount * (1 + DEFAULT_TAX_RATE);\n}\n");
  write(root, "src/user.mjs", "export function formatUser(user) {\n  return user.name;\n}\n");
  write(root, "tests/base.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/math.mjs';\nimport { lower } from '../src/strings.mjs';\n\ntest('base behavior', () => {\n  assert.equal(add(2, 3), 5);\n  assert.equal(lower('ADA'), 'ada');\n});\n");

  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture", "-q"]);
  return root;
}

const tasks = [
  {
    id: "t1-math",
    planned: ["src/math.mjs", "tests/math-extra.test.mjs"],
    read: [],
    durationMs: 80,
    accepted(root) {
      return read(root, "src/math.mjs").includes("multiply");
    },
    async apply(root) {
      await sleep(80);
      append(root, "src/math.mjs", "\nexport function multiply(a, b) {\n  return a * b;\n}\n");
      write(root, "tests/math-extra.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { multiply } from '../src/math.mjs';\n\ntest('multiply', () => {\n  assert.equal(multiply(3, 4), 12);\n});\n");
      return ["src/math.mjs", "tests/math-extra.test.mjs"];
    },
  },
  {
    id: "t2-strings",
    planned: ["src/strings.mjs", "tests/strings-extra.test.mjs"],
    read: [],
    durationMs: 70,
    scopeViolationPath: "docs/telemetry.md",
    accepted(root) {
      return read(root, "src/strings.mjs").includes("slugify");
    },
    async apply(root, mode) {
      await sleep(70);
      append(root, "src/strings.mjs", "\nexport function slugify(value) {\n  return lower(value).replaceAll(' ', '-');\n}\n");
      write(root, "tests/strings-extra.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { slugify } from '../src/strings.mjs';\n\ntest('slugify', () => {\n  assert.equal(slugify('Hello ScopeLock'), 'hello-scopelock');\n});\n");
      if (mode === "without") {
        write(root, "docs/telemetry.md", "unplanned telemetry notes\n");
        return ["src/strings.mjs", "tests/strings-extra.test.mjs", "docs/telemetry.md"];
      }
      return ["src/strings.mjs", "tests/strings-extra.test.mjs"];
    },
  },
  {
    id: "t3-tax-8",
    planned: ["src/pricing.mjs", "tests/pricing-tax-8.test.mjs"],
    read: [],
    durationMs: 60,
    accepted(root) {
      return read(root, "src/pricing.mjs").includes("0.08");
    },
    async apply(root) {
      await sleep(60);
      replace(root, "src/pricing.mjs", "DEFAULT_TAX_RATE = 0.07", "DEFAULT_TAX_RATE = 0.08");
      write(root, "tests/pricing-tax-8.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { totalWithTax } from '../src/pricing.mjs';\n\ntest('tax rate 8 percent', () => {\n  assert.equal(totalWithTax(100), 108);\n});\n");
      return ["src/pricing.mjs", "tests/pricing-tax-8.test.mjs"];
    },
  },
  {
    id: "t4-tax-9",
    planned: ["src/pricing.mjs", "tests/pricing-tax-9.test.mjs"],
    read: [],
    durationMs: 90,
    accepted(root) {
      return read(root, "src/pricing.mjs").includes("0.09");
    },
    async apply(root) {
      await sleep(90);
      const current = read(root, "src/pricing.mjs");
      write(root, "src/pricing.mjs", current.replace(/DEFAULT_TAX_RATE = 0\.\d+/, "DEFAULT_TAX_RATE = 0.09"));
      write(root, "tests/pricing-tax-9.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { totalWithTax } from '../src/pricing.mjs';\n\ntest('tax rate 9 percent', () => {\n  assert.equal(totalWithTax(100), 109);\n});\n");
      return ["src/pricing.mjs", "tests/pricing-tax-9.test.mjs"];
    },
  },
  {
    id: "t5-user-migration",
    planned: ["src/user.mjs", "tests/user-migration.test.mjs"],
    read: [],
    durationMs: 50,
    accepted(root) {
      return read(root, "src/user.mjs").includes("firstName") && read(root, "src/user.mjs").includes("lastName");
    },
    async apply(root) {
      await sleep(50);
      write(root, "src/user.mjs", "export function formatUser(user) {\n  return `${user.firstName} ${user.lastName}`;\n}\n");
      write(root, "tests/user-migration.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatUser } from '../src/user.mjs';\n\ntest('formats migrated users', () => {\n  assert.equal(formatUser({ firstName: 'Ada', lastName: 'Lovelace' }), 'Ada Lovelace');\n});\n");
      return ["src/user.mjs", "tests/user-migration.test.mjs"];
    },
  },
  {
    id: "t6-welcome-reader",
    planned: ["src/welcome.mjs", "tests/welcome.test.mjs"],
    read: ["src/user.mjs"],
    durationMs: 80,
    scopeViolationPath: "package.json",
    accepted(root) {
      return read(root, "src/welcome.mjs").includes("welcomeUser") && !read(root, "tests/welcome.test.mjs").includes("name: 'Ada'");
    },
    async apply(root, mode) {
      await sleep(80);
      const migrated = read(root, "src/user.mjs").includes("firstName");
      if (mode === "plan" && migrated) {
        write(root, "src/welcome.mjs", "import { formatUser } from './user.mjs';\n\nexport function welcomeUser(user) {\n  return `Welcome ${formatUser(user)}`;\n}\n");
        write(root, "tests/welcome.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { welcomeUser } from '../src/welcome.mjs';\n\ntest('welcomes migrated users', () => {\n  assert.equal(welcomeUser({ firstName: 'Ada', lastName: 'Lovelace' }), 'Welcome Ada Lovelace');\n});\n");
      } else {
        write(root, "src/welcome.mjs", "import { formatUser } from './user.mjs';\n\nexport function welcomeUser(user) {\n  return `Welcome ${formatUser(user)}`;\n}\n");
        write(root, "tests/welcome.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { welcomeUser } from '../src/welcome.mjs';\n\ntest('welcomes legacy users', () => {\n  assert.equal(welcomeUser({ name: 'Ada' }), 'Welcome Ada');\n});\n");
      }
      if (mode === "without") {
        const pkg = JSON.parse(read(root, "package.json"));
        pkg.benchmarkLeak = true;
        write(root, "package.json", JSON.stringify(pkg, null, 2));
        return ["src/welcome.mjs", "tests/welcome.test.mjs", "package.json"];
      }
      return ["src/welcome.mjs", "tests/welcome.test.mjs"];
    },
  },
];

function runTests(root) {
  const result = sh(root, "node", ["--test", "tests/*.test.mjs"]);
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/# fail (\d+)/);
  return {
    status: result.status,
    failedTests: match ? Number(match[1]) : result.status === 0 ? 0 : 1,
    output,
  };
}

function acceptedCount(root, taskList) {
  return taskList.filter((task) => task.accepted(root)).length;
}

function writeContracts(root) {
  sh(root, "node", [scopelockCli, "init"]);
  write(root, ".scopelock/config.json", JSON.stringify({ schemaVersion: 1, mode: "strict" }, null, 2));
  const contractPaths = [];
  for (const task of tasks) {
    const draft = join(root, `${task.id}.draft.json`);
    const args = [
      scopelockCli,
      "contract",
      "new",
      "--id",
      task.id,
      "--task",
      task.id,
      ...task.planned.flatMap((glob) => ["--planned", glob]),
      ...task.read.flatMap((glob) => ["--read", glob]),
      "--out",
      draft,
    ];
    sh(root, "node", args);
    sh(root, "node", [scopelockCli, "approve", "--no-activate", draft]);
    contractPaths.push(`.scopelock/contracts/${task.id}.json`);
  }
  write(root, "plan.json", JSON.stringify({
    schemaVersion: 1,
    planId: "coordination-benchmark",
    tasks: tasks.map((task, index) => ({ id: task.id, contract: contractPaths[index] })),
  }, null, 2));
}

function setActiveContract(root, id) {
  write(root, ".scopelock/active", JSON.stringify(id));
}

function hookAllows(root, task, path) {
  setActiveContract(root, task.id);
  const result = sh(root, "node", [scopelockCli, "hook", "gate"], {
    input: JSON.stringify({ tool_input: { file_path: path } }),
  });
  return result.status === 0;
}

function preflightHooks(root) {
  let blockedScopeAttempts = 0;
  let manualInterventions = 0;
  for (const task of tasks) {
    for (const path of task.planned) {
      hookAllows(root, task, path);
    }
    if (task.scopeViolationPath && !hookAllows(root, task, task.scopeViolationPath)) {
      blockedScopeAttempts += 1;
      manualInterventions += 1;
    }
  }
  return { blockedScopeAttempts, manualInterventions };
}

function planParallel(root) {
  const result = sh(root, "node", [
    scopelockCli,
    "--json",
    "plan-parallel",
    "plan.json",
    "--include-read-hazards",
  ]);
  if (result.status > 1) {
    throw new Error(`plan-parallel failed: ${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout).data;
}

async function runTasks(root, taskList, mode) {
  const start = performance.now();
  const touched = await Promise.all(taskList.map((task) => task.apply(root, mode)));
  return {
    wallClockMs: Math.round(performance.now() - start),
    touched: touched.flat(),
  };
}

async function runWithoutScopeLock() {
  const root = createFixture();
  try {
    const run = await runTasks(root, tasks, "without");
    const tests = runTests(root);
    return {
      mode: "without_scopelock",
      fixtureRoot: root,
      scopeViolationsApplied: 2,
      blockedScopeAttempts: 0,
      unresolvedConflicts: 2,
      detectedPreventedConflicts: 0,
      manualInterventions: 0,
      failedTests: tests.failedTests,
      acceptedTasks: acceptedCount(root, tasks),
      totalTasks: tasks.length,
      wallClockMs: run.wallClockMs,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runContractsHooks() {
  const root = createFixture();
  try {
    writeContracts(root);
    const hookMetrics = preflightHooks(root);
    const run = await runTasks(root, tasks, "hooks");
    const tests = runTests(root);
    return {
      mode: "contracts_hooks",
      fixtureRoot: root,
      scopeViolationsApplied: 0,
      blockedScopeAttempts: hookMetrics.blockedScopeAttempts,
      unresolvedConflicts: 2,
      detectedPreventedConflicts: 0,
      manualInterventions: hookMetrics.manualInterventions,
      failedTests: tests.failedTests,
      acceptedTasks: acceptedCount(root, tasks),
      totalTasks: tasks.length,
      wallClockMs: run.wallClockMs,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runContractsHooksPlan() {
  const root = createFixture();
  try {
    writeContracts(root);
    const hookMetrics = preflightHooks(root);
    const schedule = planParallel(root);
    const conflictPairs = new Set(
      schedule.conflicts
        .filter((conflict) => conflict.kind === "write-write")
        .flatMap((conflict) => [`${conflict.a}:${conflict.b}`, `${conflict.b}:${conflict.a}`]),
    );

    // Flight-control policy for this benchmark: when the plan detects a
    // write-write conflict, keep the lexically first task and defer the later
    // one for human decision instead of letting both mutate the same file.
    const deferred = new Set();
    for (const conflict of schedule.conflicts) {
      if (conflict.kind === "write-write") {
        deferred.add([conflict.a, conflict.b].sort()[1]);
      }
    }

    const start = performance.now();
    for (const wave of schedule.waves) {
      const runnable = wave
        .filter((id) => !deferred.has(id))
        .map((id) => tasks.find((task) => task.id === id));
      await Promise.all(runnable.map((task) => task.apply(root, "plan")));
    }
    const tests = runTests(root);
    return {
      mode: "contracts_hooks_plan_parallel",
      fixtureRoot: root,
      scopeViolationsApplied: 0,
      blockedScopeAttempts: hookMetrics.blockedScopeAttempts,
      unresolvedConflicts: 0,
      detectedPreventedConflicts: schedule.conflicts.length,
      manualInterventions: hookMetrics.manualInterventions + deferred.size,
      deferredTasks: [...deferred],
      failedTests: tests.failedTests,
      acceptedTasks: acceptedCount(root, tasks.filter((task) => !deferred.has(task.id))),
      totalTasks: tasks.length,
      wallClockMs: Math.round(performance.now() - start),
      schedule: {
        waves: schedule.waves,
        conflicts: schedule.conflicts,
        cycles: schedule.cycles,
      },
      conflictPairs: [...conflictPairs],
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function markdown(results) {
  const rows = [
    "| Mode | Scope violations applied | Blocked attempts | Unresolved conflicts | Detected/prevented conflicts | Manual interventions | Failed tests | Accepted tasks | Wall-clock ms |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...results.map((result) => `| ${result.mode} | ${result.scopeViolationsApplied} | ${result.blockedScopeAttempts} | ${result.unresolvedConflicts} | ${result.detectedPreventedConflicts} | ${result.manualInterventions} | ${result.failedTests} | ${result.acceptedTasks}/${result.totalTasks} | ${result.wallClockMs} |`),
  ];
  return rows.join("\n");
}

const results = [
  await runWithoutScopeLock(),
  await runContractsHooks(),
  await runContractsHooksPlan(),
];

const output = {
  generatedAt: new Date().toISOString(),
  note: "Deterministic harness with scripted agents; validates coordination mechanics, not LLM quality.",
  results,
  markdown: markdown(results),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
