import { findRepoRoot } from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";
import {
  SENSITIVE_ACCESS_ENGINE_VERSION,
  SENSITIVE_ACCESS_PROFILE,
  SENSITIVE_ACCESS_RULE_PACK_SHA256,
  runSensitiveAccessScan,
  type SensitiveAccessResult,
} from "../security/sensitive-access.js";

export type SecurityScanOptions = {
  profile: string;
  base: string;
  format?: "plain" | "json";
  engineVersion?: string;
  rulesSha256?: string;
};

function humanResult(result: SensitiveAccessResult): string {
  const lines = [
    "Profile  " + result.profile,
    "Engine   " + `${result.engine} ${result.engineVersion ?? "unattested"}`,
    "Rules    " + (result.rulePackSha256 ?? "unattested"),
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
  if (options.format !== undefined && options.format !== "plain" && options.format !== "json") {
    throw new CliError("INVALID_SECURITY_FORMAT", "security scan format must be plain or json");
  }
  if (options.profile !== SENSITIVE_ACCESS_PROFILE) {
    throw new CliError(
      "UNSUPPORTED_SECURITY_PROFILE",
      "unsupported security profile: " + options.profile,
    );
  }
  if (options.engineVersion !== undefined && options.engineVersion !== SENSITIVE_ACCESS_ENGINE_VERSION) {
    throw new CliError("UNSUPPORTED_SECURITY_ENGINE", "security scan accepts only the pinned Semgrep release");
  }
  if (options.rulesSha256 !== undefined && options.rulesSha256 !== SENSITIVE_ACCESS_RULE_PACK_SHA256) {
    throw new CliError("UNSUPPORTED_SECURITY_RULES", "security scan accepts only the bundled rule pack");
  }
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError("NOT_A_GIT_REPO", "security scan must run inside a git repository");
  }
  const result = await runSensitiveAccessScan({
    repoRoot: root,
    baseSha: options.base,
    profile: options.profile,
    expectedEngineVersion: options.engineVersion ?? SENSITIVE_ACCESS_ENGINE_VERSION,
    expectedRulePackSha256: options.rulesSha256 ?? SENSITIVE_ACCESS_RULE_PACK_SHA256,
  });
  return {
    data: result,
    human: options.format === "json" ? JSON.stringify(result, null, 2) : humanResult(result),
    exitCode: result.outcome === "blocked" ? 2 : result.outcome === "denied" ? 1 : 0,
  };
}
