import { z } from "zod";

export const DRIFT_REPORT_SCHEMA_VERSION = 1;

export const gitFileStatusSchema = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "copied",
  "untracked",
  "conflicted",
]);

export const gitStageSchema = z.enum([
  "staged",
  "unstaged",
  "untracked",
  "conflicted",
]);

export const repoStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clean") }),
  z.object({ kind: z.literal("merge") }),
  z.object({ kind: z.literal("rebase") }),
  z.object({ kind: z.literal("cherry-pick") }),
  z.object({ kind: z.literal("revert") }),
  z.object({ kind: z.literal("am") }),
  z.object({ kind: z.literal("bisect") }),
]);

export const repoModeSchema = z.enum(["normal", "degraded", "refused"]);

export const changedFileSchema = z.object({
  path: z.string().min(1),
  previousPath: z.string().min(1).nullable().default(null),
  status: gitFileStatusSchema,
  stage: gitStageSchema,
  isBinary: z.boolean().default(false),
  insertions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
  sizeBytes: z.number().int().nonnegative().default(0),
});

export const driftViolationTypeSchema = z.enum([
  "outside_scope",
  "forbidden_path",
  "missing_tests",
  "high_risk_file",
  "repo_state",
  "repo_mode",
]);

export const driftViolationSchema = z.object({
  type: driftViolationTypeSchema,
  path: z.string().min(1).nullable().default(null),
  message: z.string().min(1),
});

export const driftReportSchema = z.object({
  schemaVersion: z.literal(DRIFT_REPORT_SCHEMA_VERSION),
  contractId: z.string().min(1),
  checkedAt: z.iso.datetime(),
  repoMode: repoModeSchema.default("normal"),
  repoState: repoStateSchema.default({ kind: "clean" }),
  changedFiles: z.array(changedFileSchema).default([]),
  violations: z.array(driftViolationSchema).default([]),
});

export type GitFileStatus = z.infer<typeof gitFileStatusSchema>;
export type GitStage = z.infer<typeof gitStageSchema>;
export type RepoState = z.infer<typeof repoStateSchema>;
export type RepoMode = z.infer<typeof repoModeSchema>;
export type ChangedFile = z.infer<typeof changedFileSchema>;
export type DriftViolationType = z.infer<typeof driftViolationTypeSchema>;
export type DriftViolation = z.infer<typeof driftViolationSchema>;
export type DriftReport = z.infer<typeof driftReportSchema>;
