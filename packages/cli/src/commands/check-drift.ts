import {
  buildDriftReport,
  buildMultiContractDriftReport,
  collectChangedFiles,
  commitExists,
  driftReportFileName,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  scopelockConfigSchema,
  scopelockPaths,
  writeJsonAtomic,
  verifyApprovalSeal,
  type ApprovedContract,
} from "@scopelock/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

async function loadConfig(paths: ReturnType<typeof scopelockPaths>) {
  try {
    const raw = await readFile(paths.configPath, "utf8");
    return scopelockConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return scopelockConfigSchema.parse({ schemaVersion: 1 });
    }
    throw error;
  }
}

function humanReport(contractIds: string[], reportPath: string, report: {
  violations: { type: string; message: string }[];
}) {
  const byType = new Map<string, string[]>();
  for (const violation of report.violations) {
    byType.set(violation.type, [
      ...(byType.get(violation.type) ?? []),
      violation.message,
    ]);
  }
  const violations = [...byType.entries()]
    .map(
      ([type, messages]) =>
        `${type}\n${messages.map((m) => `  - ${m}`).join("\n")}`,
    )
    .join("\n");
  const clean = report.violations.length === 0;
  return renderSections([
    {
      title: "Context",
      lines: contractIds.length > 1
        ? `Task boundaries  ${contractIds.join(", ")}`
        : `Task boundary  ${contractIds[0]}`,
    },
    { title: "Checks", lines: clean ? "No drift detected" : violations },
    {
      title: "Result",
      lines: [
        clean ? "Cleared" : `Attention required: ${report.violations.length} violation${report.violations.length === 1 ? "" : "s"}`,
        `Drift report  ${reportPath}`,
      ],
    },
    {
      title: "Next",
      lines: clean
        ? "Review and commit the accepted changes"
        : "Review the report and revert or approve the unexpected changes",
    },
  ]);
}

async function checkDriftMultiContract(
  root: string,
  paths: ReturnType<typeof scopelockPaths>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  contractIds: string[],
  base: string | undefined,
): Promise<CommandResult> {
  const contracts: ApprovedContract[] = [];
  for (const id of contractIds) {
    const contract = await loadContract(paths, id);
    const seal = await verifyApprovalSeal(root, contract);
    if (!seal.ok) {
      throw new CliError("APPROVAL_INTEGRITY_ERROR", seal.detail);
    }
    contracts.push(contract);
  }

  const baselineShas = new Set(contracts.map((contract) => contract.baseline?.headSha ?? null));
  if (baselineShas.size > 1) {
    const pairs = contracts
      .map((contract) => `${contract.id}: ${contract.baseline?.headSha ?? "none"}`)
      .join(", ");
    throw new CliError(
      "CONTRACT_BASELINE_MISMATCH",
      `contracts do not share a baseline (${pairs}); run \`scopelock contract rebaseline\` to re-anchor them to the same commit`,
    );
  }
  const baselineSha = base ?? contracts[0].baseline?.headSha ?? null;
  if (baselineSha === null) {
    throw new CliError(
      "NO_BASELINE",
      "active contracts have no baseline; approve them with `scopelock contract approve <file>`",
    );
  }

  if (!commitExists(root, baselineSha)) {
    throw new CliError(
      "BASELINE_NOT_FOUND",
      `baseline commit ${baselineSha} not found (history rewritten?); run \`scopelock contract rebaseline\` to re-anchor it to the current commit`,
    );
  }

  const collected = await collectChangedFiles(root, baselineSha, {
    degradedThreshold: config.degradedFileThreshold,
  });
  const checkedAt = new Date().toISOString();
  const report = buildMultiContractDriftReport({
    contracts,
    files: collected.files,
    repoState: collected.repoState,
    repoMode: collected.repoMode,
    projectTypes: config.projectTypes,
    checkedAt,
  });
  const reportPath = join(paths.reportsDir, driftReportFileName(checkedAt));
  await writeJsonAtomic(reportPath, report);

  return {
    data: { reportPath, report },
    human: humanReport(report.contractIds ?? [report.contractId], reportPath, report),
    exitCode: report.violations.length > 0 ? 1 : 0,
  };
}

export async function checkDriftCommand(options: {
  base?: string;
  contractIds?: string[];
} = {}, cwd: string = process.cwd()): Promise<CommandResult> {
  const root = findRepoRoot(cwd);
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "check-drift must run inside a git repository",
    );
  }

  const paths = scopelockPaths(root);
  const config = await loadConfig(paths);

  if (options.contractIds !== undefined && options.contractIds.length > 0) {
    return checkDriftMultiContract(root, paths, config, options.contractIds, options.base);
  }

  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError(
      "NO_ACTIVE_CONTRACT",
      "no active approved contract; approve one with `scopelock contract approve <file>`",
    );
  }

  const contract = await loadContract(paths, activeId);
  const seal = await verifyApprovalSeal(root, contract);
  if (!seal.ok) {
    throw new CliError("APPROVAL_INTEGRITY_ERROR", seal.detail);
  }
  const baselineSha = options.base ?? contract.baseline?.headSha ?? null;
  if (baselineSha === null) {
    throw new CliError(
      "NO_BASELINE",
      "active contract has no baseline; approve it with `scopelock contract approve <file>`",
    );
  }

  // Catch a stale baseline (e.g. the commit was dropped by a history rewrite)
  // here, with an actionable message, instead of letting `git diff` fail with
  // a raw fatal that would surface as an opaque UNEXPECTED error.
  if (!commitExists(root, baselineSha)) {
    throw new CliError(
      "BASELINE_NOT_FOUND",
      `baseline commit ${baselineSha} not found (history rewritten?); run \`scopelock contract rebaseline\` to re-anchor it to the current commit`,
    );
  }

  const collected = await collectChangedFiles(root, baselineSha, {
    degradedThreshold: config.degradedFileThreshold,
  });
  const checkedAt = new Date().toISOString();
  const report = buildDriftReport({
    contract,
    files: collected.files,
    repoState: collected.repoState,
    repoMode: collected.repoMode,
    projectTypes: config.projectTypes,
    checkedAt,
  });
  const reportPath = join(paths.reportsDir, driftReportFileName(checkedAt));
  await writeJsonAtomic(reportPath, report);

  return {
    data: { reportPath, report },
    human: humanReport([activeId], reportPath, report),
    exitCode: report.violations.length > 0 ? 1 : 0,
  };
}
