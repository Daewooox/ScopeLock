import { DEFAULT_HOOK_COMMAND_PREFIX } from "./claude-hooks.js";

export function codexScopeLockEntry(
  commandPrefix: string = DEFAULT_HOOK_COMMAND_PREFIX,
) {
  return {
    matcher: "^apply_patch$",
    hooks: [
      {
        type: "command",
        command: `${commandPrefix} hook gate --format codex`,
      },
    ],
  };
}
