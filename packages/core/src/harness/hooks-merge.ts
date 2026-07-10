import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { AgentId } from "../schemas/contract.js";
import { writeJsonAtomic } from "../storage/atomic.js";
import { claudeScopeLockEntry } from "./claude-hooks.js";
import { codexScopeLockEntry } from "./codex-hooks.js";
import { cursorScopeLockEntry } from "./cursor-hooks.js";

export class HooksFileInvalidError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function isOwnEntry(value: unknown): boolean {
  // Detect entries by the ScopeLock subcommand rather than the "scopelock"
  // binary name, so `--local` absolute-path invocations
  // (`node "<abs>/index.js" hook gate`) are still recognised on uninstall.
  const serialized = JSON.stringify(value);
  return serialized.includes("hook gate") || serialized.includes("hook audit");
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

export function mergeClaudeHooks(
  existing: Record<string, unknown>,
  commandPrefix?: string,
): Record<string, unknown> {
  const hooks =
    typeof existing.hooks === "object" && existing.hooks !== null && !Array.isArray(existing.hooks)
      ? { ...(existing.hooks as Record<string, unknown>) }
      : {};
  const preToolUse = withoutOwnEntries(hooks.PreToolUse);
  return {
    ...existing,
    hooks: {
      ...hooks,
      PreToolUse: [...preToolUse, claudeScopeLockEntry(commandPrefix)],
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

export function mergeCursorHooks(
  existing: Record<string, unknown>,
  commandPrefix?: string,
): Record<string, unknown> {
  const afterFileEdit = withoutOwnEntries(existing.afterFileEdit);
  return {
    ...existing,
    afterFileEdit: [...afterFileEdit, cursorScopeLockEntry(commandPrefix)],
  };
}

export function removeCursorHooks(existing: Record<string, unknown>): Record<string, unknown> {
  return {
    ...existing,
    afterFileEdit: withoutOwnEntries(existing.afterFileEdit),
  };
}

function codexHooks(existing: Record<string, unknown>): Record<string, unknown> {
  return typeof existing.hooks === "object" && existing.hooks !== null && !Array.isArray(existing.hooks)
    ? { ...(existing.hooks as Record<string, unknown>) }
    : {};
}

export function mergeCodexHooks(
  existing: Record<string, unknown>,
  commandPrefix?: string,
): Record<string, unknown> {
  const hooks = codexHooks(existing);
  const preToolUse = withoutOwnEntries(hooks.PreToolUse);
  return {
    ...existing,
    hooks: {
      ...hooks,
      PreToolUse: [...preToolUse, codexScopeLockEntry(commandPrefix)],
    },
  };
}

export function removeCodexHooks(existing: Record<string, unknown>): Record<string, unknown> {
  const hooks = codexHooks(existing);
  return {
    ...existing,
    hooks: {
      ...hooks,
      PreToolUse: withoutOwnEntries(hooks.PreToolUse),
    },
  };
}

export function hooksConfigPath(root: string, target: AgentId): string {
  if (target === "claude") return resolve(root, ".claude", "settings.json");
  if (target === "cursor") return resolve(root, ".cursor", "hooks.json");
  if (target === "codex") return resolve(root, ".codex", "hooks.json");
  throw new HooksFileInvalidError("unsupported hook target");
}

export async function installHooks(
  root: string,
  target: AgentId,
  commandPrefix?: string,
): Promise<string> {
  const path = hooksConfigPath(root, target);
  const existing = await readJsonObject(path);
  const next =
    target === "claude"
      ? mergeClaudeHooks(existing, commandPrefix)
      : target === "cursor"
        ? mergeCursorHooks(existing, commandPrefix)
        : mergeCodexHooks(existing, commandPrefix);
  await mkdir(dirname(path), { recursive: true });
  await writeJsonAtomic(path, next);
  return path;
}

export async function uninstallHooks(root: string, target: AgentId): Promise<string> {
  const path = hooksConfigPath(root, target);
  const existing = await readJsonObject(path);
  const next =
    target === "claude"
      ? removeClaudeHooks(existing)
      : target === "cursor"
        ? removeCursorHooks(existing)
        : removeCodexHooks(existing);
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
  if (target === "codex") {
    const hooks = config.hooks as Record<string, unknown> | undefined;
    return Array.isArray(hooks?.PreToolUse) && hooks.PreToolUse.some(isOwnEntry);
  }
  return false;
}
