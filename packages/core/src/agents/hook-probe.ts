import { readFileSync } from "node:fs";
import type { AgentId } from "../schemas/contract.js";
import { hasScopeLockHooks, hooksConfigPath } from "../harness/hooks-merge.js";
import { NOMINAL_HOOK_CAPABILITIES } from "../harness/capabilities.js";
import type { HookCapabilities, HookConfigProbe } from "../schemas/agent-workspace.js";
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

/**
 * Read-only, config-file-only probe (no process execution, no network - same
 * I/O posture as the rest of the preflight engine). Reports whether ScopeLock's
 * own hook entry is installed and whether the nominal capability claim should
 * be trusted "as documented" or downgraded to "degraded" for this repo.
 *
 * This NEVER upgrades a capability to "live-verified" - that requires actually
 * running the harness, which is an explicit, separate regression step (see
 * capabilities.ts), not something a fast pre-dispatch check should do.
 */
export function probeHookConfig(repoRoot: string, target: AgentId): HookConfigProbe {
  const nominal = NOMINAL_HOOK_CAPABILITIES[target];

  if (target === "codex") {
    // Neither the JSON `.codex/hooks.json` schema nor the PreToolUse event
    // shape for the file-editing `apply_patch` tool is documented or
    // live-captured (see capabilities.ts). We can only detect that *some*
    // Codex hook config exists, never that it is ScopeLock's, correctly
    // formed, or effective - so confidence is always degraded here.
    const hooksJsonPath = resolveRepoPath(repoRoot, ".codex/hooks.json");
    const configTomlPath = resolveRepoPath(repoRoot, ".codex/config.toml");
    const anyConfigPresent = existsSync(hooksJsonPath) || existsSync(configTomlPath);
    const capabilities: HookCapabilities = { ...nominal, confidence: "degraded" };
    return {
      target,
      installed: false, // ScopeLock does not write a Codex hook entry yet
      capabilities,
      detail: anyConfigPresent
        ? "a Codex hook config exists, but ScopeLock cannot confirm it is installed, well-formed, or effective (undocumented hooks.json schema, unconfirmed apply_patch event shape, unverifiable project-trust state)"
        : "no Codex hook config found; PreToolUse deny is documented as a nominal capability but unverified for this repo",
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
