const supportsColor =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined && process.env.CI !== "true";

const codes = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  cyan: "\u001b[36m",
};

export function color(value: string, tone: keyof typeof codes): string {
  if (!supportsColor || tone === "reset") return value;
  return `${codes[tone]}${value}${codes.reset}`;
}

export function statusLabel(status: "pass" | "warn" | "fail" | "skip"): string {
  if (status === "pass") return color("PASS", "green");
  if (status === "warn") return color("WARN", "yellow");
  if (status === "fail") return color("FAIL", "red");
  return color("SKIP", "dim");
}

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(row[index] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => padAnsi(cell, widths[index] ?? 0)).join("  ");
  return [line(headers.map((header) => color(header, "dim"))), ...rows.map(line)].join("\n");
}

export type HumanSection = {
  title: string;
  lines: string | string[];
};

export function renderSections(sections: HumanSection[]): string {
  return sections
    .filter((section) => (Array.isArray(section.lines) ? section.lines.length > 0 : section.lines.length > 0))
    .map((section) => {
      const lines = Array.isArray(section.lines) ? section.lines : section.lines.split("\n");
      return [color(section.title, "cyan"), ...lines.map((line) => `  ${line}`)].join("\n");
    })
    .join("\n\n");
}

export type StatusRowStatus = "pass" | "warn" | "fail" | "skip";

export type StatusRow = {
  id: string;
  status: StatusRowStatus;
  cells: string[];
  reason?: string;
  logPath?: string;
};

const REASON_TRUNCATE_LENGTH = 100;

export function normalizeTerminalDetail(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
    .replace(/\p{Cf}/gu, "")
    .trim();
}

export function renderStatusTable(idHeader: string, restHeaders: string[], rows: StatusRow[]): string {
  const headers = [idHeader, "Status", ...restHeaders];
  const cellsFor = (row: StatusRow): string[] => [
    normalizeTerminalDetail(row.id),
    statusLabel(row.status),
    ...row.cells.map(normalizeTerminalDetail),
  ];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(cellsFor(row)[index] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, index) => padAnsi(cell, widths[index] ?? 0)).join("  ");
  const headerLine = line(headers.map((header) => color(header, "dim")));
  const rowLines = rows.flatMap((row) => {
    const cells = cellsFor(row);
    const rendered = row.status === "pass" ? [line(cells.map((cell) => color(cell, "dim")))] : [line(cells)];
    if (row.status !== "pass" && row.reason !== undefined) {
      const normalizedReason = normalizeTerminalDetail(row.reason);
      const reasonCodePoints = Array.from(normalizedReason);
      const truncated = reasonCodePoints.length > REASON_TRUNCATE_LENGTH
        ? `${reasonCodePoints.slice(0, REASON_TRUNCATE_LENGTH).join("")}…`
        : normalizedReason;
      const logSuffix = row.logPath !== undefined
        ? ` (full log: ${normalizeTerminalDetail(row.logPath)})`
        : "";
      rendered.push(color(`    ↳ ${truncated}${logSuffix}`, "dim"));
    }
    return rendered;
  });
  return [headerLine, ...rowLines].join("\n");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function padAnsi(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - stripAnsi(value).length))}`;
}
