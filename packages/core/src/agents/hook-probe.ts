import { readFileSync } from "node:fs";
import type { AgentId } from "../schemas/contract.js";
import { hasScopeLockHooks, hooksConfigPath } from "../harness/hooks-merge.js";
import { NOMINAL_HOOK_CAPABILITIES } from "../harness/capabilities.js";
import {
  hookVerificationStoreSchema,
  type HookCapabilities,
  type HookConfigProbe,
} from "../schemas/agent-workspace.js";
import { scopelockPaths } from "../storage/paths.js";
import { hashFileBytes } from "./hash.js";
import { resolveRepoPath } from "./paths.js";

function readJsonObjectSync(absPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function existsSync(absPath: string): boolean {
  try {
    readFileSync(absPath);
    return true;
  } catch {
    return false;
  }
}

function hasCurrentLiveVerification(repoRoot: string, target: AgentId, hookConfigPath: string): boolean {
  const storeRaw = readJsonObjectSync(scopelockPaths(repoRoot).hookVerificationsPath);
  const store = hookVerificationStoreSchema.safeParse(storeRaw);
  if (!store.success) return false;

  let hookConfigDigest: string;
  try {
    hookConfigDigest = hashFileBytes(hookConfigPath);
  } catch {
    return false;
  }

  const latest = [...store.data.verifications]
    .reverse()
    .find((record) => record.target === target && record.hookConfigDigest === hookConfigDigest);
  return latest?.result === "passed";
}

/**
 * Read-only, config-file-only probe (no process execution, no network - same
 * I/O posture as the rest of the preflight engine). Reports whether ScopeLock's
 * own hook entry is installed and whether the nominal capability claim should
 * be trusted "as documented", downgraded to "degraded", or upgraded to
 * "live-verified" only when a previous explicit harness verification matches
 * the current hook config digest.
 */
export function probeHookConfig(repoRoot: string, target: AgentId): HookConfigProbe {
  const nominal = NOMINAL_HOOK_CAPABILITIES[target];

  if (target === "codex") {
    const hooksJsonPath = resolveRepoPath(repoRoot, ".codex/hooks.json");
    const configTomlPath = resolveRepoPath(repoRoot, ".codex/config.toml");
    const config = readJsonObjectSync(hooksJsonPath);
    const installed = config !== null && hasScopeLockHooks(config, target);
    const anyConfigPresent = installed || existsSync(configTomlPath);
    const liveVerified = installed && hasCurrentLiveVerification(repoRoot, target, hooksJsonPath);
    const capabilities: HookCapabilities = {
      ...nominal,
      confidence: liveVerified ? "live-verified" : "degraded",
    };
    return {
      target,
      installed,
      capabilities,
      detail: liveVerified
        ? `ScopeLock codex hook entry was live-verified for the current ${hooksJsonPath} digest`
        : installed
        ? `ScopeLock codex hook entry found at ${hooksJsonPath}; confidence remains degraded because project trust cannot be verified statically`
        : anyConfigPresent
          ? "a Codex hook config exists, but ScopeLock cannot confirm an installed trusted ScopeLock entry"
          : "no Codex hook config found; run `scopelock hooks install --target codex` to configure apply_patch PreToolUse",
    };
  }

  const configPath = hooksConfigPath(repoRoot, target);
  const config = readJsonObjectSync(configPath);
  const installed = config !== null && hasScopeLockHooks(config, target);

  return {
    target,
    installed,
    capabilities: nominal,
    detail: installed
      ? `ScopeLock ${target} hook entry found at ${configPath}`
      : `no ScopeLock ${target} hook entry found at ${configPath}; run \`scopelock hooks install --target ${target}\` to enable enforcement`,
  };
}
