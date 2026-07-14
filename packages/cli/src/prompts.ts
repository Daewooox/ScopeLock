import { createInterface } from "node:readline/promises";
import { CliError } from "./run.js";

type PromptOptions = {
  suffix?: string;
  cancellationCode?: string;
  cancellationMessage?: string;
};

async function ask(message: string, options: PromptOptions = {}): Promise<string> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new CliError(
      "INTERACTIVE_REQUIRED",
      "confirmation requires a terminal; pass the explicit non-interactive confirmation flag",
    );
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  readline.once("SIGINT", cancel);
  try {
    return await readline.question(`${message}\n${options.suffix ?? "Install now? [y/N] "}`, {
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CliError(
        options.cancellationCode ?? "SETUP_CANCELLED",
        options.cancellationMessage ?? "setup cancelled before hook installation",
      );
    }
    throw error;
  } finally {
    readline.off("SIGINT", cancel);
    readline.close();
  }
}

export async function confirmPrompt(message: string, options: PromptOptions = {}): Promise<boolean> {
  const answer = await ask(message, options);
  return /^(y|yes)$/i.test(answer.trim());
}

export function questionPrompt(message: string): Promise<string> {
  return ask(message, {
    suffix: "> ",
    cancellationCode: "TASK_START_CANCELLED",
    cancellationMessage: "task start cancelled before approval",
  });
}
