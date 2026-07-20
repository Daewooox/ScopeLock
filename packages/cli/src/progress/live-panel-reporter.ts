import type { CheckStatus, ProgressEvent, ProgressReporter, TaskStatus } from "./types.js";

export type Sink = { write(chunk: string): void };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

type RowStatus = "pending" | "running" | TaskStatus | CheckStatus;

type Row = {
  id: string;
  label: string;
  status: RowStatus;
  durationMs?: number;
  skipReason?: string;
};

function formatSeconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function rowGlyph(status: RowStatus, frame: string): string {
  if (status === "pending") return "·";
  if (status === "running") return frame;
  if (status === "passed") return "✓";
  if (status === "failed") return "✗";
  if (status === "blocked") return "!";
  return "○"; // skipped
}

function renderRow(row: Row, frame: string): string {
  const glyph = rowGlyph(row.status, frame);
  const state = row.status === "pending" || row.status === "running" ? row.status : row.status;
  const duration = row.durationMs !== undefined ? ` ${formatSeconds(row.durationMs)}` : "";
  const detail = row.skipReason !== undefined ? ` — ${row.skipReason}` : "";
  return `  ${glyph} ${row.label}     ${state}${duration}${detail}`;
}

export function createLivePanelReporter(sink: Sink): ProgressReporter {
  let rows: Row[] = [];
  let linesDrawn = 0;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | null = null;

  const repaint = (): void => {
    if (linesDrawn > 0) sink.write(`\u001b[${linesDrawn}A`);
    for (const row of rows) {
      sink.write(`\u001b[2K${renderRow(row, SPINNER_FRAMES[frameIndex] ?? "")}\n`);
    }
    linesDrawn = rows.length;
  };

  const ensureTimer = (): void => {
    const anyRunning = rows.some((row) => row.status === "running");
    if (anyRunning && timer === null) {
      timer = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        repaint();
      }, SPINNER_INTERVAL_MS);
      timer.unref();
    }
    if (!anyRunning && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const findOrCreate = (id: string, label: string): Row => {
    const existing = rows.find((row) => row.id === id);
    if (existing !== undefined) return existing;
    const created: Row = { id, label, status: "pending" };
    rows.push(created);
    return created;
  };

  const flush = (): void => {
    repaint();
    rows = [];
    linesDrawn = 0;
  };

  const emit = (event: ProgressEvent): void => {
    switch (event.type) {
      case "wave-start": {
        flush();
        sink.write(`Wave ${event.wave}/${event.totalWaves}\n`);
        for (const id of event.taskIds) findOrCreate(id, id);
        repaint();
        break;
      }
      case "task-start": {
        const row = findOrCreate(event.id, event.id);
        row.status = "running";
        ensureTimer();
        repaint();
        break;
      }
      case "task-done": {
        const row = findOrCreate(event.id, event.id);
        row.status = event.status;
        row.durationMs = event.durationMs;
        ensureTimer();
        repaint();
        break;
      }
      case "check-start": {
        const row = findOrCreate(event.id, event.required ? event.id : `${event.id} (optional)`);
        row.status = "running";
        ensureTimer();
        repaint();
        break;
      }
      case "check-done": {
        const row = findOrCreate(event.id, event.id);
        row.status = event.status;
        row.durationMs = event.durationMs;
        row.skipReason = event.skipReason;
        ensureTimer();
        repaint();
        break;
      }
      case "phase": {
        flush();
        sink.write(`${event.name}\n`);
        break;
      }
      case "step": {
        flush();
        sink.write(`Step ${event.index} of ${event.total} — ${event.label}\n`);
        break;
      }
      case "interrupted": {
        flush();
        sink.write("interrupted\n");
        break;
      }
    }
  };

  return {
    emit,
    dispose(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      flush();
    },
  };
}
