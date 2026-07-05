import { DEFAULT_HOOK_COMMAND_PREFIX } from "./claude-hooks.js";

export function cursorScopeLockEntry(
  commandPrefix: string = DEFAULT_HOOK_COMMAND_PREFIX,
) {
  return {
    command: `${commandPrefix} hook audit`,
  };
}
