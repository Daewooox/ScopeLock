import { buildRepoManifest } from "@scopelock/core";
import type { CommandResult } from "../run.js";

export async function manifestCommand(): Promise<CommandResult> {
  const manifest = buildRepoManifest(process.cwd());
  const human = [
    `repo: ${manifest.root}`,
    `files: ${manifest.files.length}`,
    `project types: ${manifest.projectTypes.join(", ")}`,
    `package managers: ${manifest.packageManagers.join(", ") || "none"}`,
    `test paths: ${manifest.testPaths.length}`,
    `risky paths: ${manifest.riskyPaths.length}`,
  ].join("\n");

  return {
    data: { manifest },
    human,
    exitCode: 0,
  };
}
