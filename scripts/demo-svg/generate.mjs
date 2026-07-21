#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, writeFileSync as writeFile } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

import {
  forceTtyColor,
  recordingReporter,
  initFixtureRepo,
  cleanupFixtureRepo,
  fakeCodexOnPath,
  approveContract,
  cliBinPath,
} from "./capture.mjs";

forceTtyColor();

// Import the built CLI commands by resolved file path rather than the
// "@scopelock/cli" package specifier: the repo root package.json does not
// declare a dependency on the workspace package (only packages/cli's own
// package.json and other workspace packages do), so there is no
// node_modules/@scopelock/cli symlink for Node's ESM resolver to follow from
// this script. capture.mjs's cliBinPath already uses the same resolved-path
// approach for spawning the CLI as a subprocess; this mirrors it for
// in-process imports.
const cliDistDir = join(repoRoot, "packages/cli/dist/commands");
const { taskStartCommand } = await import(pathToFileURL(join(cliDistDir, "task-start.js")));
const { taskFinishCommand } = await import(pathToFileURL(join(cliDistDir, "task-finish.js")));
const { planPrepareCommand } = await import(pathToFileURL(join(cliDistDir, "plan-prepare.js")));

const { sanitizeHuman } = await import("./sanitize.mjs");
const { renderTerminalSvg } = await import("./render.mjs");

function stepLabels(events) {
  return events
    .filter((event) => event.type === "step" || event.type === "phase")
    .map((event) => (event.type === "step" ? event.label : event.name))
    .join(" -> ");
}

async function buildGuidedDemo() {
  const dir = initFixtureRepo();
  try {
    const env = fakeCodexOnPath(dir);
    // task start's baseline is the git HEAD sha at approval time
    // (packages/cli/src/commands/approve.ts), and drift is computed as
    // everything changed since that baseline. fakeCodexOnPath writes the
    // fake `codex` executable straight to disk without committing it, so
    // if it stays uncommitted it would show up as an "outside scope" drift
    // violation on `task finish` (it lives outside the --allow src scope),
    // which stops the human report from ever reaching "Cleared". Commit it
    // before task start runs so it is part of the baseline commit and is
    // never seen as drift.
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["commit", "-qm", "fixture: fake codex binary"], { cwd: dir });
    const previousPath = process.env.PATH;
    process.env.PATH = env.PATH;
    try {
      const startRecording = recordingReporter();
      const startResult = await taskStartCommand({
        description: "Add a dark mode toggle",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "demo-guided",
        yes: true,
        interactive: false,
        cwd: dir,
        reporter: startRecording.reporter,
      }, {
        setup: async () => ({
          data: { targets: [{ id: "codex", executable: join(dir, ".demo-fake-bin", "codex"), hook: { installed: false, capabilities: { confidence: "degraded" } } }] },
          human: "",
          exitCode: 0,
        }),
      });

      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "dark-mode.js"), "export const darkMode = true;\n");
      // The contract declares `--test unit`, so drift's missing-tests
      // heuristic (packages/core/src/rules/test-heuristics.ts) requires at
      // least one changed file to match a test-file pattern, or `task
      // finish` reports a real "missing_tests" violation and never reaches
      // "Cleared". Include a matching test file alongside the source edit,
      // both within the approved `src` scope.
      writeFileSync(
        join(dir, "src", "dark-mode.test.js"),
        "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { darkMode } from \"./dark-mode.js\";\n\ntest(\"dark mode is enabled\", () => {\n  assert.equal(darkMode, true);\n});\n",
      );

      const finishRecording = recordingReporter();
      const finishResult = await taskFinishCommand({ cwd: dir, reporter: finishRecording.reporter });

      return {
        title: "ScopeLock Guided terminal demo",
        description: "A real, regenerated terminal replay of task start and task finish.",
        promptPrefix: "$ scopelock",
        scenes: [
          {
            prompt: 'task start "Add a dark mode toggle" --agent codex --allow src --yes',
            pendingLabel: stepLabels(startRecording.events),
            human: sanitizeHuman(startResult.human ?? "", dir),
          },
          {
            prompt: "task finish",
            pendingLabel: stepLabels(finishRecording.events),
            human: sanitizeHuman(finishResult.human ?? "", dir),
          },
        ],
      };
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    cleanupFixtureRepo(dir);
  }
}

async function buildStandardDemo() {
  const dir = initFixtureRepo();
  try {
    const env = fakeCodexOnPath(dir);
    approveContract(dir, cliBinPath, env, "writer", ["src/writer.js"]);
    approveContract(dir, cliBinPath, env, "reader", ["src/reader.js"], ["src/writer.js"]);
    writeFileSync(join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      planId: "demo-standard",
      tasks: [
        { id: "writer", contract: ".scopelock/contracts/writer.json", expectsChanges: true },
        { id: "reader", contract: ".scopelock/contracts/reader.json", expectsChanges: true },
      ],
    }));

    const previousPath = process.env.PATH;
    const previousCwd = process.cwd();
    process.env.PATH = env.PATH;
    process.chdir(dir);
    try {
      const recording = recordingReporter();
      const result = await planPrepareCommand("plan.json", {
        target: "codex",
        out: "ready.json",
        validationCommand: [process.execPath, "-e", "process.exit(0)"],
        reporter: recording.reporter,
      });

      return {
        title: "ScopeLock Standard multi-agent plan demo",
        description: "A real, regenerated terminal replay preparing a conflict-aware two-stage plan.",
        promptPrefix: "$ scopelock",
        scenes: [
          {
            prompt: "plan prepare plan.json --target codex --out ready.json",
            pendingLabel: stepLabels(recording.events),
            human: sanitizeHuman(result.human ?? "", dir),
          },
        ],
      };
    } finally {
      process.chdir(previousCwd);
      process.env.PATH = previousPath;
    }
  } finally {
    cleanupFixtureRepo(dir);
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const guided = await buildGuidedDemo();
  const standard = await buildStandardDemo();

  const targets = [
    { path: join(repoRoot, "docs/assets/scopelock-demo.svg"), svg: renderTerminalSvg(guided) },
    { path: join(repoRoot, "docs/assets/scopelock-plan-demo.svg"), svg: renderTerminalSvg(standard) },
  ];

  if (!check) {
    for (const target of targets) writeFile(target.path, target.svg);
    return;
  }

  const stale = targets.filter((target) => {
    try {
      return readFileSync(target.path, "utf8") !== target.svg;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    console.error(`Stale demo SVG(s), run \`pnpm demo:svg\` to regenerate: ${stale.map((t) => t.path).join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
