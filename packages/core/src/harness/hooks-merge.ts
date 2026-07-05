import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { AgentId } from "../schemas/contract.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { claudeScopeLockEntry } from "./claude-hooks.js";
import { cursorScopeLockEntry } from "./cursor-hooks.js";

export class HooksFileInvalidError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function isOwnEntry(value: unknown): boolean {
  return JSON.stringify(value).includes("scopelock hook");
}

function parseExisting(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HooksFileInvalidError("hooks config must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    return parseExisting(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new HooksFileInvalidError(`invalid JSON: ${path}`);
    }
    throw error;
  }
}

function withoutOwnEntries(entries: unknown): unknown[] {
  return Array.isArray(entries) ? entries.filter((entry) => !isOwnEntry(entry)) : [];
}

export function mergeClaudeHooks(existing: Record<string, unknown>): Record<string, unknown> {
  const hooks =
    typeof existing.hooks === "object" && existing.hooks !== null && !Array.isArray(existing.hooks)
      ? { ...(existing.hooks as Record<string, unknown>) }
      : {};
  const preToolUse = withoutOwnEntries(hooks.PreToolUse);
  return {
    ...existing,
    hooks: {
      ...hooks,
      PreToolUse: [...preToolUse, claudeScopeLockEntry()],
    },
  };
}

export function removeClaudeHooks(existing: Record<string, unknown>): Record<string, unknown> {
  const hooks =
    typeof existing.hooks === "object" && existing.hooks !== null && !Array.isArray(existing.hooks)
      ? { ...(existing.hooks as Record<string, unknown>) }
      : {};
  return {
    ...existing,
    hooks: {
      ...hooks,
      PreToolUse: withoutOwnEntries(hooks.PreToolUse),
    },
  };
}

export function mergeCursorHooks(existing: Record<string, unknown>): Record<string, unknown> {
  const afterFileEdit = withoutOwnEntries(existing.afterFileEdit);
  return {
    ...existing,
    afterFileEdit: [...afterFileEdit, cursorScopeLockEntry()],
  };
}

export function removeCursorHooks(existing: Record<string, unknown>): Record<string, unknown> {
  return {
    ...existing,
    afterFileEdit: withoutOwnEntries(existing.afterFileEdit),
  };
}

export function hooksConfigPath(root: string, target: AgentId): string {
  if (target === "claude") return resolve(root, ".claude", "settings.json");
  if (target === "cursor") return resolve(root, ".cursor", "hooks.json");
  throw new HooksFileInvalidError("hooks are only supported for claude and cursor");
}

export async function installHooks(root: string, target: AgentId): Promise<string> {
  const path = hooksConfigPath(root, target);
  const existing = await readJsonObject(path);
  const next =
    target === "claude" ? mergeClaudeHooks(existing) : mergeCursorHooks(existing);
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, next);
  return path;
}

export async function uninstallHooks(root: string, target: AgentId): Promise<string> {
  const path = hooksConfigPath(root, target);
  const existing = await readJsonObject(path);
  const next =
    target === "claude" ? removeClaudeHooks(existing) : removeCursorHooks(existing);
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, next);
  return path;
}

export function hasScopeLockHooks(config: Record<string, unknown>, target: AgentId): boolean {
  if (target === "claude") {
    const hooks = config.hooks as Record<string, unknown> | undefined;
    return Array.isArray(hooks?.PreToolUse) && hooks.PreToolUse.some(isOwnEntry);
  }
  if (target === "cursor") {
    return Array.isArray(config.afterFileEdit) && config.afterFileEdit.some(isOwnEntry);
  }
  return false;
}
