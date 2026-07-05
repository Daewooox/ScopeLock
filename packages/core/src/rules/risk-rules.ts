import type { ChangedFile, DriftViolation } from "../schemas/drift.js";
import { matchesAny } from "./path-rules.js";

export const DEFAULT_HIGH_RISK_PATTERNS = [
  ".github/workflows/**",
  "**/*.lock",
  "pnpm-lock.yaml",
  "**/migrations/**",
  "Dockerfile*",
  ".env*",
  "**/auth/**",
  "**/*.entitlements",
  "**/Info.plist",
  "**/AndroidManifest.xml",
  "**/*.gradle*",
  "**/project.pbxproj",
  "Package.swift",
];

export function highRiskViolations(
  files: ChangedFile[],
  extraPatterns: string[] = [],
): DriftViolation[] {
  const patterns = [...DEFAULT_HIGH_RISK_PATTERNS, ...extraPatterns];
  return files
    .filter((file) => matchesAny(file.path, patterns))
    .map((file) => ({
      type: "high_risk_file",
      path: file.path,
      message: `high-risk file changed: ${file.path} - review intentionally before continuing`,
    }));
}
