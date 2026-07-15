import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const expectedPackages = new Set(["@scopelock/core", "@scopelock/cli", "@scopelock/mcp"]);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function npmInvocation(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const npmCli = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  return { command: process.execPath, args: [npmCli, ...args] };
}

function run(command, args, cwd, allowFailure = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
  if (result.error !== undefined || (!allowFailure && result.status !== 0)) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

export function summarizeAudit(report) {
  const vulnerabilities = report?.metadata?.vulnerabilities;
  const severities = ["info", "low", "moderate", "high", "critical", "total"];
  if (
    report?.auditReportVersion !== 2 ||
    vulnerabilities === null ||
    typeof vulnerabilities !== "object" ||
    severities.some((severity) => !Number.isInteger(vulnerabilities[severity]) || vulnerabilities[severity] < 0)
  ) {
    throw new Error("npm audit returned an unsupported response");
  }
  return {
    info: vulnerabilities.info,
    low: vulnerabilities.low,
    moderate: vulnerabilities.moderate,
    high: vulnerabilities.high,
    critical: vulnerabilities.critical,
    total: vulnerabilities.total ?? 0,
  };
}

export async function auditPacked({ artifactsDir, outputPath }) {
  const manifest = JSON.parse(await readFile(resolve(artifactsDir, "pack-manifest.json"), "utf8"));
  const remaining = new Set(expectedPackages);
  const tarballs = manifest.packages.map((pkg) => {
    if (!remaining.delete(pkg.name) || pkg.filename !== basename(pkg.filename)) {
      throw new Error(`unsafe or unexpected package manifest entry: ${pkg.name}`);
    }
    return resolve(artifactsDir, pkg.filename);
  });
  if (remaining.size > 0) throw new Error("release manifest package set is incomplete");

  const tempRoot = await mkdtemp(resolve(tmpdir(), "scopelock-release-audit-"));
  try {
    await writeFile(resolve(tempRoot, "package.json"), '{"private":true}\n');
    const install = npmInvocation([
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--omit=dev",
      ...tarballs,
    ]);
    run(install.command, install.args, tempRoot);

    const audit = npmInvocation(["audit", "--omit=dev", "--audit-level=high", "--json"]);
    const auditResult = run(audit.command, audit.args, tempRoot, true);
    let report;
    try {
      report = JSON.parse(auditResult.stdout);
    } catch {
      throw new Error(`npm audit did not return JSON\n${auditResult.stdout ?? ""}${auditResult.stderr ?? ""}`);
    }
    const vulnerabilities = summarizeAudit(report);
    if (auditResult.status !== 0 || vulnerabilities.high > 0 || vulnerabilities.critical > 0) {
      throw new Error(
        `production dependency audit failed: ${vulnerabilities.high} high, ${vulnerabilities.critical} critical\n${auditResult.stderr ?? ""}`,
      );
    }

    const version = npmInvocation(["--version"]);
    const evidence = {
      schemaVersion: 1,
      packageVersion: manifest.version,
      tool: "npm",
      toolVersion: run(version.command, version.args, tempRoot).stdout.trim(),
      dependencySet: "packed-production",
      vulnerabilities,
      status: "passed",
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const artifactsDir = resolve(repoRoot, option("--artifacts", ".release-artifacts"));
  const outputPath = resolve(repoRoot, option("--out", ".release-artifacts/production-audit.json"));
  const evidence = await auditPacked({ artifactsDir, outputPath });
  process.stdout.write(`${JSON.stringify({ outputPath, ...evidence }, null, 2)}\n`);
}
