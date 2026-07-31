import { strict as assert } from "node:assert";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { headSha } from "@scopelock/core";
import {
  parseSensitiveSemgrepOutput,
  runSensitiveAccessScan,
  type SensitiveAccessResult,
} from "./sensitive-access.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function makeFixture(extension = ".js", source = "const safe = true;\n"): Promise<{
  root: string;
  base: string;
  target: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "scopelock-sensitive-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "ScopeLock Test"]);
  await mkdir(join(root, "src"));
  const target = "src/main" + extension;
  await writeFile(join(root, target), "const initial = true;\n", "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "baseline"]);
  const base = headSha(root);
  assert.ok(base);
  await writeFile(join(root, target), source, "utf8");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "candidate"]);
  return { root, base, target };
}

async function fakeSemgrep(mode: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scopelock-fake-semgrep-"));
  const script = join(root, "fake-semgrep.mjs");
  await writeFile(script, [
    "const args = process.argv.slice(2);",
    "if (args[0] === 'timeout') { setInterval(() => {}, 1000); }",
    "const separator = args.indexOf('--');",
    "const scanned = separator < 0 ? [] : args.slice(separator + 1);",
    "const results = args[0] === 'denied' ? [{ check_id: 'test.sensitive-read', path: scanned[0], start: { line: 4 } }] : [];",
    "const errors = args[0] === 'errors' ? ['scanner error'] : [];",
    "process.stdout.write(JSON.stringify({ errors, results, paths: { scanned } }));",
  ].join("\n"), "utf8");
  await chmod(script, 0o755);
  return script;
}

function baseResult(targets: string[] = ["src/main.js"]): SensitiveAccessResult {
  return {
    profile: "sensitive-local-files",
    outcome: "passed",
    baseSha: "a".repeat(40),
    engine: "semgrep",
    engineVersion: "1.171.0",
    rulePackSha256: "5197d46ad53bd1f8c22b4ba1c3963154558808c3e0c9dfd486bca973cc347f51",
    targets,
    scanned: [],
    findings: [],
  };
}

test("parses a clean scanner result and preserves exact target coverage", () => {
  const result = parseSensitiveSemgrepOutput(
    JSON.stringify({ errors: [], results: [], paths: { scanned: ["src/main.js"] } }),
    ["src/main.js"],
    baseResult(),
  );
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.scanned, ["src/main.js"]);
});

test("denies a normalized finding without persisting source text", () => {
  const result = parseSensitiveSemgrepOutput(
    JSON.stringify({
      errors: [],
      results: [{ check_id: "/tmp/rules/python.sensitive-local-file-read", path: "src/main.js", start: { line: 4 }, extra: { lines: "secret" } }],
      paths: { scanned: ["src/main.js"] },
    }),
    ["src/main.js"],
    baseResult(),
  );
  assert.equal(result.outcome, "denied");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.ruleId, "python.sensitive-local-file-read");
  assert.equal("extra" in result.findings[0]!, false);
});

test("blocks malformed scanner errors and incomplete coverage", () => {
  const base = baseResult(["src/main.js"]);
  assert.equal(
    parseSensitiveSemgrepOutput(JSON.stringify({ errors: "bad", results: [], paths: { scanned: ["src/main.js"] } }), base.targets, base).outcome,
    "blocked",
  );
  assert.equal(
    parseSensitiveSemgrepOutput(JSON.stringify({ errors: [], results: [], paths: { scanned: [] } }), base.targets, base).outcome,
    "blocked",
  );
  assert.equal(
    parseSensitiveSemgrepOutput(JSON.stringify({ results: [], paths: { scanned: ["src/main.js"] } }), base.targets, base).outcome,
    "blocked",
  );
  assert.equal(
    parseSensitiveSemgrepOutput("not-json", base.targets, base).outcome,
    "blocked",
  );
});

test("runs a fake Semgrep command through the process-tree boundary", async (t) => {
  const fixture = await makeFixture();
  const script = await fakeSemgrep("passed");
  t.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(join(script, ".."), { recursive: true, force: true });
  });
  const result = await runSensitiveAccessScan({
    repoRoot: fixture.root,
    baseSha: fixture.base,
    profile: "sensitive-local-files",
    semgrepPath: process.execPath,
    semgrepArgsPrefix: [script, "passed"],
  });
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.targets, [fixture.target]);
});

