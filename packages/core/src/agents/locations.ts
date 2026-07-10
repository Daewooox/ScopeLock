import type { AgentTarget } from "../schemas/agent-workspace.js";

/**
 * The ONLY place target-specific installed paths live. The engine asks this
 * module where a given target keeps a rule or a skill; nothing else hardcodes a
 * `.claude`/`.cursor`/`.codex`/`.agents` path. Locations are repo-relative and
 * evidence-based (see agent-environment-preflight-spike-verdict.md).
 */

/** Shared skills directory: `skills --copy` maps this to Cursor AND Codex. */
export const SHARED_SKILLS_DIR = ".agents/skills";

/**
 * Candidate rule locations a target may consume, in preference order. Ruler
 * emits `CLAUDE.md` for Claude and `AGENTS.md` for Cursor/Codex.
 */
export function ruleTargetPaths(target: AgentTarget): string[] {
  switch (target) {
    case "claude":
      return ["CLAUDE.md"];
    case "cursor":
      return ["AGENTS.md"];
    case "codex":
      return ["AGENTS.md"];
  }
}

/**
 * Candidate skill directories a target may consume, in preference order. The
 * shared `.agents/skills/<name>` is always a valid location, which is how one
 * physical copy can satisfy multiple targets (first-class shared paths).
 */
export function skillTargetDirs(target: AgentTarget, skillName: string): string[] {
  const shared = `${SHARED_SKILLS_DIR}/${skillName}`;
  switch (target) {
    case "claude":
      return [`.claude/skills/${skillName}`, shared];
    case "cursor":
      return [`.cursor/skills/${skillName}`, shared];
    case "codex":
      return [shared];
  }
}
