import type { ApprovedContract } from "../schemas/contract.js";
import type { ProjectType } from "../schemas/repo-manifest.js";
import type {
  ChangedFile,
  DriftReport,
  DriftViolation,
  RepoMode,
  RepoState,
} from "../schemas/drift.js";
import { DRIFT_REPORT_SCHEMA_VERSION } from "../schemas/drift.js";
import { classifyPath } from "../rules/path-rules.js";
import { highRiskViolations } from "../rules/risk-rules.js";
import { missingTestsViolation } from "../rules/test-heuristics.js";

export function buildDriftReport(input: {
  contract: ApprovedContract;
  files: ChangedFile[];
  repoState: RepoState;
  repoMode: RepoMode;
  extraHighRiskPatterns?: string[];
  projectTypes?: ProjectType[];
  checkedAt: string;
}): DriftReport {
  const violations: DriftViolation[] = [];

  for (const file of input.files) {
    const classification = classifyPath(file, input.contract.scope);
    if (classification === "forbidden") {
      violations.push({
        type: "forbidden_path",
        path: file.path,
        message: `forbidden path changed: ${file.path} - revert it, or explicitly approve a new contract`,
      });
    }
    if (classification === "outside") {
      violations.push({
        type: "outside_scope",
        path: file.path,
        message: `changed outside approved scope: ${file.path} - revert it, or extend the approved scope`,
      });
    }
  }

  violations.push(
    ...highRiskViolations(input.files, input.extraHighRiskPatterns ?? []),
  );

  const missingTests = missingTestsViolation(
    input.files,
    input.contract,
    input.projectTypes ?? ["generic"],
  );
  if (missingTests !== null) violations.push(missingTests);

  if (input.repoState.kind !== "clean") {
    violations.push({
      type: "repo_state",
      path: null,
      message: `repository is in ${input.repoState.kind} state - finish or abort it before drift checks`,
    });
  }
  if (input.repoMode === "degraded") {
    violations.push({
      type: "repo_mode",
      path: null,
      message:
        "repository has too many changed files; ScopeLock used degraded checks",
    });
  }

  return {
    schemaVersion: DRIFT_REPORT_SCHEMA_VERSION,
    contractId: input.contract.id,
    checkedAt: input.checkedAt,
    repoMode: input.repoMode,
    repoState: input.repoState,
    changedFiles: input.files,
    violations,
  };
}
