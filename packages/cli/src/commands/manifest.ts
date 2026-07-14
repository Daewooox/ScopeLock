import { buildRepoManifest } from "@scopelock/core";
import type { CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

export async function manifestCommand(): Promise<CommandResult> {
  const manifest = buildRepoManifest(process.cwd());
  const human = renderSections([
    { title: "Context", lines: `Repository  ${manifest.root}` },
    {
      title: "Result",
      lines: [
        `Tracked files     ${manifest.files.length}`,
        `Project types     ${manifest.projectTypes.join(", ")}`,
        `Package managers  ${manifest.packageManagers.join(", ") || "none"}`,
        `Test paths        ${manifest.testPaths.length}`,
        `Risky paths       ${manifest.riskyPaths.length}`,
      ],
    },
    { title: "Next", lines: "Create a task boundary: scopelock contract new --help" },
  ]);

  return {
    data: { manifest },
    human,
    exitCode: 0,
  };
}
