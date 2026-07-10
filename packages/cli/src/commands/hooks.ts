import { access, mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentIdSchema,
  enforcementModeSchema,
  findRepoRoot,
  hashFileBytes,
  hookVerificationStoreSchema,
  hooksConfigPath,
  installHooks,
  probeHookConfig,
  scopelockConfigSchema,
  scopelockPaths,
  uninstallHooks,
  writeJsonAtomic,
  type EnforcementMode,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";

const DEFAULT_CODEX_VERIFY_TIMEOUT_MS = 90_000;

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readVerificationStore(root: string) {
  const path = scopelockPaths(root).hookVerificationsPath;
  try {
    return hookVerificationStoreSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return hookVerificationStoreSchema.parse({ schemaVersion: 1, verifications: [] });
  }
}

async function writeVerification(root: string, record: {
  target: "codex";
  checkedAt: string;
  hookConfigDigest: string;
  result: "passed" | "failed";
  detail: string;
}): Promise<void> {
  const paths = scopelockPaths(root);
  const store = await readVerificationStore(root);
  await mkdir(paths.dir, { recursive: true });
  await writeJsonAtomic(paths.hookVerificationsPath, {
    ...store,
    verifications: [...store.verifications, record],
  });
}

function runCodexProbe(input: {
  root: string;
  codexBin: string;
  probePath: string;
  timeoutMs: number;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const prompt = [
    "Use native apply_patch exactly once to add this file:",
    input.probePath,
    "with content SCOPELOCK_CODEX_VERIFY_SHOULD_NOT_EXIST.",
    "Do not use shell commands or another edit method. Stop after the patch attempt.",
  ].join(" ");

  return new Promise((resolve) => {
    const child = spawn(
      input.codexBin,
      [
        "exec",
        "--ephemeral",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        input.root,
        prompt,
      ],
      { cwd: input.root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
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

  const hookPath = hooksConfigPath(root, target);
  const probe = probeHookConfig(root, target);
  if (!probe.installed) {
    throw new CliError("HOOK_NOT_INSTALLED", "no ScopeLock Codex hook found; run `scopelock hooks install --target codex --local --mode strict` first");
  }

  const probeRelPath = `.scopelock/probes/codex-hook-verify-${Date.now()}.txt`;
  const probeAbsPath = join(root, probeRelPath);
  const codex = await runCodexProbe({
    root,
    codexBin: options.codexBin ?? "codex",
    probePath: probeRelPath,
    timeoutMs: options.timeoutMs ?? DEFAULT_CODEX_VERIFY_TIMEOUT_MS,
  });
  const mutated = await pathExists(probeAbsPath);
  if (mutated) {
    await rm(probeAbsPath, { force: true });
  }

  const combined = `${codex.stdout}\n${codex.stderr}`;
  const denied = !mutated && /denied|permissionDecision|ScopeLock/i.test(combined);
  const result = denied ? "passed" : "failed";
  const detail = denied
    ? "Codex apply_patch probe was denied before mutation"
    : codex.timedOut
      ? "Codex probe timed out before a denial was observed"
      : mutated
        ? "Codex probe mutated the file; project hook trust is not active"
        : "Codex probe did not produce a recognizable ScopeLock denial";

  await writeVerification(root, {
    target,
    checkedAt: new Date().toISOString(),
    hookConfigDigest: hashFileBytes(hookPath),
    result,
    detail,
  });

  return {
    data: {
      target,
      result,
      confidence: denied ? "live-verified" : "degraded",
      detail,
      hookConfigPath: hookPath,
      mutated,
      exitCode: codex.exitCode,
    },
    human: `codex hook verify: ${result} (${denied ? "live-verified" : "degraded"})\n${detail}`,
    exitCode: denied ? 0 : 1,
  };
}
