import { Buffer } from "node:buffer";
import type { AgentId } from "../schemas/contract.js";

// Conservative enough for Windows' smaller command-line limit while leaving
// room for the executable, flags, environment expansion, and OS bookkeeping.
export const MAX_AGENT_PROMPT_BYTES = 24 * 1024;

export type AgentInvocationErrorCode = "UNSUPPORTED_TARGET" | "PROMPT_TOO_LARGE";

export class AgentInvocationError extends Error {
  readonly code: AgentInvocationErrorCode;

  constructor(code: AgentInvocationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function buildAgentCommand(target: AgentId, promptText: string): string[] {
  const promptBytes = Buffer.byteLength(promptText, "utf8");
  if (promptBytes > MAX_AGENT_PROMPT_BYTES) {
    throw new AgentInvocationError(
      "PROMPT_TOO_LARGE",
      `rendered prompt is ${promptBytes} bytes; maximum safe argv prompt is ${MAX_AGENT_PROMPT_BYTES} bytes`,
    );
  }
  if (target === "codex") return ["codex", "exec", promptText];
  if (target === "claude") {
    return [
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "Read,Glob,Grep,Edit,Write",
      "--allowedTools",
      "Read,Glob,Grep,Edit,Write",
      "--disallowedTools",
      "Bash",
      promptText,
    ];
  }
  throw new AgentInvocationError(
    "UNSUPPORTED_TARGET",
    "Cursor headless writes are available, but scoped pre-write denial is not live-verified; provide command manually or use an isolated worktree",
  );
}
