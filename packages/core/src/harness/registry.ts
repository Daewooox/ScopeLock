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
    hooksSupport: "none",
  },
} as const satisfies Record<AgentId, HarnessAdapter>;

export function getHarness(target: AgentId): HarnessAdapter {
  return HARNESSES[target];
}
