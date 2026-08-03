import { decisionSchema, type Decision } from "@mindthediff/core";
import { normalizeTerminalDetail } from "./ui.js";

const FIX_BY_CODE: Readonly<Record<string, string>> = {
  SENSITIVE_ACCESS_DENIED: "Remove or redesign the sensitive local-file read.",
  SENSITIVE_ACCESS_SCAN_BLOCKED: "Resolve the scanner or coverage issue, then rerun the check.",
  SCOPE_DRIFT_VIOLATIONS: "Review the drift report and revert or approve the unexpected changes.",
  AGENT_PREFLIGHT_VIOLATIONS: "Materialize the required agent artifacts and rerun preflight.",
  AGENT_PREFLIGHT_BLOCKED: "Materialize the required agent artifacts before dispatching again.",
  ISOLATED_PROMOTION_BLOCKED: "Review the receipt and resolve the blocking validation or isolation finding.",
  HOOK_FORBIDDEN_PATH: "Remove the forbidden path from the change.",
  HOOK_OUTSIDE_SCOPE: "Revert the out-of-scope change or obtain an approved contract.",
  HOOK_SELF_PROTECTED: "Do not change MindTheDiff control-plane files during this task.",
  HOOK_APPROVAL_INTEGRITY: "Restore the approved contract and its integrity seal before retrying.",
  HOOK_SYMLINK_ESCAPE: "Use a path that remains inside the repository.",
  HOOK_CONFIG_ERROR: "Correct the MindTheDiff hook configuration before retrying.",
  HOOK_GATE_ERROR: "Resolve the hook gate error before retrying.",
  HOOK_INVALID_INPUT: "Provide valid hook input before retrying.",
  HOOK_GATE_BLOCKED: "Resolve the hook gate issue before retrying.",
};

const GENERIC_FIX = "Review the policy decision and correct the underlying issue before retrying.";

export function decisionFor(status: Decision["status"], code: string, reason: string): Decision {
  return decisionSchema.parse({ status, code, reason, fix: FIX_BY_CODE[code] ?? GENERIC_FIX });
}

export function hookDecisionFor(reason: string, message: string): Decision {
  const pathDenial = {
    forbidden: "HOOK_FORBIDDEN_PATH",
    outside: "HOOK_OUTSIDE_SCOPE",
    "self-protected": "HOOK_SELF_PROTECTED",
  }[reason];
  if (pathDenial) return decisionFor("denied", pathDenial, message);

  const blocked = {
    "approval-integrity": "HOOK_APPROVAL_INTEGRITY",
    "symlink-escape": "HOOK_SYMLINK_ESCAPE",
    "config-error": "HOOK_CONFIG_ERROR",
    "gate-error": "HOOK_GATE_ERROR",
    "invalid-input": "HOOK_INVALID_INPUT",
  }[reason] ?? "HOOK_GATE_BLOCKED";
  return decisionFor("blocked", blocked, message);
}

export function renderDecision(decision: Decision): string {
  return `${decision.status.toUpperCase()} [${decision.code}]: ${normalizeTerminalDetail(decision.reason)}\nFix: ${decision.fix}`;
}
