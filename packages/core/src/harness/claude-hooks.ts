export const DEFAULT_HOOK_COMMAND_PREFIX = "mindthediff";

/**
 * `commandPrefix` is how the shell should invoke MindTheDiff. The default
 * `mindthediff` assumes an installed binary on PATH; `hooks install --local`
 * passes an absolute `node "<abs>/index.js"` invocation so live hooks work
 * before the package is published.
 */
export function claudeScopeLockEntry(
  commandPrefix: string = DEFAULT_HOOK_COMMAND_PREFIX,
) {
  return {
    matcher: "Edit|Write|MultiEdit",
    hooks: [{ type: "command", command: `${commandPrefix} hook gate` }],
  };
}
