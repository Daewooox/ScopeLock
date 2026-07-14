import { createInterface } from "node:readline/promises";
import { CliError } from "./run.js";

export async function confirmPrompt(message: string): Promise<boolean> {
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
    const answer = await readline.question(`${message}\nInstall now? [y/N] `, {
      signal: controller.signal,
    });
    return /^(y|yes)$/i.test(answer.trim());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new CliError("SETUP_CANCELLED", "setup cancelled before hook installation");
    }
    throw error;
  } finally {
    readline.off("SIGINT", cancel);
    readline.close();
  }
}
