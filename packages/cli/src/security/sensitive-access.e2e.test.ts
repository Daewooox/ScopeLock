import { it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  SENSITIVE_ACCESS_ENGINE_VERSION,
  isSemgrepAvailable,
  runSensitiveAccessScan,
  SENSITIVE_ACCESS_RULE_PACK_SHA256,
} from "./sensitive-access.js";

const CLI = fileURLToPath(new URL("../index.js", import.meta.url));

type RunResult = { status: number; stdout: string; stderr: string };

function runCli(cwd: string, args: string[], env: NodeJS.ProcessEnv): RunResult {
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

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr ?? "git failed");
  return result.stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scopelock-sensitive-e2e-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.invalid"]);
  git(dir, ["config", "user.name", "ScopeLock test"]);
  git(dir, ["commit", "--allow-empty", "-qm", "init"]);
  return dir;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function writeHarness(dir: string): Promise<string> {
  const bin = join(dir, "harness-bin");
  await mkdir(bin, { recursive: true });

  const codexScript = join(bin, "fake-codex.cjs");
  await writeFile(codexScript, [
    "const { writeFileSync } = require('node:fs');",
    "const mode = process.env.SCOPELOCK_E2E_MODE;",
    "if (mode === 'safe') writeFileSync('src/main.py', \"value = 'candidate'\\n\");",
    "if (mode === 'denied') writeFileSync('src/main.py', \"from pathlib import Path\\nvalue = Path.home() / '.ssh' / 'id_ed25519'\\nvalue = value.read_text()\\n\");",
    "if (mode === 'blocked') writeFileSync('src/main.go', 'package main\\n\\nvar candidate = true\\n');",
  ].join("\n"));
  const codex = join(bin, "codex");
  await writeFile(codex, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(codexScript)}\n`);
  await chmod(codex, 0o755);

  const scopelock = join(bin, "scopelock");
  await writeFile(scopelock, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(CLI)} "$@"\n`);
  await chmod(scopelock, 0o755);
  return bin;
}

async function approveContract(dir: string): Promise<void> {
  const draft = join(dir, "contract.json");
  const contract = runCli(dir, [
    "contract", "new", "--task", "sensitive access e2e", "--id", "sensitive-e2e",
    "--planned", "src/**", "--out", draft,
  ], process.env);
  assert.equal(contract.status, 0, contract.stderr || contract.stdout);
  const approved = runCli(dir, ["contract", "approve", draft], process.env);
  assert.equal(approved.status, 0, approved.stderr || approved.stdout);
  await rm(draft, { force: true });
}

function semgrepPathForTest(): string | null {
  const configured = process.env.SCOPELOCK_SEMGREP;
  return configured !== undefined && isSemgrepAvailable(configured) ? configured : null;
}

function envFor(bin: string, semgrepPath: string, mode: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [bin, dirname(semgrepPath), process.env.PATH ?? ""].filter(Boolean).join(delimiter),
    SCOPELOCK_E2E_MODE: mode,
  };
}

async function commitSources(dir: string, files: Record<string, string>): Promise<string> {
  for (const [path, contents] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "baseline sources"]);
  return git(dir, ["rev-parse", "HEAD"]);
}

async function runScenario(
  semgrepPath: string,
  mode: "safe" | "denied" | "blocked",
): Promise<{ result: RunResult; receipt: any; baseline: string; dir: string }> {
  const dir = await makeRepo();
  await commitSources(dir, {
    "src/main.py": "value = 'baseline'\n",
    "src/main.go": "package main\n\nvar candidate = false\n",
  });
  await writeFile(join(dir, "plan.json"), JSON.stringify({
    schemaVersion: 1,
    planId: `sensitive-access-${mode}`,
    tasks: [{ id: "sensitive-e2e", contract: ".scopelock/contracts/sensitive-e2e.json" }],
  }));
  const bin = await writeHarness(dir);
  git(dir, ["add", "plan.json", "harness-bin"]);
  git(dir, ["commit", "-qm", "fixture harness"]);
  await approveContract(dir);
  git(dir, ["add", ".scopelock/contracts"]);
  git(dir, ["commit", "-qm", "approved fixture contract"]);
  const securityBase = git(dir, ["rev-parse", "HEAD"]);
  const env = envFor(bin, semgrepPath, mode);

  const prepared = runCli(dir, [
    "--json", "plan", "prepare", "plan.json", "--target", "codex",
    "--security-profile", "sensitive-local-files", "--out", "ready-plan.json",
  ], env);
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const ready = JSON.parse(await readFile(join(dir, "ready-plan.json"), "utf8"));
  const securityCheck = ready.execution.validation.checks.find(
    (check: { id: string }) => check.id === "security-sensitive-local-files",
  );
  assert.ok(securityCheck);
  assert.deepEqual(securityCheck.command.slice(0, 5), [
    "mindthediff", "security", "scan", "--profile", "sensitive-local-files",
  ]);
  assert.equal(securityCheck.command.at(-1), "json");
  assert.equal(securityCheck.command.includes(securityBase), true);
  assert.equal(securityCheck.command.includes("--engine-version"), true);
  assert.equal(securityCheck.command.includes(SENSITIVE_ACCESS_ENGINE_VERSION), true);
  assert.equal(securityCheck.command.includes("--rules-sha256"), true);
  assert.equal(securityCheck.command.includes(SENSITIVE_ACCESS_RULE_PACK_SHA256), true);
  git(dir, ["add", "ready-plan.json"]);
  git(dir, ["commit", "-qm", "reviewed ready plan"]);

  const result = runCli(dir, [
    "--json", "run", "--yes", "--isolate", "--plan", "ready-plan.json",
    "--receipt", "receipt.json", "--no-check-drift",
  ], env);
  const receipt = JSON.parse(await readFile(join(dir, "receipt.json"), "utf8"));
  return { result, receipt, baseline: securityBase, dir };
}

