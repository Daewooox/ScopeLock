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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function initCommand(): Promise<CommandResult> {
  const cwd = process.cwd();
  const root = findRepoRoot(cwd) ?? cwd;
  const paths = scopelockPaths(root);

  if (await exists(paths.configPath)) {
    return {
      data: { dir: paths.dir, created: false },
      human: `already initialized: ${paths.dir}`,
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
  const warning = inRepo
    ? ""
    : "\nwarning: not inside a git repository; drift checks need git";
  return {
    data: { dir: paths.dir, created: true, insideGitRepo: inRepo },
    human: `initialized ${paths.dir}${warning}`,
    exitCode: 0,
  };
}
