import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageDirs = ["core", "cli", "mcp"];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const outDir = resolve(repoRoot, option("--out", ".release-artifacts"));
await mkdir(outDir, { recursive: true });
for (const name of await readdir(outDir)) {
  if (name.endsWith(".tgz") || name === "pack-manifest.json" || name === "publish-dry-run.json") {
    await rm(resolve(outDir, name), { force: true });
  }
}

run(pnpm, ["-r", "build"]);
for (const dir of packageDirs) {
  run(pnpm, ["exec", "tsc", "-p", `packages/${dir}/tsconfig.json`, "--sourceMap", "false", "--declarationMap", "false"]);
}

const packages = [];
const dryRuns = [];
let releaseVersion = null;
for (const dir of packageDirs) {
  const packageRoot = resolve(repoRoot, "packages", dir);
  const packed = JSON.parse(
    run(pnpm, ["pack", "--json", "--pack-destination", outDir], packageRoot),
  );
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const files = packed.files.map((entry) => entry.path);
  const forbidden = files.filter((path) => path.includes(".test.") || path.endsWith(".map"));
  if (forbidden.length > 0) {
    throw new Error(`${packageJson.name} tarball contains non-runtime files: ${forbidden.join(", ")}`);
  }
  for (const required of ["LICENSE", "README.md", "package.json", "dist/index.js"]) {
    if (!files.includes(required)) throw new Error(`${packageJson.name} tarball is missing ${required}`);
  }
  if (releaseVersion !== null && releaseVersion !== packageJson.version) {
    throw new Error(`workspace package versions differ: ${releaseVersion} and ${packageJson.version}`);
  }
  releaseVersion = packageJson.version;
  if (
    packageJson.license !== "MIT" ||
    packageJson.engines?.node !== ">=22" ||
    packageJson.publishConfig?.access !== "public" ||
    packageJson.publishConfig?.tag !== "beta" ||
    typeof packageJson.homepage !== "string" ||
    typeof packageJson.bugs?.url !== "string" ||
    !Array.isArray(packageJson.keywords) ||
    packageJson.keywords.length === 0
  ) {
    throw new Error(`${packageJson.name} is missing required public package metadata`);
  }
  const tarballPath = resolve(packed.filename);
  if (dirname(tarballPath) !== outDir) throw new Error(`pnpm packed outside output directory: ${tarballPath}`);
  const dryRunOutput = JSON.parse(
    run(npm, ["publish", tarballPath, "--dry-run", "--ignore-scripts", "--tag", "beta", "--access", "public", "--json"]),
  );
  const dryRun = dryRunOutput[packageJson.name];
  if (dryRun?.name !== packageJson.name || dryRun.version !== packageJson.version) {
    throw new Error(`${packageJson.name} npm publish dry-run returned unexpected identity`);
  }
  dryRuns.push({
    name: dryRun.name,
    version: dryRun.version,
    filename: dryRun.filename,
    sizeBytes: dryRun.size,
    unpackedSizeBytes: dryRun.unpackedSize,
    fileCount: dryRun.entryCount,
    integrity: dryRun.integrity,
    files: dryRun.files.map((file) => file.path),
    access: "public",
    tag: "beta",
    status: "passed",
  });
  packages.push({
    name: packageJson.name,
    version: packageJson.version,
    filename: basename(tarballPath),
    sha256: await sha256(tarballPath),
    sizeBytes: (await stat(tarballPath)).size,
    fileCount: files.length,
  });
}

const manifest = { schemaVersion: 1, version: releaseVersion, packages };
await writeFile(resolve(outDir, "pack-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  resolve(outDir, "publish-dry-run.json"),
  `${JSON.stringify({ schemaVersion: 1, publication: "not-performed", packages: dryRuns }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ outDir, ...manifest }, null, 2)}\n`);
