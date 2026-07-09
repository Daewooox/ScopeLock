import {
  buildDriftReport,
  collectChangedFiles,
  commitExists,
  driftReportFileName,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  scopelockConfigSchema,
  scopelockPaths,
  writeJsonAtomic,
} from "@scopelock/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError, type CommandResult } from "../run.js";

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

function humanReport(report: {
  violations: { type: string; message: string }[];
}) {
  if (report.violations.length === 0) {
    return "no drift detected";
  }
  const byType = new Map<string, string[]>();
  for (const violation of report.violations) {
    byType.set(violation.type, [
      ...(byType.get(violation.type) ?? []),
      violation.message,
    ]);
  }
  return [...byType.entries()]
    .map(
      ([type, messages]) =>
        `${type}\n${messages.map((m) => `  - ${m}`).join("\n")}`,
    )
    .join("\n");
}

export async function checkDriftCommand(options: {
  base?: string;
} = {}): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "check-drift must run inside a git repository",
    );
  }

  const paths = scopelockPaths(root);
  const config = await loadConfig(paths);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError(
      "NO_ACTIVE_CONTRACT",
      "no active approved contract; approve one with `scopelock approve <file>`",
    );
  }

  const contract = await loadContract(paths, activeId);
  const baselineSha = options.base ?? contract.baseline?.headSha ?? null;
  if (baselineSha === null) {
    throw new CliError(
      "NO_BASELINE",
      "active contract has no baseline; approve it with `scopelock approve <file>`",
    );
  }

  // Catch a stale baseline (e.g. the commit was dropped by a history rewrite)
  // here, with an actionable message, instead of letting `git diff` fail with
  // a raw fatal that would surface as an opaque UNEXPECTED error.
  if (!commitExists(root, baselineSha)) {
    throw new CliError(
      "BASELINE_NOT_FOUND",
      `baseline commit ${baselineSha} not found (history rewritten?); re-run \`scopelock approve <file>\` to re-baseline`,
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
    human: humanReport(report),
    exitCode: report.violations.length > 0 ? 1 : 0,
  };
}
