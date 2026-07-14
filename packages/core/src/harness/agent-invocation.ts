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

export function buildAgentCommand(
  target: AgentId,
  promptText: string,
  options: { isolationBound?: boolean } = {},
): string[] {
  const promptBytes = Buffer.byteLength(promptText, "utf8");
  if (promptBytes > MAX_AGENT_PROMPT_BYTES) {
    throw new AgentInvocationError(
      "PROMPT_TOO_LARGE",
      `rendered prompt is ${promptBytes} bytes; maximum safe argv prompt is ${MAX_AGENT_PROMPT_BYTES} bytes`,
    );
  }
  if (target === "codex") {
    return ["codex", "exec", "--sandbox", "workspace-write", promptText];
  }
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
      // `--disallowedTools` (like `--tools`/`--allowedTools`) is variadic in
      // the Claude CLI - without an explicit `--` terminator, it greedily
      // consumes the prompt text word-by-word as bogus tool names instead of
      // treating it as the positional prompt argument, and claude exits with
      // "Input must be provided either through stdin or as a prompt argument".
      // Reproduced and confirmed fixed locally against Claude Code 2.1.207.
      "--",
      promptText,
    ];
  }
  if (options.isolationBound === true) {
    return [
      "agent",
      "--print",
      "--output-format",
      "stream-json",
      "--sandbox",
      "enabled",
      "--trust",
      "--workspace",
      ".",
      "--",
      promptText,
    ];
  }
  throw new AgentInvocationError(
    "UNSUPPORTED_TARGET",
    "Cursor write commands require an isolation-bound plan",
  );
}
