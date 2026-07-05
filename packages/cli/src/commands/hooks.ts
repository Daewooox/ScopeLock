import { readFile } from "node:fs/promises";
import {
  agentIdSchema,
  enforcementModeSchema,
  findRepoRoot,
  hooksConfigPath,
  installHooks,
  scopelockConfigSchema,
  scopelockPaths,
  uninstallHooks,
  writeJsonAtomic,
  type EnforcementMode,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";

function parseHookTarget(target: string) {
  const parsed = agentIdSchema.parse(target);
  if (parsed === "codex") {
    throw new CliError(
      "HOOKS_TARGET_UNSUPPORTED",
      "Codex hooks are not supported yet; use prompt injection and check-drift",
    );
  }
  return parsed;
}

async function updateMode(root: string, mode: EnforcementMode): Promise<void> {
  const paths = scopelockPaths(root);
  let raw: string;
  try {
    raw = await readFile(paths.configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CliError(
        "NOT_INITIALIZED",
        "no .scopelock/config.json found; run `scopelock init` first",
      );
    }
    throw error;
  }
  const config = scopelockConfigSchema.parse(JSON.parse(raw));
  await writeJsonAtomic(paths.configPath, { ...config, mode });
}

export async function hooksInstallCommand(options: {
  target: string;
  mode: EnforcementMode;
}): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError("NOT_A_GIT_REPO", "hooks install must run inside a git repository");
  }

  const target = parseHookTarget(options.target);
  const mode = enforcementModeSchema.parse(options.mode);
  const path = await installHooks(root, target);
  await updateMode(root, mode);

  return {
    data: { target, mode, path },
    human: `installed ${target} hooks in ${hooksConfigPath(root, target)} (${mode})`,
    exitCode: 0,
  };
}

export async function hooksUninstallCommand(options: {
  target: string;
}): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError("NOT_A_GIT_REPO", "hooks uninstall must run inside a git repository");
  }

  const target = parseHookTarget(options.target);
  const path = await uninstallHooks(root, target);
  return {
    data: { target, path },
    human: `uninstalled ${target} ScopeLock hooks from ${path}`,
    exitCode: 0,
  };
}
