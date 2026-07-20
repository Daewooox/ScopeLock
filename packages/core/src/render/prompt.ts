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

export type AgentPromptContext = {
  execution: "interactive" | "restricted-runner";
  finalDriftOwner: "agent-if-available" | "runner";
  validationOwner: "agent-if-available" | "runner";
};

const INTERACTIVE_CONTEXT: AgentPromptContext = {
  execution: "interactive",
  finalDriftOwner: "agent-if-available",
  validationOwner: "agent-if-available",
};

function finalInstruction(context: AgentPromptContext): string {
  if (context.execution === "restricted-runner") {
    return "Stay inside the approved scope and write or update the regression tests this change requires. "
      + "The ScopeLock runner owns authoritative repository validation and will check final scope and drift "
      + "once this command finishes; do not search for a drift-checking tool and do not claim you executed "
      + "tests yourself. Stop and describe the blocker if the change appears to require forbidden or "
      + "unapproved files.";
  }
  return "Stay inside the approved scope, write or update the regression tests this change requires, and run them "
    + "if your harness can execute commands; otherwise give the user the exact command to run. If the ScopeLock "
    + "MCP `check_drift` tool is available, call it before finishing and resolve any violations; otherwise tell "
    + "the user to run `scopelock check-drift`, and stop to ask when the change appears to require forbidden or "
    + "unapproved files.";
}

export function renderAgentPrompt(
  contract: ApprovedContract,
  target: AgentId,
  context: AgentPromptContext = INTERACTIVE_CONTEXT,
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
    finalInstruction(context),
    "",
  ].join("\n");
}