it("runs the security profile through plan prepare and fail-closed promotion", async (t) => {
  const semgrepPath = semgrepPathForTest();
  if (semgrepPath === null) {
    t.skip("real Semgrep unavailable; set SCOPELOCK_SEMGREP to run this E2E");
    return;
  }

  for (const mode of ["safe", "denied", "blocked"] as const) {
    const scenario = await runScenario(semgrepPath, mode);
    try {
      const { receipt, result } = scenario;
      const check = receipt.isolation.validationChecks.find(
        (candidate: { id: string }) => candidate.id === "security-sensitive-local-files",
      );
      assert.ok(check, `${mode}: security check missing from receipt`);
      assert.equal(check.required, true);
      assert.match(check.stdout, new RegExp(`\\"outcome\\"\\s*:\\s*\\"${mode === "safe" ? "passed" : mode}\\"`));
      assert.match(check.stdout, /"engine"\s*:\s*"semgrep"/u);
      if (mode === "blocked") {
        assert.match(check.stdout, /"engineVersion"\s*:\s*null/u);
        assert.match(check.stdout, /"rulePackSha256"\s*:\s*null/u);
      } else {
        assert.match(check.stdout, new RegExp(`\\"engineVersion\\"\\s*:\\s*\\"${SENSITIVE_ACCESS_ENGINE_VERSION}\\"`));
        assert.match(check.stdout, new RegExp(`\\"rulePackSha256\\"\\s*:\\s*\\"${SENSITIVE_ACCESS_RULE_PACK_SHA256}\\"`));
      }

      if (mode === "safe") {
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(receipt.isolation.finalPromotion, "applied");
        assert.equal(receipt.taskRuns[0].status, "passed");
        assert.equal(await readFile(join(scenario.dir, "src/main.py"), "utf8"), "value = 'candidate'\n");
      } else {
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.equal(check.status, "failed");
        assert.equal(receipt.isolation.finalPromotion, "blocked");
        assert.equal(receipt.taskRuns[0].status, "blocked");
        assert.equal(await readFile(join(scenario.dir, "src/main.py"), "utf8"), "value = 'baseline'\n");
        assert.equal(await readFile(join(scenario.dir, "src/main.go"), "utf8"), "package main\n\nvar candidate = false\n");
      }
    } finally {
      await rm(scenario.dir, { recursive: true, force: true });
    }
  }
});

it("proves Python, JavaScript, and TypeScript positive and negative access cases with real Semgrep", async (t) => {
  const semgrepPath = semgrepPathForTest();
  if (semgrepPath === null) {
    t.skip("real Semgrep unavailable; set SCOPELOCK_SEMGREP to run this matrix");
    return;
  }

  const cases: Array<{ language: string; path: string; denied: string; safe: string }> = [
    {
      language: "python",
      path: "src/probe.py",
      denied: "from pathlib import Path\nvalue = (Path.home() / '.ssh' / 'id_ed25519').read_text()\n",
      safe: "from pathlib import Path\nvalue = Path('fixtures/example.txt').read_text()\n",
    },
    {
      language: "javascript",
      path: "src/probe.js",
      denied: "const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const value = fs.readFileSync(path.join(os.homedir(), '.ssh', 'id_ed25519'), 'utf8');\n",
      safe: "const fs = require('node:fs'); const value = fs.readFileSync('fixtures/example.txt', 'utf8');\n",
    },
    {
      language: "typescript",
      path: "src/probe.ts",
      denied: "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; const value: string = fs.readFileSync(path.join(os.homedir(), '.ssh', 'id_ed25519'), 'utf8');\n",
      safe: "import fs from 'node:fs'; const value: string = fs.readFileSync('fixtures/example.txt', 'utf8');\n",
    },
  ];

  for (const probe of cases) {
    const dir = await makeRepo();
    try {
      const baseline = await commitSources(dir, {
        [probe.path]: "const baseline = true;\n",
        "fixtures/example.txt": "safe local fixture\n",
      });
      await writeFile(join(dir, probe.path), probe.denied);
      git(dir, ["add", probe.path]);
      git(dir, ["commit", "-qm", `${probe.language} denied candidate`]);
      const denied = await runSensitiveAccessScan({
        repoRoot: dir,
        baseSha: baseline,
        profile: "sensitive-local-files",
        semgrepPath,
      });
      assert.equal(denied.outcome, "denied", `${probe.language}: ${JSON.stringify(denied)}`);
      assert.ok(denied.findings.some((finding) => finding.ruleId === (
        probe.language === "python"
          ? "python.sensitive-local-file-read"
          : "javascript-typescript.sensitive-local-file-read"
      )));
      assert.ok(denied.findings.every((finding) => !finding.path.startsWith("/")));

      await writeFile(join(dir, probe.path), probe.safe);
      git(dir, ["add", probe.path]);
      git(dir, ["commit", "-qm", `${probe.language} safe candidate`]);
      const safe = await runSensitiveAccessScan({
        repoRoot: dir,
        baseSha: baseline,
        profile: "sensitive-local-files",
        semgrepPath,
      });
      assert.equal(safe.outcome, "passed", `${probe.language}: ${JSON.stringify(safe)}`);
      assert.deepEqual(safe.findings, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
