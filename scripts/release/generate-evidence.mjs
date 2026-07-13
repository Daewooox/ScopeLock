import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseEvidenceSchema } from "../../packages/core/dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function collectSmoke(smokeDir) {
  const statuses = { linux: "pending", macos: "pending", windows: "pending" };
  if (smokeDir === null) return statuses;
  for (const name of await readdir(smokeDir, { recursive: true })) {
    if (!basename(name).startsWith("smoke-") || !name.endsWith(".json")) continue;
    const result = JSON.parse(await readFile(resolve(smokeDir, name), "utf8"));
    const key = result.platform === "darwin" ? "macos" : result.platform === "win32" ? "windows" : result.platform;
    if (key in statuses) statuses[key] = result.status;
  }
  return statuses;
}

const artifactsDir = resolve(repoRoot, option("--artifacts", ".release-artifacts"));
const smokeOption = option("--smoke-dir", null);
const smokeDir = smokeOption === null ? null : resolve(repoRoot, smokeOption);
const output = resolve(repoRoot, option("--out", ".release-artifacts/release-evidence.json"));
const manifest = JSON.parse(await readFile(resolve(artifactsDir, "pack-manifest.json"), "utf8"));

const packages = [];
for (const pkg of manifest.packages) {
  if (pkg.filename !== basename(pkg.filename)) throw new Error(`unsafe tarball filename: ${pkg.filename}`);
  const path = resolve(artifactsDir, pkg.filename);
  const sha256 = await digest(path);
  if (sha256 !== pkg.sha256) throw new Error(`tarball digest changed after pack: ${pkg.filename}`);
  packages.push({ ...pkg, filename: basename(path), sizeBytes: (await stat(path)).size });
}

const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

const evidence = releaseEvidenceSchema.parse({
  schemaVersion: 1,
  version: manifest.version,
  commitSha: gitSha(),
  generatedAt: new Date().toISOString(),
  packages,
  ciRunUrl: runUrl,
  installSmoke: await collectSmoke(smokeDir),
  security: {
    codeql: option("--codeql", "pending"),
    gitleaks: option("--gitleaks", "pending"),
    dependencyAudit: option("--dependency-audit", "pending"),
  },
  manualApproval: "pending",
  publication: "not-performed",
});

await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${output}\n`);
