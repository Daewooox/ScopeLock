import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";
import { driftReportSchema, type DriftReport } from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

type ReportOptions = {
  out?: string;
  open?: boolean;
};

type Receipt = {
  schemaVersion?: unknown;
  planId?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  waves?: unknown;
  conflicts?: unknown;
  deferredTasks?: unknown;
  blockedByEnvironment?: unknown;
  environment?: { status?: unknown; mode?: unknown; violationsCount?: unknown } | null;
  handoffSummary?: {
    passedTasks?: unknown;
    failedTasks?: unknown;
    skippedTasks?: unknown;
    blockedTasks?: unknown;
    driftStatus?: unknown;
    environmentStatus?: unknown;
  };
  taskRuns?: unknown;
  drift?: { status?: unknown } | null;
  isolation?: {
    mode?: unknown;
    trustTier?: unknown;
    finalPromotion?: unknown;
    aggregatePatchSha256?: unknown;
    aggregatePatchBytes?: unknown;
    validationWorkspaceClean?: unknown;
    validationSetup?: { status?: unknown } | null;
    validation?: { status?: unknown } | null;
    cleanup?: { status?: unknown; remaining?: unknown };
  } | null;
};

async function readReportInput(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CliError("RECEIPT_NOT_FOUND", `file not found: ${path}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError("FILE_READ_ERROR", `cannot read ${path}: ${message}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CliError("INVALID_JSON", `invalid JSON in ${path}`);
  }
}

