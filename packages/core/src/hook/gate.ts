import { access, appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import {
  getActiveContractId,
  loadContract,
} from "../storage/contracts.js";
import { scopelockPaths } from "../storage/paths.js";
import { scopelockConfigSchema, type EnforcementMode } from "../schemas/config.js";
import type { ChangedFile } from "../schemas/drift.js";
import { classifyPath } from "../rules/path-rules.js";

export const hookInputSchema = z
  .object({
    file_path: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    tool_input: z
      .object({
        file_path: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type HookDecision = "noop" | "allow" | "warn" | "deny";
export type HookGateResult = {
  decision: HookDecision;
  reason: string;
  path: string | null;
  message: string | null;
};

async function findScopelockRoot(cwd: string): Promise<string | null> {
  let current = resolve(cwd);
  for (;;) {
    try {
      await access(resolve(current, ".scopelock"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function pathFromInput(rawInput: string): string | null {
  try {
    const parsed = hookInputSchema.parse(JSON.parse(rawInput));
    return (
      parsed.tool_input?.file_path ??
      parsed.tool_input?.path ??
      parsed.file_path ??
      parsed.path ??
      null
    );
  } catch {
    return null;
  }
}

function relativeHookPath(repoRoot: string, path: string): string {
  return (isAbsolute(path) ? relative(repoRoot, path) : path).replaceAll("\\", "/");
}

function hookFile(path: string): ChangedFile {
  return {
    path,
    previousPath: null,
    status: "modified",
    stage: "unstaged",
    isBinary: false,
    insertions: 0,
    deletions: 0,
    sizeBytes: 0,
  };
}

async function loadMode(paths: ReturnType<typeof scopelockPaths>): Promise<EnforcementMode> {
  const raw = await readFile(paths.configPath, "utf8");
  return scopelockConfigSchema.parse(JSON.parse(raw)).mode;
}

async function appendAudit(
  paths: ReturnType<typeof scopelockPaths>,
  event: { ts: string; path: string; verdict: string; reason: string },
): Promise<void> {
  await mkdir(paths.reportsDir, { recursive: true });
  await appendFile(
    resolve(paths.reportsDir, "audit.ndjson"),
    `${JSON.stringify(event)}\n`,
    "utf8",
  );
}

export async function evaluateHookGate(input: {
  cwd: string;
  rawInput: string;
  forceAudit?: boolean;
  now?: string;
}): Promise<HookGateResult> {
  const rawPath = pathFromInput(input.rawInput);
  if (rawPath === null) {
    return { decision: "noop", reason: "invalid-input", path: null, message: null };
  }

  const root = await findScopelockRoot(input.cwd);
  if (root === null) {
    return { decision: "noop", reason: "no-scopelock-root", path: rawPath, message: null };
  }

  const paths = scopelockPaths(root);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    return { decision: "noop", reason: "no-active-contract", path: rawPath, message: null };
  }

  try {
    const contract = await loadContract(paths, activeId);
    const mode = input.forceAudit === true ? "warn" : await loadMode(paths);
    const path = relativeHookPath(root, rawPath);
    const verdict = classifyPath(hookFile(path), contract.scope);
    if (verdict === "planned") {
      return { decision: "allow", reason: "planned", path, message: null };
    }

    const message =
      verdict === "forbidden"
        ? `ScopeLock: forbidden path changed: ${path}`
        : `ScopeLock: changed outside approved scope: ${path}`;

    if (mode === "strict") {
      return { decision: "deny", reason: verdict, path, message };
    }

    await appendAudit(paths, {
      ts: input.now ?? new Date().toISOString(),
      path,
      verdict: "warn",
      reason: verdict,
    });
    return { decision: "warn", reason: verdict, path, message };
  } catch {
    return { decision: "noop", reason: "gate-error", path: rawPath, message: null };
  }
}
