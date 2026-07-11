import picomatch from "picomatch";
import type { ContractScope } from "../schemas/contract.js";
import type { ChangedFile } from "../schemas/drift.js";

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

export function matchesAny(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return picomatch(patterns, { dot: true })(normalize(path));
}

export function classifyPath(
  file: ChangedFile,
  scope: ContractScope,
): "forbidden" | "outside" | "planned" {
  const paths = [file.path, file.previousPath].filter(
    (path): path is string => path !== null,
  );
  if (
    paths.some((path) => matchesAny(path, scope.forbiddenPathPatterns))
  ) {
    return "forbidden";
  }
  if (scope.allowAllPaths) return "planned";
  if (scope.plannedPathPatterns.length === 0) return "outside";
  return matchesAny(file.path, scope.plannedPathPatterns)
    ? "planned"
    : "outside";
}
