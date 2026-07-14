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
  getActiveContractId,
  loadContract,
  writeApprovalSeal,
  type EnforcementMode,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

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
  const activeId = await getActiveContractId(scopelockPaths(root));
  if (activeId !== null) await writeApprovalSeal(root, await loadContract(scopelockPaths(root), activeId));

  return {
    data: { target, mode, path, local: options.local === true },
    human: renderSections([
      { title: "Context", lines: `Agent  ${target}` },
      {
        title: "Result",
        lines: [
          `Hooks installed  ${hooksConfigPath(root, target)}`,
          `Mode             ${mode}${options.local === true ? ", local" : ""}`,
          ...(target === "codex" ? ["Confidence       project trust still requires live verification"] : []),
        ],
      },
      {
        title: "Next",
        lines: target === "codex"
          ? "Verify the hook: scopelock hooks verify --target codex"
          : "Check the environment: scopelock agents preflight --manifest <path>",
      },
    ]),
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
  const activeId = await getActiveContractId(scopelockPaths(root));
  if (activeId !== null) await writeApprovalSeal(root, await loadContract(scopelockPaths(root), activeId));
  return {
    data: { target, path },
    human: renderSections([
      { title: "Context", lines: `Agent  ${target}` },
      { title: "Result", lines: `ScopeLock hooks removed  ${path}` },
      { title: "Next", lines: "Check the environment: scopelock agents preflight --manifest <path>" },
    ]),
    exitCode: 0,
  };
}

export async function hooksVerifyCommand(options: {
  target: string;
  codexBin?: string;
  timeoutMs?: number;
}): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError("NOT_A_GIT_REPO", "hooks verify must run inside a git repository");
  }

  const target = parseHookTarget(options.target);
  if (target !== "codex") {
    throw new CliError("HOOK_VERIFY_UNSUPPORTED", "live hook verification is currently implemented for codex only");
  }

  void options.codexBin;
  void options.timeoutMs;
  throw new CliError(
    "HOOK_VERIFY_UNAVAILABLE",
    "safe Codex live verification is unavailable: ScopeLock will not disable sandbox/approvals; use config preflight and treat confidence as degraded",
  );
}
