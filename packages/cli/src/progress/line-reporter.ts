import type { ProgressEvent, ProgressReporter } from "./types.js";

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function waveLabel(wave: number | null): string {
  return wave === null ? "[task]" : `[wave ${wave}]`;
}

export function createLineReporter(write: (line: string) => void): ProgressReporter {
  let currentWave: number | null = null;

  const emit = (event: ProgressEvent): void => {
    switch (event.type) {
      case "wave-start":
        currentWave = event.wave;
        write(`[wave ${event.wave}/${event.totalWaves}] starting: ${event.taskIds.join(", ")}`);
        return;
      case "task-start":
        write(`${waveLabel(currentWave)} ${event.id}: running`);
        return;
      case "task-done":
        write(`${waveLabel(currentWave)} ${event.id}: ${event.status} (${formatSeconds(event.durationMs)})`);
        return;
      case "check-start":
        write(`[validation] ${event.id}: running${event.required ? "" : " (optional)"}`);
        return;
      case "check-done":
        write(
          `[validation] ${event.id}: ${event.status} (${formatSeconds(event.durationMs)})`
          + (event.skipReason !== undefined ? ` — ${event.skipReason}` : ""),
        );
        return;
      case "phase":
        write(`[phase] ${event.name}`);
        return;
      case "step":
        write(`Step ${event.index} of ${event.total} — ${event.label}`);
        return;
      case "interrupted":
        write("interrupted");
        return;
    }
  };

  return { emit, dispose(): void {} };
}
