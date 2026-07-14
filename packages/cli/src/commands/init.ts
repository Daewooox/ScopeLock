import { access, mkdir, writeFile } from "node:fs/promises";
import {
  CONFIG_SCHEMA_VERSION,
  SCOPELOCK_GITIGNORE,
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

export async function initCommand(cwd: string = process.cwd()): Promise<CommandResult> {
  const root = findRepoRoot(cwd) ?? cwd;
  const paths = scopelockPaths(root);

  if (await exists(paths.configPath)) {
    return {
      data: { dir: paths.dir, created: false },
      human: renderSections([
        { title: "Context", lines: `Repository  ${root}` },
        { title: "Result", lines: `ScopeLock already initialized\nFiles  ${paths.dir}` },
        { title: "Next", lines: "Check the setup: scopelock doctor" },
      ]),
      exitCode: 0,
    };
  }

  await mkdir(paths.contractsDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  await mkdir(paths.hooksDir, { recursive: true });

  const config = scopelockConfigSchema.parse({
    schemaVersion: CONFIG_SCHEMA_VERSION,
  });
  await writeJsonAtomic(paths.configPath, config);
  await writeFile(paths.gitignorePath, SCOPELOCK_GITIGNORE, "utf8");

  const inRepo = findRepoRoot(cwd) !== null;
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
