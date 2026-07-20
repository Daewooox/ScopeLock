/**
 * Pure derivation of honest, deterministic evidence semantics from a
 * completed run's raw signals - no I/O, no shell strings, no LLM judge.
 * `deriveEvidenceSummary` is the single source of truth for how the six
 * evidence rows (execution/scope/validation/acceptance/promotion/cleanup)
 * are computed from task runs, drift status, isolation outcomes, and
 * validation checks. Both the terminal renderer (`run-plan.ts`) and the HTML
 * renderer (`report.ts`) read the resulting `EvidenceSummary` rather than
 * re-deriving these judgments themselves.
 */

export type EvidenceSummary = {
  execution: "completed" | "attention" | "blocked";
  scope: "clear" | "violations" | "not-checked";
  validation: "passed" | "attention" | "failed" | "not-run";
  acceptance: "verified" | "failed" | "unverified";
  promotion: "applied" | "no-changes" | "blocked" | "not-applicable";
  cleanup: "ok" | "warning" | "not-applicable";
};

export type EvidenceInput = {
  taskStatuses: Array<"passed" | "failed" | "skipped" | "blocked">;
  cycleCount: number;
  blockedByEnvironment: boolean;
  driftStatus: "ok" | "violations" | "error" | "not_checked";
  isolationOutcomes: string[];
  validationChecks: Array<{
    id: string;
    status: "passed" | "failed" | "skipped" | "blocked";
    required: boolean;
    skipReason?: "no-candidate-changes" | "setup-failed" | "required-check-failed" | "interrupted";
  }>;
  acceptanceCheckIds: string[];
  promotion: "applied" | "no-changes" | "blocked" | "not-applicable";
  cleanup: "ok" | "warning" | "not-applicable";
};

function deriveExecution(input: EvidenceInput): EvidenceSummary["execution"] {
  if (input.cycleCount > 0 || input.blockedByEnvironment) return "blocked";
  const { taskStatuses } = input;
  if (taskStatuses.some((status) => status === "blocked" || status === "skipped")) return "blocked";
  if (taskStatuses.some((status) => status === "failed")) return "attention";
  return "completed";
}

function deriveScope(
  driftStatus: EvidenceInput["driftStatus"],
  isolationOutcomes: string[],
): EvidenceSummary["scope"] {
  if (
    driftStatus === "violations"
    || driftStatus === "error"
    || isolationOutcomes.includes("rejected-scope")
  ) {
    return "violations";
  }
  if (driftStatus === "ok") return "clear";
  return "not-checked";
}

function deriveValidation(
  validationChecks: EvidenceInput["validationChecks"],
): EvidenceSummary["validation"] {
  if (validationChecks.length === 0) return "not-run";
  const relevantChecks = validationChecks.filter(
    (check) => !(check.status === "skipped" && check.skipReason === "no-candidate-changes"),
  );
  if (relevantChecks.length === 0) return "not-run";
  const failedRequired = validationChecks.some(
    (check) => check.required && (
      check.status === "failed" || check.status === "skipped" || check.status === "blocked"
    ),
  );
  if (failedRequired) return "failed";
  const failedOptional = validationChecks.some(
    (check) => !check.required && (
      check.status === "failed" || check.status === "skipped" || check.status === "blocked"
    ),
  );
  if (failedOptional) return "attention";
  const allPassed = relevantChecks.every((check) => check.status === "passed");
  if (allPassed) return "passed";
  return "not-run";
}

function deriveAcceptance(
  acceptanceCheckIds: EvidenceInput["acceptanceCheckIds"],
  validationChecks: EvidenceInput["validationChecks"],
): EvidenceSummary["acceptance"] {
  if (acceptanceCheckIds.length === 0) return "unverified";
  const byId = new Map(validationChecks.map((check) => [check.id, check]));
  const allPassed = acceptanceCheckIds.every((id) => byId.get(id)?.status === "passed");
  return allPassed ? "verified" : "failed";
}

export function deriveEvidenceSummary(input: EvidenceInput): EvidenceSummary {
  return {
    execution: deriveExecution(input),
    scope: deriveScope(input.driftStatus, input.isolationOutcomes),
    validation: deriveValidation(input.validationChecks),
    acceptance: deriveAcceptance(input.acceptanceCheckIds, input.validationChecks),
    promotion: input.promotion,
    cleanup: input.cleanup,
  };
}
