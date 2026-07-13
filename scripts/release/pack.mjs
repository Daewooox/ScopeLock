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
  if (name.endsWith(".tgz") || name === "pack-manifest.json") {
    await rm(resolve(outDir, name), { force: true });
  }
}

run(pnpm, ["-r", "build"]);
for (const dir of packageDirs) {
  run(pnpm, ["exec", "tsc", "-p", `packages/${dir}/tsconfig.json`, "--sourceMap", "false", "--declarationMap", "false"]);
}

const packages = [];
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
  const tarballPath = resolve(packed.filename);
  if (dirname(tarballPath) !== outDir) throw new Error(`pnpm packed outside output directory: ${tarballPath}`);
  run(npm, ["publish", tarballPath, "--dry-run", "--ignore-scripts", "--tag", "beta", "--access", "public", "--json"]);
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
process.stdout.write(`${JSON.stringify({ outDir, ...manifest }, null, 2)}\n`);
