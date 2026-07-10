import { readFile } from "node:fs/promises";
import {
  agentEnvironmentPreflightReportSchema,
  agentTargetSchema,
  agentWorkspaceManifestSchema,
  findRepoRoot,
  runAgentPreflight,
  type AgentEnvironmentViolation,
  type AgentTarget,
  type AgentWorkspaceManifest,
  type ArtifactCheckResult,
  type TargetPreflightReport,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";

async function readManifest(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CliError("MANIFEST_NOT_FOUND", `manifest not found: ${path}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError("FILE_READ_ERROR", `cannot read ${path}: ${message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError("INVALID_JSON", `invalid JSON in ${path}`);
  }
}

/**
 * Recommends the exact static-materialization command to fix a violation.
 * Never executes anything - Step 0's buy-vs-build spike decided ScopeLock
 * integrates with Ruler / `skills --copy` rather than cloning them, so a fix
 * hint is the extent of the CLI's involvement.
 */
function fixFor(violation: AgentEnvironmentViolation): string {
  switch (violation.code) {
    case "missing_required_rule":
      return `materialize the rule for ${violation.target} (e.g. \`npx @intellectronica/ruler apply --agents ${violation.target}\`)`;
    case "missing_required_skill":
      return `install the skill physically (e.g. \`npx skills add <source> --agent ${violation.target} --copy\`)`;
    case "symlink_when_physical_required":
      return `replace the symlink with a physical copy (e.g. \`npx skills add <source> --agent ${violation.target} --copy\`)`;
    case "rule_parity_mismatch":
      return `re-run your materializer to sync the rule with its canonical source (e.g. \`npx @intellectronica/ruler apply --agents ${violation.target}\`)`;
    case "skill_parity_mismatch":
      return `re-run your materializer to sync the skill with its canonical source (e.g. \`npx skills add <source> --agent ${violation.target} --copy\`)`;
  }
}

function countPassing(results: ArtifactCheckResult[]): number {
  return results.filter((r) => r.status === "pass").length;
}

function humanTarget(target: TargetPreflightReport): string {
  const rules = `rules ${countPassing(target.ruleResults)}/${target.ruleResults.length}`;
  const skills = `skills ${countPassing(target.skillResults)}/${target.skillResults.length}`;
  const lines = [`${target.id}  status=${target.status}  ${rules}  ${skills}`];
  for (const violation of target.violations) {
    lines.push(
      `  ${violation.severity}  ${violation.code}  ${violation.detail}`,
      `    fix: ${fixFor(violation)}`,
    );
  }
  return lines.join("\n");
}

function humanReport(targets: TargetPreflightReport[], summary: { status: string; violationsCount: number }): string {
  const lines = [
    "agent environment preflight",
    ...targets.map(humanTarget),
    "",
    `summary: ${summary.status} (${summary.violationsCount} violation${summary.violationsCount === 1 ? "" : "s"})`,
    `ready to dispatch: ${summary.violationsCount === 0 ? "yes" : "no"}`,
  ];
  return lines.join("\n");
}

function filterTargets(
  manifest: AgentWorkspaceManifest,
  requested: string[],
): AgentWorkspaceManifest {
  if (requested.length === 0) return manifest;
  const targets: AgentTarget[] = [];
  for (const raw of requested) {
    const parsed = agentTargetSchema.safeParse(raw);
    if (!parsed.success) {
      throw new CliError("UNKNOWN_TARGET", `unknown target: ${raw}`);
    }
    if (!manifest.targets.includes(parsed.data)) {
      throw new CliError(
        "UNKNOWN_TARGET",
        `target not declared in manifest: ${parsed.data}`,
      );
    }
    targets.push(parsed.data);
  }
  return { ...manifest, targets };
}

export async function agentsPreflightCommand(options: {
  manifest: string;
  target?: string[];
}): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "agents preflight must run inside a git repository",
    );
  }

  const manifestRaw = await readManifest(options.manifest);
  const manifest = filterTargets(
    agentWorkspaceManifestSchema.parse(manifestRaw),
    options.target ?? [],
  );

  const report = agentEnvironmentPreflightReportSchema.parse(
    runAgentPreflight({ manifest, repoRoot: root }),
  );

  return {
    data: { report },
    human: humanReport(report.targets, report.summary),
    exitCode: report.summary.violationsCount > 0 ? 1 : 0,
  };
}
