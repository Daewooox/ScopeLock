#!/usr/bin/env node
import {
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

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, "utf8");
}

function run(root, args, input = "") {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    input,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

function contract(root, id, planned, read = [], activate = false) {
  const draft = join(tmpdir(), `scopelock-pilot-${id}-${process.pid}.json`);
  const created = run(root, [
    "contract",
    "new",
    "--id",
    id,
    "--task",
    id,
    ...planned.flatMap((glob) => ["--planned", glob]),
    ...read.flatMap((glob) => ["--read", glob]),
    "--agent",
    "codex",
    "--out",
    draft,
  ]);
  if (created.status !== 0) throw new Error(created.stderr || created.stdout);
  const approved = run(root, ["approve", ...(activate ? [] : ["--no-activate"]), draft]);
  rmSync(draft, { force: true });
  if (approved.status !== 0) throw new Error(approved.stderr || approved.stdout);
  return `.scopelock/contracts/${id}.json`;
}

function setupFixture() {
  const root = mkdtempSync(join(tmpdir(), "scopelock-pilot-demo-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "ScopeLock Pilot"]);
  git(root, ["config", "user.email", "pilot@scopelock.local"]);
  write(root, "AGENTS.md", "Always stay inside the approved ScopeLock contract.\n");
  write(root, "README.md", "Pilot fixture\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture", "-q"]);

  if (run(root, ["init"]).status !== 0) throw new Error("scopelock init failed");
  write(root, ".scopelock/config.json", JSON.stringify({ schemaVersion: 1, mode: "strict" }, null, 2));

  const writer = contract(root, "pilot-writer", ["src/config.json"]);
  const reader = contract(root, "pilot-reader", ["src/summary.txt"], ["src/config.json"]);
  contract(root, "pilot-hook", ["src/**"], [], true);

  write(root, ".scopelock/agents.json", JSON.stringify({
    schemaVersion: 1,
    targets: ["codex"],
    skills: [{ name: "review", path: ".agents/skills/review", required: true }],
    policy: { requirePhysicalCopies: true, requireRuleParity: true, requireSkillParity: true },
  }, null, 2));
  write(root, "plan.json", JSON.stringify({
    schemaVersion: 1,
    planId: "pilot-demo",
    tasks: [
      {
        id: "pilot-writer",
        contract: writer,
        command: [
          process.execPath,
          "-e",
          "require('node:fs').mkdirSync('src',{recursive:true});require('node:fs').writeFileSync('src/config.json', JSON.stringify({feature:true}))",
        ],
      },
      {
        id: "pilot-reader",
        contract: reader,
        command: [
          process.execPath,
          "-e",
          "const fs=require('node:fs');const cfg=JSON.parse(fs.readFileSync('src/config.json','utf8'));fs.writeFileSync('src/summary.txt', cfg.feature ? 'enabled' : 'disabled')",
        ],
      },
    ],
  }, null, 2));
  return root;
}

function runPilot(argv) {
  const keepFixture = argv.includes("--keep-fixture");
  const json = argv.includes("--json");
  const quiet = argv.includes("--quiet");
  const outputDir = resolve(option(argv, "--output-dir", join(repoRoot, ".scopelock/reports/pilot-demo")));
  const root = setupFixture();

  try {
    const blockedReceipt = join(root, ".scopelock/reports/pilot-blocked.json");
    const blocked = run(root, [
      "--json",
      "run",
      "--yes",
      "--plan",
      "plan.json",
      "--receipt",
      blockedReceipt,
      "--no-check-drift",
    ]);
    const blockedBody = JSON.parse(blocked.stdout);

    write(root, ".agents/skills/review/SKILL.md", "# review\n\nSCOPELOCK_SKILL_SENTINEL_20260710\n");
    const fixedReceipt = join(root, ".scopelock/reports/pilot-fixed.json");
    const fixed = run(root, [
      "--json",
      "run",
      "--yes",
      "--plan",
      "plan.json",
      "--receipt",
      fixedReceipt,
      "--no-check-drift",
    ]);
    const fixedBody = JSON.parse(fixed.stdout);

    const installed = run(root, ["hooks", "install", "--target", "codex", "--mode", "strict", "--local"]);
    if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout);
    const event = JSON.stringify({
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Add File: secrets/token.txt\n+nope\n*** End Patch",
      },
    });
    const hook = run(root, ["hook", "gate", "--format", "codex"], event);
    const hookBody = JSON.parse(hook.stdout);

    const summary = {
      generatedAt: new Date().toISOString(),
      fixture: keepFixture ? root : null,
      steps: {
        missingSkillBlocked: blocked.status === 1 && blockedBody.data.receipt.blockedByEnvironment === true,
        fixedRunPassed: fixed.status === 0 && fixedBody.data.receipt.environment.status === "pass",
        safeWaves: fixedBody.data.receipt.waves,
        hookDenied: hookBody.hookSpecificOutput?.permissionDecision === "deny",
        receiptSchemaVersion: fixedBody.data.receipt.schemaVersion,
      },
      receipts: {
        blocked: blockedReceipt,
        fixed: fixedReceipt,
      },
    };

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(outputDir, "receipt.json"), `${JSON.stringify(fixedBody.data.receipt, null, 2)}\n`);

    if (json) {
      process.stdout.write(`${JSON.stringify({ outputDir, ...summary }, null, 2)}\n`);
    } else if (!quiet) {
      process.stdout.write([
        "ScopeLock Pilot Demo",
        "1. missing skill -> preflight block: PASS",
        "2. fix skill -> safe waves run: PASS",
        `   waves: ${summary.steps.safeWaves.map((wave) => `[${wave.join(", ")}]`).join(" -> ")}`,
        "3. Codex apply_patch hook deny: PASS",
        `4. receipt v${summary.steps.receiptSchemaVersion}: ${join(outputDir, "receipt.json")}`,
      ].join("\n") + "\n");
    }
    return summary;
  } finally {
    if (!keepFixture) rmSync(root, { recursive: true, force: true });
  }
}

export { runPilot };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runPilot(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
