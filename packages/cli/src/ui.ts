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

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function padAnsi(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - stripAnsi(value).length))}`;
}
