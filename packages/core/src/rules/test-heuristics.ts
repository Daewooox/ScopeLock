import type { ApprovedContract } from "../schemas/contract.js";
import type { ProjectType } from "../schemas/repo-manifest.js";
import type { ChangedFile, DriftViolation } from "../schemas/drift.js";
import { matchesAny } from "./path-rules.js";

export const TEST_PATTERNS_BY_PROJECT_TYPE: Record<ProjectType, string[]> = {
  generic: ["**/*.{test,spec}.*", "**/__tests__/**"],
  frontend: ["**/*.{test,spec}.*", "**/__tests__/**"],
  backend: ["**/*.{test,spec}.*", "**/__tests__/**"],
  ios: ["**/*.{test,spec}.*", "**/__tests__/**", "**/*Tests.swift"],
  android: [
    "**/*.{test,spec}.*",
    "**/__tests__/**",
    "**/src/test/**",
    "**/src/androidTest/**",
  ],
  kmp: [
    "**/*.{test,spec}.*",
    "**/__tests__/**",
    "**/src/test/**",
    "**/src/androidTest/**",
  ],
  "react-native": [
    "**/*.{test,spec}.*",
    "**/__tests__/**",
    "**/e2e/**",
  ],
};

export function missingTestsViolation(
  files: ChangedFile[],
  contract: ApprovedContract,
  projectTypes: ProjectType[] = ["generic"],
): DriftViolation | null {
  if (contract.tests.length === 0 || files.length === 0) return null;

  const patterns = [
    ...new Set(
      projectTypes.flatMap(
        (projectType) => TEST_PATTERNS_BY_PROJECT_TYPE[projectType],
      ),
    ),
  ];
  if (files.some((file) => matchesAny(file.path, patterns))) return null;

  return {
    type: "missing_tests",
    path: null,
    message:
      "required tests are declared, but no test file changed - add/update tests or explain why not",
  };
}
