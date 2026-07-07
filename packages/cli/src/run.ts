/**
 * CLI exit-code contract (stable, relied upon by CI and agent hooks):
 *   0 - success / no violations
 *   1 - completed, violations found
 *   2 - execution error (bad input, not a repo, not implemented, ...)
 */
export type ExitCode = 0 | 1 | 2;

export type CommandResult = {
  data: unknown;
  human: string | null;
  exitCode: ExitCode;
};

import { formatZodError } from "@scopelock/core";

export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function statusFor(exitCode: ExitCode): "ok" | "violations" | "error" {
  if (exitCode === 0) return "ok";
  if (exitCode === 1) return "violations";
  return "error";
}

export async function run(
  action: () => Promise<CommandResult>,
  opts: { json: boolean },
): Promise<void> {
  try {
    const result = await action();
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ status: statusFor(result.exitCode), data: result.data })}\n`,
      );
    } else if (result.human !== null) {
      process.stdout.write(`${result.human}\n`);
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    const zodMessage = formatZodError(error);
    const code =
      error instanceof CliError
        ? error.code
        : zodMessage !== null
          ? "INVALID_INPUT"
          : "UNEXPECTED";
    const message =
      zodMessage ?? (error instanceof Error ? error.message : String(error));
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ status: "error", error: { code, message } })}\n`,
      );
    } else {
      process.stderr.write(`error [${code}]: ${message}\n`);
    }
    process.exitCode = 2;
  }
}
