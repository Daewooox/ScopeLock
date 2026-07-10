import { evaluateHookGate } from "@scopelock/core";

export async function readStdin(): Promise<string> {
  // Hooks always receive a piped, closed stdin. When invoked manually in a
  // terminal there is no payload; reading would block forever, so bail out
  // and let the gate treat it as invalid input (noop).
  if (process.stdin.isTTY === true) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function hookGateCommand(options: {
  forceAudit?: boolean;
  format?: "plain" | "codex";
} = {}): Promise<void> {
  const result = await evaluateHookGate({
    cwd: process.cwd(),
    rawInput: await readStdin(),
    forceAudit: options.forceAudit,
  });

  if (result.decision === "deny") {
    if (options.format === "codex") {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: result.message ?? "ScopeLock: denied",
          },
        })}\n`,
      );
      process.exitCode = 0;
      return;
    }
    process.stderr.write(`${result.message ?? "ScopeLock: denied"}\n`);
    process.exitCode = 2;
    return;
  }

  process.exitCode = 0;
}
