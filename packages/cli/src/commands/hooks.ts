import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

/**
 * Absolute `node "<abs>/index.js"` invocation of this very CLI. Used by
 * `--local` so hooks run before the `scopelock` binary is on PATH. The path
 * is quoted because the repo path may contain spaces.
 */
function localCommandPrefix(): string {
  const cliEntry = fileURLToPath(new URL("../index.js", import.meta.url));
  return `${process.execPath} "${cliEntry}"`;
}

function parseHookTarget(target: string) {
  return agentIdSchema.parse(target);
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
  local?: boolean;
}): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError("NOT_A_GIT_REPO", "hooks install must run inside a git repository");
  }

  const target = parseHookTarget(options.target);
  const mode = enforcementModeSchema.parse(options.mode);
  const commandPrefix = options.local === true ? localCommandPrefix() : undefined;
  await updateMode(root, mode);
  const path = await installHooks(root, target, commandPrefix);

  return {
    data: { target, mode, path, local: options.local === true },
    human: `installed ${target} hooks in ${hooksConfigPath(root, target)} (${mode}${
      options.local === true ? ", local" : ""
    })${target === "codex" ? "; Codex project hooks still require project trust or --dangerously-bypass-hook-trust" : ""}`,
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