test("returns denied, not applicable, and blocked outcomes", async (t) => {
  const denied = await makeFixture();
  const deniedScript = await fakeSemgrep("denied");
  const unsupported = await makeFixture(".go", "package main\n");
  const notApplicable = await makeFixture(".md", "# documentation\n");
  const missing = await makeFixture();
  const missingPath = join(missing.root, "not-installed-semgrep");
  t.after(async () => {
    await rm(denied.root, { recursive: true, force: true });
    await rm(unsupported.root, { recursive: true, force: true });
    await rm(notApplicable.root, { recursive: true, force: true });
    await rm(missing.root, { recursive: true, force: true });
    await rm(join(deniedScript, ".."), { recursive: true, force: true });
  });
  const deniedResult = await runSensitiveAccessScan({
    repoRoot: denied.root,
    baseSha: denied.base,
    profile: "sensitive-local-files",
    semgrepPath: process.execPath,
    semgrepArgsPrefix: [deniedScript, "denied"],
  });
  assert.equal(deniedResult.outcome, "denied");
  const unsupportedResult = await runSensitiveAccessScan({
    repoRoot: unsupported.root,
    baseSha: unsupported.base,
    profile: "sensitive-local-files",
  });
  assert.equal(unsupportedResult.outcome, "blocked");
  const notApplicableResult = await runSensitiveAccessScan({
    repoRoot: notApplicable.root,
    baseSha: notApplicable.base,
    profile: "sensitive-local-files",
  });
  assert.equal(notApplicableResult.outcome, "not-applicable");
  const missingResult = await runSensitiveAccessScan({
    repoRoot: missing.root,
    baseSha: missing.base,
    profile: "sensitive-local-files",
    semgrepPath: missingPath,
  });
  assert.equal(missingResult.outcome, "blocked");
});

test("scans an unstaged source change instead of returning not-applicable", async (t) => {
  const fixture = await makeFixture();
  const script = await fakeSemgrep("denied");
  t.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(join(script, ".."), { recursive: true, force: true });
  });

  git(fixture.root, ["reset", "--hard", fixture.base]);
  await writeFile(
    join(fixture.root, fixture.target),
    "const value = readFileSync(join(homedir(), '.ssh', 'id_ed25519'));",
    "utf8",
  );
  const result = await runSensitiveAccessScan({
    repoRoot: fixture.root,
    baseSha: fixture.base,
    profile: "sensitive-local-files",
    semgrepPath: process.execPath,
    semgrepArgsPrefix: [script, "denied"],
  });
  assert.equal(result.outcome, "denied");
  assert.deepEqual(result.targets, [fixture.target]);
});

test("scans an untracked source change instead of returning not-applicable", async (t) => {
  const fixture = await makeFixture();
  const script = await fakeSemgrep("denied");
  const untracked = join(fixture.root, "src/untracked.js");
  t.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(join(script, ".."), { recursive: true, force: true });
  });

  await writeFile(untracked, "const value = readFileSync('~/.ssh/id_ed25519');\n", "utf8");
  const result = await runSensitiveAccessScan({
    repoRoot: fixture.root,
    baseSha: fixture.base,
    profile: "sensitive-local-files",
    semgrepPath: process.execPath,
    semgrepArgsPrefix: [script, "denied"],
  });
  assert.equal(result.outcome, "denied");
  assert.deepEqual(result.targets, ["src/main.js", "src/untracked.js"]);
});

test("blocks changed source containers that are outside the supported languages", async (t) => {
  const fixture = await makeFixture(".vue", "<template><div /></template>\n");
  t.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
  });

  const result = await runSensitiveAccessScan({
    repoRoot: fixture.root,
    baseSha: fixture.base,
    profile: "sensitive-local-files",
    semgrepPath: join(fixture.root, "missing-semgrep"),
  });
  assert.equal(result.outcome, "blocked");
  assert.match(result.reason ?? "", /unsupported changed source language/u);
});

test("blocks when the prepared Semgrep version or rule pack does not match", async (t) => {
  const fixture = await makeFixture();
  const script = await fakeSemgrep("passed");
  t.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(join(script, ".."), { recursive: true, force: true });
  });

  const result = await runSensitiveAccessScan({
    repoRoot: fixture.root,
    baseSha: fixture.base,
    profile: "sensitive-local-files",
    semgrepPath: process.execPath,
    semgrepArgsPrefix: [script, "passed"],
    expectedEngineVersion: "1.171.0",
    expectedRulePackSha256: "5197d46ad53bd1f8c22b4ba1c3963154558808c3e0c9dfd486bca973cc347f51",
  } as Parameters<typeof runSensitiveAccessScan>[0]);
  assert.equal(result.outcome, "blocked");
  assert.match(result.reason ?? "", /Semgrep version mismatch|rule pack hash mismatch/u);
});

test("times out a hanging scanner and fails closed", async (t) => {
  const fixture = await makeFixture();
  const script = await fakeSemgrep("timeout");
  t.after(async () => {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(join(script, ".."), { recursive: true, force: true });
  });
  const result = await runSensitiveAccessScan({
    repoRoot: fixture.root,
    baseSha: fixture.base,
    profile: "sensitive-local-files",
    semgrepPath: process.execPath,
    semgrepArgsPrefix: [script, "timeout"],
    timeoutMs: 25,
  });
  assert.equal(result.outcome, "blocked");
  assert.match(result.reason ?? "", /timed out/u);
});
