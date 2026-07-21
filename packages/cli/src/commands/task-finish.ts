import {
  classifyPath,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  scopelockPaths,
  type DriftReport,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections, renderStatusTable, type StatusRow } from "../ui.js";
import { checkDriftCommand } from "./check-drift.js";
import { reportCommand } from "./report.js";
import { createNoopReporter } from "../progress/noop-reporter.js";
import type { ProgressReporter } from "../progress/types.js";

type TaskFinishOptions = {
  out?: string;
  open?: boolean;
  cwd?: string;
  reporter?: ProgressReporter;
};

async function taskFinishWithReporter(
  options: TaskFinishOptions,
  reporter: ProgressReporter,
): Promise<CommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = findRepoRoot(cwd);
  if (root === null) throw new CliError("NOT_A_GIT_REPO", "task finish must run inside a git repository");

  const paths = scopelockPaths(root);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError("NO_ACTIVE_CONTRACT", "no active task; start one with `scopelock task start`");
  }
  const contract = await loadContract(paths, activeId);
  reporter.emit({ type: "phase", name: "checking-drift" });
  const checked = await checkDriftCommand({}, root);
  const { reportPath, report } = checked.data as { reportPath: string; report: DriftReport };
  reporter.emit({ type: "phase", name: "rendering-report" });
  const rendered = await reportCommand(reportPath, { out: options.out, open: options.open }, root);
  const htmlPath = (rendered.data as { reportPath: string }).reportPath;

  const groups = { planned: [] as string[], forbidden: [] as string[], outside: [] as string[] };
  for (const file of report.changedFiles) groups[classifyPath(file, contract.scope)].push(file.path);
  const highRisk = report.violations.filter((violation) => violation.type === "high_risk_file").length;
  const statusRows: StatusRow[] = [
    {
      id: "Allowed changes",
      status: "pass",
      cells: [String(groups.planned.length), groups.planned.join(", ") || "none"],
    },
    {
      id: "Blocked changes",
      status: groups.forbidden.length > 0 ? "fail" : "pass",
      cells: [String(groups.forbidden.length), groups.forbidden.join(", ") || "none"],
      reason: groups.forbidden.length > 0 ? "changes touched forbidden paths" : undefined,
    },
    {
      id: "Outside scope",
      status: groups.outside.length > 0 ? "warn" : "pass",
      cells: [String(groups.outside.length), groups.outside.join(", ") || "none"],
      reason: groups.outside.length > 0 ? "changes fell outside the approved scope" : undefined,
    },
    {
      id: "High risk",
      status: highRisk > 0 ? "fail" : "pass",
      cells: [String(highRisk), highRisk > 0 ? "review the drift report" : "none"],
      reason: highRisk > 0 ? "sensitive files changed" : undefined,
    },
  ];
  const table = renderStatusTable("Finding", ["Count", "Paths"], statusRows);
  const clean = report.violations.length === 0;

  return {
    data: {
      contractId: activeId,
      reportPath,
      htmlPath,
      opened: options.open === true,
      report,
      summary: {
        allowed: groups.planned.length,
        blocked: groups.forbidden.length,
        outside: groups.outside.length,
        highRisk,
      },
    },
    human: renderSections([
      { title: "Context", lines: `Task boundary  ${activeId}` },
      { title: "Checks", lines: [table, "Tests executed  no (ScopeLock checked contract evidence only)"] },
      {
        title: "Result",
        lines: [
          clean ? "Cleared" : `Attention required: ${report.violations.length} violation${report.violations.length === 1 ? "" : "s"}`,
          `Drift report  ${reportPath}`,
          `Flight Report ${htmlPath}`,
          `Browser       ${options.open === true ? "opened" : "not opened"}`,
        ],
      },
      {
        title: "Next",
        lines: clean
          ? "Review and commit the accepted changes"
          : "Fix unexpected changes, then run: scopelock task finish",
      },
    ]),
    exitCode: clean ? 0 : 1,
  };
}

export async function taskFinishCommand(
  options: TaskFinishOptions = {},
): Promise<CommandResult> {
  const reporter = options.reporter ?? createNoopReporter();
  try {
    return await taskFinishWithReporter(options, reporter);
  } finally {
    reporter.dispose();
  }
}
