import type { ProgressEvent, ProgressReporter } from "./types.js";
import { normalizeTerminalDetail } from "../ui.js";

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function waveLabel(wave: number | null): string {
  return wave === null ? "[task]" : `[wave ${wave}]`;
}

function formatEvidence(reason?: string, logPath?: string): string {
  const detail = reason !== undefined ? ` — ${normalizeTerminalDetail(reason)}` : "";
  const log = logPath !== undefined
    ? `${reason !== undefined ? " " : " — "}(full log: ${normalizeTerminalDetail(logPath)})`
    : "";
  return `${detail}${log}`;
}

export function createLineReporter(write: (line: string) => void): ProgressReporter {
  let currentWave: number | null = null;
  const taskWaves = new Map<string, number>();

  const emit = (event: ProgressEvent): void => {
    switch (event.type) {
      case "wave-start":
        currentWave = event.wave;
        for (const id of event.taskIds) taskWaves.set(id, event.wave);
        write(
          `[wave ${event.wave}/${event.totalWaves}] starting: `
          + event.taskIds.map(normalizeTerminalDetail).join(", "),
        );
        return;
      case "task-start":
        write(`${waveLabel(currentWave)} ${normalizeTerminalDetail(event.id)}: running`);
        return;
      case "task-done":
        write(
          `${waveLabel(event.wave ?? taskWaves.get(event.id) ?? currentWave)} `
          + `${normalizeTerminalDetail(event.id)}: `
          + `${event.status} (${formatSeconds(event.durationMs)})`
          + formatEvidence(event.reason, event.logPath)
          + (event.updated === true ? " (updated)" : ""),
        );
        return;
      case "check-start":
        write(
          `[validation] ${normalizeTerminalDetail(event.id)}: `
          + `running${event.required ? "" : " (optional)"}`,
        );
        return;
      case "check-done":
        write(
          `[validation] ${normalizeTerminalDetail(event.id)}: `
          + `${event.status} (${formatSeconds(event.durationMs)})`
          + formatEvidence(event.reason ?? event.skipReason, event.logPath)
          + (event.updated === true ? " (updated)" : ""),
        );
        return;
      case "phase":
        write(`[phase] ${event.name}`);
        return;
      case "step":
        write(`Step ${event.index} of ${event.total} — ${normalizeTerminalDetail(event.label)}`);
        return;
      case "interrupted":
        write("interrupted");
        return;
    }
  };

  return { emit, dispose(): void {} };
}
