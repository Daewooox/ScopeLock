/**
 * Single source of DISPLAY semantics for evidence status strings, shared by
 * the HTML Flight Report (report.ts) and the terminal run summary
 * (run-plan.ts). Data semantics stay in receipt-evidence.ts; this module
 * only decides how an already-derived status LOOKS.
 *
 * Three principles (see the 2026-07-21 evidence-status-transparency spec):
 * 1. Color carries only checked outcomes; "deliberately not exercised" is
 *    its own muted class, never amber.
 * 2. Producers disagree on underscore vs hyphen spelling; normalize here so
 *    spelling can never decide the color again.
 * 3. Unknown statuses classify as "attention": fail-visible, never silent.
 */

export type EvidenceDisplayClass = "good" | "bad" | "attention" | "not-exercised";

const GOOD = new Set([
  "passed", "pass", "ok", "completed", "clear", "verified", "applied", "no-changes", "yes",
]);
const BAD = new Set([
  "failed", "fail", "error", "violations", "blocked", "no",
]);
const NOT_EXERCISED = new Set([
  "not-applicable", "not-checked", "not-run", "unverified",
  "not-configured", "off", "skipped", "not-started",
]);

export function normalizeEvidenceStatus(status: string): string {
  return status.replaceAll("_", "-");
}

export function classifyEvidenceStatus(status: string): EvidenceDisplayClass {
  const normalized = normalizeEvidenceStatus(status);
  if (GOOD.has(normalized)) return "good";
  if (BAD.has(normalized)) return "bad";
  if (NOT_EXERCISED.has(normalized)) return "not-exercised";
  return "attention";
}

/** Why each not-exercised status occurred. Keys are normalized statuses. */
export const EVIDENCE_GLOSSES: Record<string, string> = {
  "not-applicable": "this step only runs with --isolate",
  "not-checked": "drift step skipped (--no-check-drift)",
  "not-run": "no validation checks configured for this run",
  "unverified": "no acceptance checks were declared",
  "not-configured": "no environment manifest supplied",
  "off": "isolation was not requested",
  "skipped": "an earlier required step failed or was interrupted",
  "not-started": "the run ended before this step",
};
