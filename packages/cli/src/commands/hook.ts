import { evaluateHookGate } from "@scopelock/core";

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function hookGateCommand(options: {
  forceAudit?: boolean;
} = {}): Promise<void> {
  const result = await evaluateHookGate({
    cwd: process.cwd(),
    rawInput: await readStdin(),
    forceAudit: options.forceAudit,
  });

  if (result.decision === "deny") {
    process.stderr.write(`${result.message ?? "ScopeLock: denied"}\n`);
    process.exitCode = 2;
    return;
  }

  process.exitCode = 0;
}
