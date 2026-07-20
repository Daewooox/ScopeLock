import type { ProgressReporter } from "./types.js";

export function createNoopReporter(): ProgressReporter {
  return {
    emit(): void {},
    dispose(): void {},
  };
}
