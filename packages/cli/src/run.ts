/**
 * CLI exit-code contract (stable, relied upon by CI and agent hooks):
 *   0 - success / no violations
 *   1 - completed, violations found
 *   2 - execution error (bad input, not a repo, not implemented, ...)
 */
export type ExitCode = 0 | 1 | 2;

export type SuggestedNext = {
  /** Shown before the confirmation prompt, e.g. "Verify current changes". */
  label: string;
  /** Exact argv to spawn, e.g. ["check-drift"] or ["report", "--open", path]. */
  argv: string[];
};

export type CommandResult = {
  data: unknown;
  human: string | null;
  exitCode: ExitCode;
  suggestedNext?: SuggestedNext;
};

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatZodError } from "@scopelock/core";
import { confirmPrompt, type PromptOptions } from "./prompts.js";

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

/** Spawns the built CLI itself as a real child process (stdio inherited),
 *  so an auto-run suggested command behaves exactly like the user typing
 *  it - not a special in-process shortcut with different behavior. */
async function spawnBuiltCli(argv: string[]): Promise<ExitCode> {
  const cliEntry = join(dirname(fileURLToPath(import.meta.url)), "index.js");
  return await new Promise<ExitCode>((resolve) => {
    const child = spawn(process.execPath, [cliEntry, ...argv], { stdio: "inherit" });
    child.on("error", () => resolve(2));
    child.on("exit", (code) => {
      resolve(code === 0 ? 0 : code === 1 ? 1 : 2);
    });
  });
}

export type NextCommandDependencies = {
  confirm?: (message: string, options: PromptOptions) => Promise<boolean>;
  spawnNext?: (argv: string[]) => Promise<ExitCode>;
};

export async function run(
  action: () => Promise<CommandResult>,
  opts: { json: boolean },
  deps: NextCommandDependencies = {},
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

    if (
      !opts.json
      && result.suggestedNext !== undefined
      && process.stdin.isTTY === true
      && process.stdout.isTTY === true
      && process.env.CI !== "true"
    ) {
      const confirm = deps.confirm ?? confirmPrompt;
      const spawnNext = deps.spawnNext ?? spawnBuiltCli;
      let accepted = false;
      try {
        accepted = await confirm(
          `Run it now? scopelock ${result.suggestedNext.argv.join(" ")}`,
          { suffix: "[Y/n] ", defaultYes: true },
        );
      } catch {
        accepted = false;
      }
      if (accepted) {
        process.exitCode = await spawnNext(result.suggestedNext.argv);
        return;
      }
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
