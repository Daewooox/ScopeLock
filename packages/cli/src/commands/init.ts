import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  CONFIG_SCHEMA_VERSION,
  SCOPELOCK_GITIGNORE,
  buildRepoManifest,
  findRepoRoot,
  scopelockConfigSchema,
  scopelockPaths,
  writeJsonAtomic,
} from "@scopelock/core";
import type { CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureGitignore(path: string): Promise<boolean> {
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const present = new Set(current.split(/\r?\n/));
  const missing = SCOPELOCK_GITIGNORE.trimEnd().split("\n").filter((line) => !present.has(line));
  if (missing.length === 0) return false;

  const prefix = current.length === 0 || current.endsWith("\n") ? current : `${current}\n`;
  await writeFile(path, `${prefix}${missing.join("\n")}\n`, "utf8");
  return true;
}

export async function initCommand(cwd: string = process.cwd()): Promise<CommandResult> {
  const repoRoot = findRepoRoot(cwd);
  const root = repoRoot ?? cwd;
  const paths = scopelockPaths(root);

  if (await exists(paths.configPath)) {
    await mkdir(paths.draftsDir, { recursive: true });
    const gitignoreUpdated = await ensureGitignore(paths.gitignorePath);
    return {
      data: { dir: paths.dir, created: false, gitignoreUpdated },
      human: renderSections([
        { title: "Context", lines: `Repository  ${root}` },
        {
          title: "Result",
          lines: `ScopeLock already initialized\nFiles  ${paths.dir}${gitignoreUpdated ? "\nLocal draft ignore  updated" : ""}`,
        },
        { title: "Next", lines: "Check the setup: scopelock doctor" },
      ]),
      exitCode: 0,
    };
  }

  await mkdir(paths.contractsDir, { recursive: true });
  await mkdir(paths.draftsDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  await mkdir(paths.hooksDir, { recursive: true });

  const config = scopelockConfigSchema.parse({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...(repoRoot === null ? {} : { projectTypes: buildRepoManifest(root).projectTypes }),
  });
  await writeJsonAtomic(paths.configPath, config);
  await writeFile(paths.gitignorePath, SCOPELOCK_GITIGNORE, "utf8");

  const inRepo = repoRoot !== null;
  return {
    data: { dir: paths.dir, created: true, insideGitRepo: inRepo },
    human: renderSections([
      { title: "Context", lines: `Repository  ${root}` },
      {
        title: "Checks",
        lines: inRepo ? "Git repository  ready" : "Git repository  not found; drift checks need Git",
      },
      { title: "Result", lines: `ScopeLock initialized\nFiles  ${paths.dir}` },
      { title: "Next", lines: "Check the setup: scopelock doctor" },
    ]),
    exitCode: 0,
  };
}
