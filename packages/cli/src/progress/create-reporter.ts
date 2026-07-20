import { createLineReporter } from "./line-reporter.js";
import { createLivePanelReporter, type Sink } from "./live-panel-reporter.js";
import { createNoopReporter } from "./noop-reporter.js";
import type { ProgressReporter } from "./types.js";

export type ReporterStream = Sink & { isTTY?: boolean };

export function createReporter(stream: ReporterStream, options: { json: boolean }): ProgressReporter {
  if (options.json) return createNoopReporter();
  if (stream.isTTY === true && process.env.CI !== "true") return createLivePanelReporter(stream);
  return createLineReporter((line) => stream.write(`${line}\n`));
}
