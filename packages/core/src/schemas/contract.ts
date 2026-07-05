import { z } from "zod";

export const CONTRACT_SCHEMA_VERSION = 1;

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export const agentIdSchema = z.enum(["claude", "codex", "cursor"]);

/**
 * Architectural layer of a plan node. "unknown" is a first-class value:
 * planner output that cannot be verified against the repo manifest is
 * downgraded to "unknown" instead of being silently trusted.
 */
export const nodeTypeSchema = z.enum([
  "ui",
  "state",
  "domain",
  "data",
  "navigation",
  "build",
  "config",
  "tests",
  "unknown",
]);

export const pathPatternSchema = z.string().min(1);

/**
 * Git state captured at approve time. Drift is computed as
 * (baseline..HEAD committed changes) + working tree changes.
 * Null until the contract has been approved inside a git repo.
 */
export const contractBaselineSchema = z.object({
  headSha: z.string().min(1),
  branch: z.string().min(1).nullable(),
  capturedAt: z.iso.datetime(),
});

export const contractScopeSchema = z.object({
  plannedPathPatterns: z.array(pathPatternSchema).default([]),
  forbiddenPathPatterns: z.array(pathPatternSchema).default([]),
});

export const contractNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: nodeTypeSchema.default("unknown"),
  paths: z.array(pathPatternSchema).default([]),
  risk: riskLevelSchema.default("medium"),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)).default([]),
});

export const contractRiskSchema = z.object({
  level: riskLevelSchema,
  reason: z.string().min(1),
  mitigation: z.string().min(1),
});

export const requiredTestSchema = z.object({
  type: z.string().min(1),
  command: z.string().min(1).nullable().default(null),
  required: z.boolean().default(true),
});

export const approvedContractSchema = z.object({
  schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
  id: z.string().min(1),
  task: z.string().min(1),
  createdAt: z.iso.datetime(),
  baseline: contractBaselineSchema.nullable().default(null),
  targetAgents: z.array(agentIdSchema).default([]),
  scope: contractScopeSchema,
  nodes: z.array(contractNodeSchema).default([]),
  risks: z.array(contractRiskSchema).default([]),
  tests: z.array(requiredTestSchema).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  openQuestions: z.array(z.string().min(1)).default([]),
});

export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type AgentId = z.infer<typeof agentIdSchema>;
export type NodeType = z.infer<typeof nodeTypeSchema>;
export type ContractBaseline = z.infer<typeof contractBaselineSchema>;
export type ContractScope = z.infer<typeof contractScopeSchema>;
export type ContractNode = z.infer<typeof contractNodeSchema>;
export type ContractRisk = z.infer<typeof contractRiskSchema>;
export type RequiredTest = z.infer<typeof requiredTestSchema>;
export type ApprovedContract = z.infer<typeof approvedContractSchema>;
