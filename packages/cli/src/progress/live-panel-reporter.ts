import {
  normalizeTerminalDetail,
  renderStatusTable,
  type StatusRow,
  type StatusRowStatus,
} from "../ui.js";
import type { CheckStatus, ProgressEvent, ProgressReporter, TaskStatus } from "./types.js";

export type Sink = { write(chunk: string): void };
export type LivePanelTimers = {
  setInterval(callback: () => void, delayMs: number): NodeJS.Timeout;
  clearInterval(timer: NodeJS.Timeout): void;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

type RowStatus = "pending" | "running" | TaskStatus | CheckStatus;

type Row = {
  key: string;
  id: string;
  label: string;
  group: string;
  status: RowStatus;
  durationMs?: number;
  skipReason?: string;
  reason?: string;
  logPath?: string;
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
  const duration = row.durationMs !== undefined ? ` ${formatSeconds(row.durationMs)}` : "";
  const detail = row.reason ?? row.skipReason;
  const detailSuffix = detail !== undefined ? ` — ${normalizeTerminalDetail(detail)}` : "";
  const logSuffix = row.logPath !== undefined
    ? ` (full log: ${normalizeTerminalDetail(row.logPath)})`
    : "";
  return `  ${glyph} ${row.label}     ${row.status}${duration}${detailSuffix}${logSuffix}`;
}

function settledStatus(status: RowStatus): StatusRowStatus {
  if (status === "passed") return "pass";
  if (status === "failed" || status === "blocked") return "fail";
  return "skip";
}

function statusPriority(status: RowStatus): number {
  if (status === "failed" || status === "blocked") return 0;
  if (status === "skipped" || status === "pending" || status === "running") return 1;
  return 2;
}

export function createLivePanelReporter(
  sink: Sink,
  timers: LivePanelTimers = { setInterval, clearInterval },
): ProgressReporter {
  const rows: Row[] = [];
  let linesDrawn = 0;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | null = null;
  let currentWave: number | null = null;
  let currentContext: string | null = null;
  let settled = false;

  const paint = (lines: string[]): void => {
    if (linesDrawn > 0) sink.write(`\u001b[${linesDrawn}A`);
    const lineCount = Math.max(linesDrawn, lines.length);
    for (let index = 0; index < lineCount; index += 1) {
      sink.write(`\u001b[2K${lines[index] ?? ""}\n`);
    }
    linesDrawn = lines.length;
  };

  const repaint = (): void => {
    const lines = [
      ...(currentContext !== null ? [currentContext] : []),
      ...rows.map((row) => renderRow(row, SPINNER_FRAMES[frameIndex] ?? "")),
    ];
    paint(lines);
  };

  const stopTimer = (): void => {
    if (timer === null) return;
    timers.clearInterval(timer);
    timer = null;
  };

  const ensureTimer = (): void => {
    const anyRunning = rows.some((row) => row.status === "running");
    if (anyRunning && timer === null) {
      timer = timers.setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        repaint();
      }, SPINNER_INTERVAL_MS);
      timer.unref();
    }
    if (!anyRunning) stopTimer();
  };

  const findOrCreate = (kind: "task" | "check", id: string, label: string, group: string): Row => {
    const key = `${kind}:${id}`;
    const existing = rows.find((row) => row.key === key);
    if (existing !== undefined) return existing;
    const created: Row = {
      key,
      id: normalizeTerminalDetail(id),
      label: normalizeTerminalDetail(label),
      group: normalizeTerminalDetail(group),
      status: "pending",
    };
    rows.push(created);
    return created;
  };

  const settleUnfinishedRows = (reason: string): void => {
    for (const row of rows) {
      if (row.status === "pending" || row.status === "running") {
        row.status = "skipped";
        row.reason = reason;
      }
    }
  };

  const finalRows = (): StatusRow[] =>
    rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) =>
        statusPriority(left.row.status) - statusPriority(right.row.status) || left.index - right.index,
      )
      .map(({ row }) => ({
        id: row.id,
        status: settledStatus(row.status),
        cells: [
          row.status,
          row.group,
          row.durationMs === undefined ? "-" : formatSeconds(row.durationMs),
        ],
        reason: row.reason ?? row.skipReason,
        logPath: row.logPath,
      }));

  const settle = (interrupted: boolean): void => {
    if (settled) return;
    settled = true;
    stopTimer();
    if (rows.length === 0) return;
    settleUnfinishedRows(interrupted ? "interrupted" : "run ended before completion");
    const table = renderStatusTable("Item", ["Result", "Group", "Time"], finalRows());
    paint(interrupted ? ["Interrupted", ...table.split("\n")] : table.split("\n"));
  };

  const emit = (event: ProgressEvent): void => {
    if (settled) return;
    switch (event.type) {
      case "wave-start": {
        currentWave = event.wave;
        currentContext = `Wave ${event.wave}/${event.totalWaves}`;
        for (const id of event.taskIds) findOrCreate("task", id, id, `wave ${event.wave}`);
        repaint();
        break;
      }
      case "task-start": {
        const row = findOrCreate(
          "task",
          event.id,
          event.id,
          currentWave === null ? "task" : `wave ${currentWave}`,
        );
        row.status = "running";
        ensureTimer();
        repaint();
        break;
      }
      case "task-done": {
        const row = findOrCreate(
          "task",
          event.id,
          event.id,
          event.wave !== undefined
            ? `wave ${event.wave}`
            : currentWave === null
              ? "task"
              : `wave ${currentWave}`,
        );
        row.status = event.status;
        row.durationMs = event.durationMs;
        row.reason = event.reason;
        row.logPath = event.logPath;
        ensureTimer();
        repaint();
        break;
      }
      case "check-start": {
        const row = findOrCreate(
          "check",
          event.id,
          event.required ? event.id : `${event.id} (optional)`,
          event.required ? "validation required" : "validation optional",
        );
        row.status = "running";
        ensureTimer();
        repaint();
        break;
      }
      case "check-done": {
        const row = findOrCreate("check", event.id, event.id, "validation");
        row.status = event.status;
        row.durationMs = event.durationMs;
        row.skipReason = event.skipReason;
        row.reason = event.reason;
        row.logPath = event.logPath;
        ensureTimer();
        repaint();
        break;
      }
      case "phase": {
        currentContext = event.name;
        repaint();
        break;
      }
      case "step": {
        currentContext = `Step ${event.index} of ${event.total} — ${normalizeTerminalDetail(event.label)}`;
        repaint();
        break;
      }
      case "interrupted": {
        settle(true);
        break;
      }
    }
  };

  return {
    emit,
    dispose(): void {
      settle(false);
    },
  };
}
