import type { AgentId, ApprovedContract } from "../schemas/contract.js";
import { getHarness } from "../harness/registry.js";

function list(items: string[], empty: string): string {
  if (items.length === 0) return `- ${empty}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function tests(contract: ApprovedContract): string {
  if (contract.tests.length === 0) return "- No explicit test requirement.";
  return contract.tests
    .map((test) => {
      const command = test.command === null ? "" : `: \`${test.command}\``;
      return `- ${test.type}${command}`;
    })
    .join("\n");
}

export function renderAgentPrompt(
  contract: ApprovedContract,
  target: AgentId,
): string {
  const harness = getHarness(target);
  return [
    `# ScopeLock Contract: ${contract.id}`,
    "",
    `Target: ${harness.label}`,
    "",
    "## Task",
    contract.task,
    "",
    "## Approved Scope",
    list(contract.scope.plannedPathPatterns, "No planned path patterns; treat the current approved task as the scope."),
    "",
    "## Forbidden",
    contract.scope.forbiddenPathPatterns.length === 0
      ? "- No explicit forbidden path patterns."
      : `${list(contract.scope.forbiddenPathPatterns, "")}\n\nDo NOT modify these paths. If the task requires it, stop and ask before editing.`,
    "",
    "## Required Tests",
    tests(contract),
    "",
    "## Assumptions",
    list(contract.assumptions, "No recorded assumptions."),
    "",
    "## Open Questions",
    list(contract.openQuestions, "No open questions."),
    "",
    "## Final Instruction",
    "Stay inside the approved scope, run the required tests when relevant, call the ScopeLock `check_drift` MCP tool before finishing, resolve any violations, and stop to ask when the change appears to require forbidden or unapproved files.",
    "",
  ].join("\n");
}
