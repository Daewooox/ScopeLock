import { z } from "zod";
import { projectTypeSchema } from "./repo-manifest.js";

export const CONFIG_SCHEMA_VERSION = 1;

/**
 * warn: violations are reported (drift report, audit log) but never block.
 * strict: enforcement hooks block out-of-scope edits where the agent
 * supports it (Claude Code PreToolUse deny).
 */
export const enforcementModeSchema = z.enum(["warn", "strict"]);

/** Shape of `<repo>/.scopelock/config.json`. Never read it as trusted JSON. */
export const scopelockConfigSchema = z.object({
  schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
  projectTypes: z.array(projectTypeSchema).default(["generic"]),
  templates: z.array(z.string().min(1)).default([]),
  mode: enforcementModeSchema.default("warn"),
});

export type EnforcementMode = z.infer<typeof enforcementModeSchema>;
export type ScopelockConfig = z.infer<typeof scopelockConfigSchema>;
