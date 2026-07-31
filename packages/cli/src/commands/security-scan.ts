import { findRepoRoot } from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";
import {
  SENSITIVE_ACCESS_PROFILE,
  runSensitiveAccessScan,
  type SensitiveAccessResult,
} from "../security/sensitive-access.js";

export type SecurityScanOptions = {
  profile: string;
  base: string;
  format?: "plain" | "json";
};

function humanResult(result: SensitiveAccessResult): string {
  const lines = [
    "Profile  " + result.profile,
    "Base     " + result.baseSha,
    "Targets  " + result.targets.length,
    "Scanned  " + result.scanned.length,
  ];
  if (result.reason !== undefined) lines.push("Reason   " + result.reason);
  if (result.findings.length > 0) {
    lines.push(
      "Findings",
      ...result.findings.map((finding) =>
        "  " + finding.ruleId + "  " + finding.path + ":" + finding.line,
      ),
    );
  }
  return renderSections([
    { title: "Sensitive access", lines },
    { title: "Result", lines: result.outcome },
    {
      title: "Next",
      lines: result.outcome === "passed" || result.outcome === "not-applicable"
        ? "Continue with the remaining validation checks"
        : result.outcome === "denied"
          ? "Review the finding and remove or explicitly redesign the sensitive read"
          : "Fix the scanner or target coverage issue, then run the check again",
    },
  ]);
}

export async function securityScanCommand(
  options: SecurityScanOptions,
): Promise<CommandResult> {
  if (options.profile !== SENSITIVE_ACCESS_PROFILE) {
    throw new CliError(
      "UNSUPPORTED_SECURITY_PROFILE",
      "unsupported security profile: " + options.profile,
    );
  }
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError("NOT_A_GIT_REPO", "security scan must run inside a git repository");
  }
  const result = await runSensitiveAccessScan({
    repoRoot: root,
    baseSha: options.base,
    profile: options.profile,
  });
  return {
    data: result,
    human: options.format === "json" ? JSON.stringify(result, null, 2) : humanResult(result),
    exitCode: result.outcome === "blocked" ? 2 : result.outcome === "denied" ? 1 : 0,
  };
}
