import { basename } from "node:path";
import {
  REPO_MANIFEST_SCHEMA_VERSION,
  repoManifestSchema,
  type PackageManager,
  type ProjectType,
  type RepoManifest,
} from "../schemas/repo-manifest.js";
import { runGit } from "../git/exec.js";
import { currentBranch, findRepoRoot, headSha } from "../git/repo.js";

const packageManagerMarkers: Array<[string, PackageManager]> = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
];

const riskyBasenames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Package.resolved",
  "Podfile.lock",
  "gradle.lockfile",
]);

function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}

function hasFile(files: Set<string>, path: string): boolean {
  return files.has(path);
}

function hasAnySuffix(files: string[], suffix: string): boolean {
  return files.some((file) => file.endsWith(suffix));
}

function hasAnySegment(files: string[], segment: string): boolean {
  return files.some((file) => file.split("/").includes(segment));
}

function detectPackageManagers(files: Set<string>): PackageManager[] {
  return uniqueSorted(
    packageManagerMarkers
      .filter(([marker]) => files.has(marker))
      .map(([, manager]) => manager),
  );
}

function detectProjectTypes(files: string[], fileSet: Set<string>): ProjectType[] {
  const types = new Set<ProjectType>();

  if (
    hasAnySuffix(files, ".xcodeproj/project.pbxproj") ||
    hasAnySuffix(files, ".xcworkspace/contents.xcworkspacedata") ||
    hasFile(fileSet, "Package.swift") ||
    hasFile(fileSet, "Podfile")
  ) {
    types.add("ios");
  }

  if (
    hasFile(fileSet, "settings.gradle") ||
    hasFile(fileSet, "settings.gradle.kts") ||
    hasAnySuffix(files, "build.gradle") ||
    hasAnySuffix(files, "build.gradle.kts")
  ) {
    types.add("android");
  }

  if (
    files.some((file) => file.includes("shared/src/commonMain/")) ||
    files.some((file) => file.includes("src/commonMain/")) ||
    files.some((file) => file.includes("composeApp/src/commonMain/"))
  ) {
    types.add("kmp");
  }

  if (
    hasFile(fileSet, "app.json") &&
    (hasAnySegment(files, "ios") || hasAnySegment(files, "android"))
  ) {
    types.add("react-native");
  }

  if (
    hasFile(fileSet, "vite.config.ts") ||
    hasFile(fileSet, "vite.config.js") ||
    hasFile(fileSet, "next.config.js") ||
    hasFile(fileSet, "next.config.mjs") ||
    hasFile(fileSet, "src/App.tsx") ||
    hasFile(fileSet, "src/main.tsx")
  ) {
    types.add("frontend");
  }

  if (
    hasFile(fileSet, "server.ts") ||
    hasFile(fileSet, "server.js") ||
    hasFile(fileSet, "src/server.ts") ||
    hasFile(fileSet, "src/index.ts") ||
    hasFile(fileSet, "requirements.txt") ||
    hasFile(fileSet, "pyproject.toml")
  ) {
    types.add("backend");
  }

  if (types.size === 0) types.add("generic");
  return uniqueSorted(types);
}

function detectTestPaths(files: string[]): string[] {
  return files.filter((file) => {
    const segments = file.split("/");
    const name = basename(file);
    return (
      segments.includes("test") ||
      segments.includes("tests") ||
      segments.includes("__tests__") ||
      name.endsWith(".test.ts") ||
      name.endsWith(".test.tsx") ||
      name.endsWith(".spec.ts") ||
      name.endsWith(".spec.tsx") ||
      name.endsWith("Test.kt") ||
      name.endsWith("Tests.swift")
    );
  });
}

function detectRiskyPaths(files: string[]): string[] {
  return files.filter((file) => {
    const name = basename(file);
    return riskyBasenames.has(name) || name.startsWith(".env.");
  });
}

function trackedFiles(repoRoot: string): string[] {
  const result = runGit(["ls-files", "-z"], repoRoot);
  if (!result.ok) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout
    .split("\0")
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
    .sort();
}

export function buildRepoManifest(cwd: string = process.cwd()): RepoManifest {
  const root = findRepoRoot(cwd);
  if (root === null) {
    throw new Error("not inside a git repository");
  }

  const files = trackedFiles(root);
  const fileSet = new Set(files);
  const manifest = {
    schemaVersion: REPO_MANIFEST_SCHEMA_VERSION,
    root,
    branch: currentBranch(root),
    headSha: headSha(root),
    packageManagers: detectPackageManagers(fileSet),
    projectTypes: detectProjectTypes(files, fileSet),
    files,
    testPaths: detectTestPaths(files),
    riskyPaths: detectRiskyPaths(files),
  };

  return repoManifestSchema.parse(manifest);
}
