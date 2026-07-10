import { lstatSync } from "node:fs";
import type {
  AgentEnvironmentPreflightReport,
  AgentEnvironmentViolation,
  AgentTarget,
  AgentWorkspaceManifest,
  ArtifactCheckResult,
  TargetPreflightReport,
} from "../schemas/agent-workspace.js";
import { AGENT_ENVIRONMENT_PREFLIGHT_REPORT_SCHEMA_VERSION } from "../schemas/agent-workspace.js";
import { hashFileBytes, hashSkillDir } from "./hash.js";
import { probeHookConfig } from "./hook-probe.js";
import { ruleTargetPaths, skillTargetDirs } from "./locations.js";
import { resolveRepoPath } from "./paths.js";

/**
 * Read-only environment attestation core. Given a validated manifest and a repo
 * root, it resolves each target's installed rule/skill locations, checks
 * presence, detects symlinks when physical copies are required, and compares
 * digests against the declared canonical artifact for parity. It performs NO
 * mutation, NO process execution, NO network, and never prints or exits - it
 * returns typed data for a CLI layer (Step 2) to render.
 */

interface Existing {
  resolvedPath: string;
  isSymlink: boolean;
}

/** First candidate that exists on disk (symlink or real), else null. */
function firstExisting(repoRoot: string, candidates: string[]): Existing | null {
  for (const rel of candidates) {
    const abs = resolveRepoPath(repoRoot, rel);
    try {
      const st = lstatSync(abs);
      return { resolvedPath: abs, isSymlink: st.isSymbolicLink() };
    } catch {
      // not present at this candidate; try the next
    }
  }
  return null;
}

function safeDigest(compute: () => string): string | null {
  try {
    return compute();
  } catch {
    return null;
  }
}

interface ArtifactCheckInput {
  kind: "rule" | "skill";
  id: string;
  required: boolean;
  target: AgentTarget;
  candidates: string[];
  canonicalDigest: string | null;
  digestOf: (absPath: string) => string;
  requirePhysicalCopies: boolean;
  requireParity: boolean;
}

function checkArtifact(
  repoRoot: string,
  input: ArtifactCheckInput,
): { result: ArtifactCheckResult; violation: AgentEnvironmentViolation | null } {
  const found = firstExisting(repoRoot, input.candidates);
  const present = found !== null;
  const isSymlink = found?.isSymlink ?? false;
  const digest = found ? safeDigest(() => input.digestOf(found.resolvedPath)) : null;

  let status: ArtifactCheckResult["status"] = "pass";
  let violation: AgentEnvironmentViolation | null = null;

  if (!present) {
    if (input.required) {
      status = "fail";
      violation = {
        target: input.target,
        code: input.kind === "rule" ? "missing_required_rule" : "missing_required_skill",
        detail: `${input.target}: required ${input.kind} "${input.id}" not found (looked in: ${input.candidates.join(", ")})`,
        severity: "error",
      };
    } else {
      // Missing optional artifact is informational, never fatal.
      status = "warn";
    }
  } else if (input.requirePhysicalCopies && isSymlink) {
    status = "fail";
    violation = {
      target: input.target,
      code: "symlink_when_physical_required",
      detail: `${input.target}: ${input.kind} "${input.id}" is a symlink but the policy requires a physical copy (${found.resolvedPath})`,
      severity: "error",
    };
  } else if (input.requireParity && input.canonicalDigest !== null && digest !== input.canonicalDigest) {
    status = "fail";
    violation = {
      target: input.target,
      code: input.kind === "rule" ? "rule_parity_mismatch" : "skill_parity_mismatch",
      detail: `${input.target}: ${input.kind} "${input.id}" digest does not match the declared canonical artifact`,
      severity: "error",
    };
  }

  return {
    result: {
      id: input.id,
      kind: input.kind,
      target: input.target,
      required: input.required,
      present,
      isSymlink,
      resolvedPath: found?.resolvedPath ?? null,
      digest,
      status,
    },
    violation,
  };
}

function rollUp(
  ruleResults: ArtifactCheckResult[],
  skillResults: ArtifactCheckResult[],
): TargetPreflightReport["status"] {
  const all = [...ruleResults, ...skillResults];
  if (all.some((r) => r.status === "fail")) return "fail";
  if (all.some((r) => r.status === "warn")) return "warn";
  return "pass";
}

export function runAgentPreflight(input: {
  manifest: AgentWorkspaceManifest;
  repoRoot: string;
  now?: string;
}): AgentEnvironmentPreflightReport {
  const { manifest, repoRoot } = input;
  const { requirePhysicalCopies, requireRuleParity, requireSkillParity } = manifest.policy;

  const canonicalRuleDigest = new Map<string, string | null>();
  for (const rule of manifest.rules) {
    canonicalRuleDigest.set(
      rule.id,
      safeDigest(() => hashFileBytes(resolveRepoPath(repoRoot, rule.path))),
    );
  }
  const canonicalSkillDigest = new Map<string, string | null>();
  for (const skill of manifest.skills) {
    canonicalSkillDigest.set(
      skill.name,
      safeDigest(() => hashSkillDir(resolveRepoPath(repoRoot, skill.path))),
    );
  }

  const targets: TargetPreflightReport[] = manifest.targets.map((target) => {
    const ruleResults: ArtifactCheckResult[] = [];
    const skillResults: ArtifactCheckResult[] = [];
    const violations: AgentEnvironmentViolation[] = [];

    for (const rule of manifest.rules) {
      const { result, violation } = checkArtifact(repoRoot, {
        kind: "rule",
        id: rule.id,
        required: rule.required,
        target,
        candidates: ruleTargetPaths(target),
        canonicalDigest: canonicalRuleDigest.get(rule.id) ?? null,
        digestOf: hashFileBytes,
        requirePhysicalCopies,
        requireParity: requireRuleParity,
      });
      ruleResults.push(result);
      if (violation) violations.push(violation);
    }

    for (const skill of manifest.skills) {
      const { result, violation } = checkArtifact(repoRoot, {
        kind: "skill",
        id: skill.name,
        required: skill.required,
        target,
        candidates: skillTargetDirs(target, skill.name),
        canonicalDigest: canonicalSkillDigest.get(skill.name) ?? null,
        digestOf: hashSkillDir,
        requirePhysicalCopies,
        requireParity: requireSkillParity,
      });
      skillResults.push(result);
      if (violation) violations.push(violation);
    }

    return {
      id: target,
      status: rollUp(ruleResults, skillResults),
      ruleResults,
      skillResults,
      violations,
      hook: probeHookConfig(repoRoot, target),
    };
  });

  const violationsCount = targets.reduce((sum, t) => sum + t.violations.length, 0);
  const summaryStatus: TargetPreflightReport["status"] = targets.some((t) => t.status === "fail")
    ? "fail"
    : targets.some((t) => t.status === "warn")
      ? "warn"
      : "pass";

  return {
    schemaVersion: AGENT_ENVIRONMENT_PREFLIGHT_REPORT_SCHEMA_VERSION,
    checkedAt: input.now ?? new Date().toISOString(),
    repoRoot,
    targets,
    summary: { status: summaryStatus, violationsCount },
  };
}
