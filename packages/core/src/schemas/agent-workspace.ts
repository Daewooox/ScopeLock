import { z } from "zod";
import { isRepoRelativeSafe } from "../agents/paths.js";
import { agentIdSchema, type AgentId } from "./contract.js";

export const AGENT_WORKSPACE_MANIFEST_SCHEMA_VERSION = 1;
export const AGENT_ENVIRONMENT_PREFLIGHT_REPORT_SCHEMA_VERSION = 1;

/**
 * Harness targets ScopeLock verifies in the first production slice. This is the
 * *host* (owns files/hooks/config), not the model - GLM et al. run through one
 * of these hosts. Reuses the contract harness enum (claude/cursor/codex) so the
 * supported-host set has a single source of truth.
 */
export const agentTargetSchema = agentIdSchema;
export type AgentTarget = AgentId;

const repoRelativePathSchema = z
  .string()
  .min(1)
  .refine(isRepoRelativeSafe, {
    message: "path must be repo-relative and cannot escape the repository",
  });

export const manifestRuleSchema = z.object({
  id: z.string().min(1),
  path: repoRelativePathSchema,
  required: z.boolean(),
});

export const manifestSkillSchema = z.object({
  name: z.string().min(1),
  path: repoRelativePathSchema,
  required: z.boolean(),
});

function firstDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return null;
}

/**
 * Manifest v1: declares which canonical rules/skills every listed target must
 * have, and how strict the parity/physical-copy policy is. Paths are the
 * canonical (source-of-truth) locations; per-target installed locations are
 * resolved by `agents/locations.ts`, never hardcoded here.
 */
export const agentWorkspaceManifestSchema = z
  .object({
    schemaVersion: z.literal(AGENT_WORKSPACE_MANIFEST_SCHEMA_VERSION),
    targets: z.array(agentTargetSchema).min(1),
    rules: z.array(manifestRuleSchema).default([]),
    skills: z.array(manifestSkillSchema).default([]),
    policy: z.object({
      requirePhysicalCopies: z.boolean(),
      requireRuleParity: z.boolean(),
      requireSkillParity: z.boolean(),
    }),
  })
  .superRefine((manifest, ctx) => {
    const dupTarget = firstDuplicate(manifest.targets);
    if (dupTarget !== null) {
      ctx.addIssue({ code: "custom", path: ["targets"], message: `duplicate target: ${dupTarget}` });
    }
    const dupRule = firstDuplicate(manifest.rules.map((r) => r.id));
    if (dupRule !== null) {
      ctx.addIssue({ code: "custom", path: ["rules"], message: `duplicate rule id: ${dupRule}` });
    }
    const dupSkill = firstDuplicate(manifest.skills.map((s) => s.name));
    if (dupSkill !== null) {
      ctx.addIssue({ code: "custom", path: ["skills"], message: `duplicate skill name: ${dupSkill}` });
    }
  });

export type AgentWorkspaceManifest = z.infer<typeof agentWorkspaceManifestSchema>;

// ---- Preflight report (typed data only; the engine never prints or exits) ----

export const artifactCheckStatusSchema = z.enum(["pass", "warn", "fail"]);
export const targetStatusSchema = z.enum(["pass", "warn", "fail", "blocked"]);

/**
 * Confidence in a hook capability claim: "documented" - nominal, from the
 * host's documented hook format, not otherwise checked; "live-verified" - an
 * actual harness run confirmed it (a separate, explicit regression step, not
 * something a fast pre-dispatch probe does); "degraded" - the claim cannot be
 * trusted for this repo (e.g. unverifiable trust state, undocumented event
 * schema). A probe may only downgrade documented -> degraded, never invent
 * live-verified.
 */
export const hookConfidenceSchema = z.enum(["documented", "live-verified", "degraded"]);
export type HookConfidence = z.infer<typeof hookConfidenceSchema>;

/**
 * Minimal hook capability model (Step 3), replacing the coarse
 * `hooksSupport: deny|audit|none` assumption. `preToolUse`/`postToolUse`/
 * `canDeny`/`canModifyInput` describe what the host's hook format is designed
 * to do; `confidence` describes how much that claim should be trusted for a
 * given repo right now (see `harness/capabilities.ts` for the nominal table
 * and `agents/hook-probe.ts` for the config-based probe).
 */
export const hookCapabilitiesSchema = z.object({
  preToolUse: z.boolean(),
  postToolUse: z.boolean(),
  canDeny: z.boolean(),
  canModifyInput: z.boolean(),
  confidence: hookConfidenceSchema,
});
export type HookCapabilities = z.infer<typeof hookCapabilitiesSchema>;

export const hookConfigProbeSchema = z.object({
  target: agentTargetSchema,
  installed: z.boolean(),
  capabilities: hookCapabilitiesSchema,
  detail: z.string().min(1),
});
export type HookConfigProbe = z.infer<typeof hookConfigProbeSchema>;

export const HOOK_VERIFICATION_STORE_SCHEMA_VERSION = 1;

export const hookVerificationRecordSchema = z.object({
  target: agentTargetSchema,
  checkedAt: z.iso.datetime(),
  hookConfigDigest: z.string().min(1),
  result: z.enum(["passed", "failed"]),
  detail: z.string().min(1),
});
export type HookVerificationRecord = z.infer<typeof hookVerificationRecordSchema>;

export const hookVerificationStoreSchema = z.object({
  schemaVersion: z.literal(HOOK_VERIFICATION_STORE_SCHEMA_VERSION),
  verifications: z.array(hookVerificationRecordSchema),
});
export type HookVerificationStore = z.infer<typeof hookVerificationStoreSchema>;

export const artifactCheckResultSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["rule", "skill"]),
  target: agentTargetSchema,
  required: z.boolean(),
  present: z.boolean(),
  isSymlink: z.boolean(),
  resolvedPath: z.string().nullable(),
  digest: z.string().nullable(),
  status: artifactCheckStatusSchema,
});
export type ArtifactCheckResult = z.infer<typeof artifactCheckResultSchema>;

export const agentEnvironmentViolationSchema = z.object({
  target: agentTargetSchema,
  code: z.enum([
    "missing_required_rule",
    "missing_required_skill",
    "symlink_when_physical_required",
    "rule_parity_mismatch",
    "skill_parity_mismatch",
  ]),
  detail: z.string().min(1),
  severity: z.enum(["warn", "error"]),
});
export type AgentEnvironmentViolation = z.infer<typeof agentEnvironmentViolationSchema>;

export const targetPreflightReportSchema = z.object({
  id: agentTargetSchema,
  status: targetStatusSchema,
  ruleResults: z.array(artifactCheckResultSchema),
  skillResults: z.array(artifactCheckResultSchema),
  violations: z.array(agentEnvironmentViolationSchema),
  hook: hookConfigProbeSchema,
});
export type TargetPreflightReport = z.infer<typeof targetPreflightReportSchema>;

export const agentEnvironmentPreflightReportSchema = z.object({
  schemaVersion: z.literal(AGENT_ENVIRONMENT_PREFLIGHT_REPORT_SCHEMA_VERSION),
  checkedAt: z.iso.datetime(),
  repoRoot: z.string().min(1),
  targets: z.array(targetPreflightReportSchema),
  summary: z.object({
    status: targetStatusSchema,
    violationsCount: z.number().int().nonnegative(),
  }),
});
export type AgentEnvironmentPreflightReport = z.infer<
  typeof agentEnvironmentPreflightReportSchema
>;
