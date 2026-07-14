import {
  classifyPath,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  scopelockPaths,
  type DriftReport,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections, renderTable } from "../ui.js";
import { checkDriftCommand } from "./check-drift.js";
import { reportCommand } from "./report.js";

export async function taskFinishCommand(options: {
  out?: string;
  open?: boolean;
  cwd?: string;
} = {}): Promise<CommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = findRepoRoot(cwd);
  if (root === null) throw new CliError("NOT_A_GIT_REPO", "task finish must run inside a git repository");

  const paths = scopelockPaths(root);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError("NO_ACTIVE_CONTRACT", "no active task; start one with `scopelock task start`");
  }
  const contract = await loadContract(paths, activeId);
  const checked = await checkDriftCommand({}, root);
  const { reportPath, report } = checked.data as { reportPath: string; report: DriftReport };
  const rendered = await reportCommand(reportPath, { out: options.out, open: options.open }, root);
  const htmlPath = (rendered.data as { reportPath: string }).reportPath;

  const groups = { planned: [] as string[], forbidden: [] as string[], outside: [] as string[] };
  for (const file of report.changedFiles) groups[classifyPath(file, contract.scope)].push(file.path);
  const highRisk = report.violations.filter((violation) => violation.type === "high_risk_file").length;
  const table = renderTable(
    ["Finding", "Count", "Paths"],
    [
      ["Allowed changes", String(groups.planned.length), groups.planned.join(", ") || "none"],
      ["Blocked changes", String(groups.forbidden.length), groups.forbidden.join(", ") || "none"],
      ["Outside scope", String(groups.outside.length), groups.outside.join(", ") || "none"],
      ["High risk", String(highRisk), highRisk > 0 ? "review the drift report" : "none"],
    ],
  );
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
