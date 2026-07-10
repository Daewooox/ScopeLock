import type { AgentId } from "../schemas/contract.js";

export type HarnessAdapter = {
  id: AgentId;
  label: string;
  docFile: "AGENTS.md" | "CLAUDE.md";
  hooksSupport: "deny" | "audit" | "none";
};

export const HARNESSES = {
  claude: {
    id: "claude",
    label: "Claude Code",
    docFile: "CLAUDE.md",
    hooksSupport: "deny",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    docFile: "AGENTS.md",
    hooksSupport: "audit",
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    docFile: "AGENTS.md",
    // Documented (not "none"): official docs confirm a PreToolUse hook
    // mechanism and the Step 0 spike live-confirmed a deny for the Bash
    // tool. See harness/capabilities.ts for the full nominal-vs-degraded
    // capability model - a ScopeLock hook adapter for Codex is not yet
    // implemented (undocumented hooks.json schema, unconfirmed apply_patch
    // event shape), so this coarse field alone should not be read as "ready
    // to enforce".
    hooksSupport: "deny",
  },
} as const satisfies Record<AgentId, HarnessAdapter>;

export function getHarness(target: AgentId): HarnessAdapter {
  return HARNESSES[target];
}
