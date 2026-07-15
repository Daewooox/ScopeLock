import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result.stdout;
}

function npmInvocation(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const npmCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  return { command: process.execPath, args: [npmCli, ...args] };
}

async function probeMcp(entrypoint, cwd) {
  const child = spawn(process.execPath, [entrypoint], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  child.stdin.end(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "release-smoke", version: "1" } } })}\n`,
  );
  const deadline = Date.now() + 5_000;
  while (!stdout.includes("\n") && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  child.kill();
  if (child.exitCode === null) {
    await Promise.race([once(child, "exit"), new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  }
  const line = stdout.split("\n").find((candidate) => candidate.trim().startsWith("{"));
  if (line === undefined || JSON.parse(line).id !== 1) {
    throw new Error(`MCP initialize probe failed\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
}

const artifactsDir = resolve(repoRoot, option("--artifacts", ".release-artifacts"));
const outputPath = option("--out", null);
const manifest = JSON.parse(await readFile(resolve(artifactsDir, "pack-manifest.json"), "utf8"));
const expectedPackages = new Set(["@scopelock/core", "@scopelock/cli", "@scopelock/mcp"]);
if (manifest.packages.length !== expectedPackages.size) throw new Error("release manifest package set is incomplete");
for (const pkg of manifest.packages) {
  if (!expectedPackages.delete(pkg.name) || pkg.filename !== basename(pkg.filename)) {
    throw new Error(`unsafe or unexpected package manifest entry: ${pkg.name}`);
  }
}
const tempRoot = await mkdtemp(resolve(tmpdir(), "scopelock-release-smoke-"));

try {
  await writeFile(resolve(tempRoot, "package.json"), '{"private":true,"type":"module"}\n');
  const tarballs = manifest.packages.map((pkg) => resolve(artifactsDir, pkg.filename));
  const projectInstall = npmInvocation(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs]);
  run(projectInstall.command, projectInstall.args, tempRoot);

  run(
    process.execPath,
    ["--input-type=module", "-e", "const m=await import('@scopelock/core');if(!m.releaseEvidenceSchema)process.exit(1)"],
    tempRoot,
  );
  const cli = resolve(tempRoot, "node_modules/@scopelock/cli/dist/index.js");
  assertIncludes(run(process.execPath, [cli, "--help"], tempRoot), "Local flight control");

  const fixture = resolve(tempRoot, "fixture");
  run("git", ["init", "-q", fixture], tempRoot);
  run("git", ["config", "user.name", "ScopeLock release smoke"], fixture);
  run("git", ["config", "user.email", "release-smoke@scopelock.local"], fixture);
  await writeFile(resolve(fixture, "README.md"), "# Release smoke\n");
  run("git", ["add", "README.md"], fixture);
  run("git", ["commit", "-qm", "test: initialize release smoke"], fixture);
  run(process.execPath, [cli, "init"], fixture);
  run(
    process.execPath,
    [cli, "contract", "new", "--task", "Release smoke", "--planned", "README.md", "--out", ".scopelock/drafts/release-smoke.json"],
    fixture,
  );
  run(process.execPath, [cli, "contract", "approve", ".scopelock/drafts/release-smoke.json"], fixture);
  assertIncludes(run(process.execPath, [cli, "check-drift"], fixture), "no drift detected");
  const receipt = resolve(fixture, "receipt.json");
  const report = resolve(fixture, "report.html");
  await writeFile(receipt, '{"schemaVersion":3,"planId":"release-smoke","waves":[],"taskRuns":[]}\n');
  run(process.execPath, [cli, "report", receipt, "--out", report], fixture);
  await access(report);
  const mcp = resolve(tempRoot, "node_modules/@scopelock/mcp/dist/index.js");
  await probeMcp(mcp, fixture);

  const globalPrefix = resolve(tempRoot, "global");
  const globalInstall = npmInvocation([
    "install", "--global", "--prefix", globalPrefix, "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs,
  ]);
  run(globalInstall.command, globalInstall.args, tempRoot);
  const globalModules =
    process.platform === "win32" ? resolve(globalPrefix, "node_modules") : join(globalPrefix, "lib", "node_modules");
  const globalCli = resolve(globalModules, "@scopelock/cli/dist/index.js");
  assertIncludes(run(process.execPath, [globalCli, "--help"], tempRoot), "Local flight control");
  const npmVersion = npmInvocation(["--version"]);
  const packageNames = manifest.packages.map((pkg) => pkg.name);
  const projectUninstall = npmInvocation(["uninstall", "--ignore-scripts", "--no-audit", "--no-fund", ...packageNames]);
  run(projectUninstall.command, projectUninstall.args, tempRoot);
  const globalUninstall = npmInvocation([
    "uninstall", "--global", "--prefix", globalPrefix, "--ignore-scripts", "--no-audit", "--no-fund", ...packageNames,
  ]);
  run(globalUninstall.command, globalUninstall.args, tempRoot);
  for (const pkg of packageNames) {
    await assertMissing(resolve(tempRoot, "node_modules", pkg));
    await assertMissing(resolve(globalModules, pkg));
  }

  const result = {
    schemaVersion: 1,
    platform: process.platform,
    node: process.version,
    npm: run(npmVersion.command, npmVersion.args, tempRoot).trim(),
    version: manifest.version,
    installModes: ["project", "global-prefix", "uninstall-cleanup"],
    status: "passed",
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath === null) process.stdout.write(json);
  else {
    const resolvedOutput = resolve(repoRoot, outputPath);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, json);
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) throw new Error(`expected output to include ${expected}`);
}

async function assertMissing(path) {
  try {
    await access(path);
    throw new Error(`uninstall left an unexpected package path: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