function renderDriftHtml(report: DriftReport, reportPath: string): string {
  const clean = report.violations.length === 0;
  const raw = JSON.stringify(report, null, 2);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScopeLock Drift Report - ${escapeHtml(report.contractId)}</title>
<style>
:root { color-scheme: light; --ink:#18202a; --muted:#637083; --line:#d9e1ea; --good:#127a52; --warn:#a86200; --bad:#b42318; --panel:#f7f9fb; }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); }
main { max-width:1040px; margin:0 auto; padding:32px 24px 48px; }
header { padding-bottom:24px; border-bottom:1px solid var(--line); }
.eyebrow { color:var(--muted); font-weight:700; text-transform:uppercase; font-size:12px; }
h1 { margin:8px 0 12px; font-size:40px; letter-spacing:0; }
.good { color:var(--good); } .warn { color:var(--warn); } .bad { color:var(--bad); }
.meta { color:var(--muted); overflow-wrap:anywhere; }
.grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:22px 0; }
.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
.stat strong { display:block; font-size:28px; margin-top:8px; }
section { margin-top:28px; } h2 { font-size:18px; }
table { width:100%; border-collapse:collapse; border:1px solid var(--line); }
th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
th { background:var(--panel); color:var(--muted); font-size:12px; text-transform:uppercase; }
pre { overflow:auto; background:#101820; color:#f4f7fb; border-radius:8px; padding:16px; max-height:460px; }
details { border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
summary { cursor:pointer; font-weight:700; }
@media (max-width:700px) { .grid { grid-template-columns:1fr; } main { padding:24px 16px 36px; } }
</style>
</head>
<body><main>
  <header>
    <div class="eyebrow">ScopeLock Drift Report</div>
    <h1>${escapeHtml(report.contractId)}: <span class="${clean ? "good" : "warn"}">${clean ? "Cleared" : "Attention"}</span></h1>
    <div class="meta">${escapeHtml(report.checkedAt)} · ${escapeHtml(reportPath)}</div>
  </header>
  <div class="grid">
    <div class="stat">Changed files<strong>${report.changedFiles.length}</strong></div>
    <div class="stat">Violations<strong class="${clean ? "good" : "bad"}">${report.violations.length}</strong></div>
    <div class="stat">Repository<strong class="${report.repoState.kind === "clean" ? "good" : "warn"}">${escapeHtml(report.repoState.kind)}</strong></div>
  </div>
  <section><h2>Violations</h2><table><thead><tr><th>Type</th><th>Path</th><th>Detail</th></tr></thead><tbody>
    ${report.violations.map((item) => `<tr><td class="bad">${escapeHtml(item.type)}</td><td>${escapeHtml(item.path ?? "-")}</td><td>${escapeHtml(item.message)}</td></tr>`).join("") || `<tr><td colspan="3" class="good">No violations.</td></tr>`}
  </tbody></table></section>
  <section><h2>Changed files</h2><table><thead><tr><th>Path</th><th>Status</th><th>Stage</th></tr></thead><tbody>
    ${report.changedFiles.map((file) => `<tr><td>${escapeHtml(file.path)}</td><td>${escapeHtml(file.status)}</td><td>${escapeHtml(file.stage)}</td></tr>`).join("") || `<tr><td colspan="3">No changed files.</td></tr>`}
  </tbody></table></section>
  <section><details><summary>Technical drift JSON</summary><pre>${escapeHtml(raw)}</pre></details></section>
</main></body></html>\n`;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function taskRows(receipt: Receipt): Array<{ id: string; status: string; duration: string; notes: string }> {
  if (!Array.isArray(receipt.taskRuns)) return [];
  return receipt.taskRuns.map((task) => {
    const item = task as {
      id?: unknown;
      status?: unknown;
      durationMs?: unknown;
      stderr?: unknown;
      isolation?: { outcome?: unknown; findings?: unknown };
    };
    const notes = [
      typeof item.isolation?.outcome === "string" ? `isolation: ${item.isolation.outcome}` : "",
      typeof item.stderr === "string" && item.stderr.length > 0 ? item.stderr : "",
    ].filter(Boolean).join("; ");
    return {
      id: typeof item.id === "string" ? item.id : "unknown",
      status: typeof item.status === "string" ? item.status : "unknown",
      duration: typeof item.durationMs === "number" ? `${Math.round(item.durationMs)}ms` : "-",
      notes,
    };
  });
}

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusClass(status: string): string {
  if (status === "passed" || status === "ok" || status === "pass") return "good";
  if (status === "failed" || status === "fail" || status === "error") return "bad";
  return "warn";
}

function renderHtml(receipt: Receipt, receiptPath: string): string {
  const summary = receipt.handoffSummary ?? {};
  const passed = arrayOfStrings(summary.passedTasks);
  const failed = arrayOfStrings(summary.failedTasks);
  const skipped = arrayOfStrings(summary.skippedTasks);
  const blocked = arrayOfStrings(summary.blockedTasks);
  const tasks = taskRows(receipt);
  const overall = failed.length > 0 || skipped.length > 0 || blocked.length > 0 || receipt.blockedByEnvironment === true ? "Attention" : "Cleared";
  const overallClass = overall === "Cleared" ? "good" : "warn";
  const waves = Array.isArray(receipt.waves) ? receipt.waves : [];
  const raw = JSON.stringify(receipt, null, 2);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScopeLock Flight Report - ${escapeHtml(receipt.planId ?? "receipt")}</title>
<style>
:root { color-scheme: light; --ink:#18202a; --muted:#637083; --line:#d9e1ea; --good:#127a52; --warn:#a86200; --bad:#b42318; --panel:#f7f9fb; --accent:#0f62fe; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #ffffff; }
main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 48px; }
.hero { display: grid; gap: 18px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
.eyebrow { color: var(--muted); font-weight: 700; text-transform: uppercase; font-size: 12px; }
h1 { margin: 0; font-size: clamp(30px, 5vw, 52px); line-height: 1.02; letter-spacing: 0; }
.meta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--muted); }
.pill { border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; background: #fff; }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 22px 0; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px; min-height: 92px; }
.stat strong { display: block; font-size: 28px; line-height: 1; margin-top: 10px; }
.good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }
section { margin-top: 28px; }
h2 { font-size: 18px; margin: 0 0 12px; }
.timeline { display: grid; gap: 10px; }
.wave { border-left: 3px solid var(--accent); padding: 9px 12px; background: var(--panel); border-radius: 0 8px 8px 0; }
table { width: 100%; border-collapse: collapse; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { background: var(--panel); color: var(--muted); font-size: 12px; text-transform: uppercase; }
tr:last-child td { border-bottom: 0; }
pre { overflow: auto; background: #101820; color: #f4f7fb; border-radius: 8px; padding: 16px; max-height: 460px; }
details { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
summary { cursor: pointer; font-weight: 700; }
@media (max-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } main { padding: 24px 16px 36px; } }
</style>
</head>
<body>
<main>
  <header class="hero">
    <div class="eyebrow">ScopeLock Flight Report</div>
    <h1>${escapeHtml(receipt.planId ?? "Unnamed plan")}: <span class="${overallClass}">${overall}</span></h1>
    <div class="meta">
      <span class="pill">receipt v${escapeHtml(receipt.schemaVersion ?? "?")}</span>
      <span class="pill">${escapeHtml(receipt.startedAt ?? "unknown")} - ${escapeHtml(receipt.finishedAt ?? "unknown")}</span>
      <span class="pill">${escapeHtml(receiptPath)}</span>
    </div>
  </header>
  <div class="grid">
    <div class="stat">Passed tasks<strong class="good">${passed.length}</strong></div>
    <div class="stat">Failed tasks<strong class="${failed.length > 0 ? "bad" : "good"}">${failed.length}</strong></div>
    <div class="stat">Skipped/blocked<strong class="${skipped.length + blocked.length > 0 ? "warn" : "good"}">${skipped.length + blocked.length}</strong></div>
    <div class="stat">Conflicts found<strong class="${count(receipt.conflicts) > 0 ? "warn" : "good"}">${count(receipt.conflicts)}</strong></div>
  </div>
  <section>
    <h2>Execution Sequence</h2>
    <div class="timeline">
      ${waves.map((wave, index) => `<div class="wave"><strong>Step ${index + 1}</strong>: ${escapeHtml(Array.isArray(wave) ? wave.join(", ") : String(wave))}</div>`).join("") || `<div class="wave">No execution sequence recorded.</div>`}
    </div>
  </section>
  <section>
    <h2>Safety Checks</h2>
    <table>
      <tbody>
        <tr><th>Environment</th><td class="${statusClass(String(receipt.environment?.status ?? summary.environmentStatus ?? "not_configured"))}">${escapeHtml(receipt.environment?.status ?? summary.environmentStatus ?? "not_configured")}</td></tr>
        <tr><th>Drift</th><td class="${statusClass(String(summary.driftStatus ?? receipt.drift?.status ?? "not_checked"))}">${escapeHtml(summary.driftStatus ?? receipt.drift?.status ?? "not_checked")}</td></tr>
        <tr><th>Isolation</th><td>${escapeHtml(receipt.isolation?.mode ?? "off")} / ${escapeHtml(receipt.isolation?.trustTier ?? "not_applicable")}</td></tr>
        <tr><th>Validation setup</th><td class="${statusClass(String(receipt.isolation?.validationSetup?.status ?? "not_applicable"))}">${escapeHtml(receipt.isolation?.validationSetup?.status ?? "not_applicable")}</td></tr>
        <tr><th>Repository validation</th><td class="${statusClass(String(receipt.isolation?.validation?.status ?? "not_applicable"))}">${escapeHtml(receipt.isolation?.validation?.status ?? "not_applicable")}</td></tr>
        <tr><th>Candidate unchanged by validation</th><td class="${statusClass(receipt.isolation?.validationWorkspaceClean === false ? "failed" : "ok")}">${escapeHtml(receipt.isolation?.validationWorkspaceClean === false ? "no" : "yes")}</td></tr>
        <tr><th>Final promotion</th><td class="${statusClass(String(receipt.isolation?.finalPromotion === "applied" || receipt.isolation?.finalPromotion === "no-changes" ? "ok" : receipt.isolation?.finalPromotion ?? "not_applicable"))}">${escapeHtml(receipt.isolation?.finalPromotion ?? "not_applicable")}</td></tr>
        <tr><th>Cleanup</th><td class="${statusClass(String(receipt.isolation?.cleanup?.status ?? "not_applicable"))}">${escapeHtml(receipt.isolation?.cleanup?.status ?? "not_applicable")}</td></tr>
        <tr><th>Deferred tasks</th><td>${escapeHtml(arrayOfStrings(receipt.deferredTasks).join(", ") || "none")}</td></tr>
      </tbody>
    </table>
  </section>
  <section>
    <h2>Tasks</h2>
    <table>
      <thead><tr><th>Task</th><th>Status</th><th>Duration</th><th>Notes</th></tr></thead>
      <tbody>
      ${tasks.map((task) => `<tr><td>${escapeHtml(task.id)}</td><td class="${statusClass(task.status)}">${escapeHtml(task.status)}</td><td>${escapeHtml(task.duration)}</td><td>${escapeHtml(task.notes || "-")}</td></tr>`).join("") || `<tr><td colspan="4">No task runs recorded.</td></tr>`}
      </tbody>
    </table>
  </section>
  <section>
    <details>
      <summary>Technical receipt JSON</summary>
      <pre>${escapeHtml(raw)}</pre>
    </details>
  </section>
</main>
</body>
</html>
`;
}

function defaultOutPath(receiptPath: string): string {
  return receiptPath.replace(/\.json$/i, ".html");
}

function openFile(path: string): void {
  const url = pathToFileURL(path).href;
  const command = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function reportCommand(
  path: string,
  options: ReportOptions = {},
  cwd: string = process.cwd(),
): Promise<CommandResult> {
  const receiptPath = isAbsolute(path) ? path : resolve(cwd, path);
  const input = await readReportInput(receiptPath);
  const drift = driftReportSchema.safeParse(input);
  const sourceType = drift.success ? "drift" : "receipt";
  const reportPath = options.out
    ? isAbsolute(options.out) ? options.out : resolve(cwd, options.out)
    : defaultOutPath(receiptPath);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    drift.success ? renderDriftHtml(drift.data, receiptPath) : renderHtml(input as Receipt, receiptPath),
    "utf8",
  );
  if (options.open === true) openFile(reportPath);
  return {
    data: { receiptPath, sourcePath: receiptPath, sourceType, reportPath, opened: options.open === true },
    human: renderSections([
      {
        title: "Result",
        lines: [
          `Flight Report  ${reportPath}`,
          `Browser        ${options.open === true ? "opened" : "not opened"}`,
        ],
      },
      {
        title: "Next",
        lines: options.open === true
          ? "Review the Flight Report"
          : `Open it: scopelock report ${JSON.stringify(path)} --open`,
      },
    ]),
    exitCode: 0,
  };
}
