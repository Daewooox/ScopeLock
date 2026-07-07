import { readFile } from "node:fs/promises";
import {
  approvedContractSchema,
  buildConflictGraph,
  schedule,
  schedulePlanSchema,
  type ScopeConflict,
  type TaskScope,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";

async function readJsonFile(path: string, notFoundCode: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CliError(notFoundCode, `file not found: ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError("INVALID_JSON", `invalid JSON in ${path}`);
  }
}

async function loadTaskScope(task: { id: string; contract: string }): Promise<TaskScope> {
  const raw = await readJsonFile(task.contract, "CONTRACT_NOT_FOUND");
  const contract = approvedContractSchema.parse(raw);
  return {
    id: task.id,
    planned: contract.scope.plannedPathPatterns,
    forbidden: contract.scope.forbiddenPathPatterns,
  };
}

function humanConflict(conflict: ScopeConflict): string {
  const witness = conflict.witness ?? "(no witness)";
  return `  ${conflict.a} x ${conflict.b} [${conflict.kind}]: ${witness}`;
}

function humanReport(planId: string, waves: string[][], conflicts: ScopeConflict[]): string {
  const lines = [
    `plan ${planId}`,
    ...waves.map((wave, index) => `wave ${index + 1}: [${wave.join(", ")}]`),
  ];
  if (conflicts.length > 0) {
    lines.push("conflicts:", ...conflicts.map(humanConflict));
  }
  return lines.join("\n");
}

export async function planParallelCommand(
  planPath: string,
  options: { includeReadHazards?: boolean } = {},
): Promise<CommandResult> {
  const planRaw = await readJsonFile(planPath, "PLAN_NOT_FOUND");
  const plan = schedulePlanSchema.parse(planRaw);

  const scopes: TaskScope[] = [];
  for (const task of plan.tasks) {
    scopes.push(await loadTaskScope(task));
  }

  const graph = buildConflictGraph(scopes, { readHazards: options.includeReadHazards === true });
  const { waves } = schedule(graph);

  return {
    data: { planId: plan.planId, waves, conflicts: graph.conflicts },
    human: humanReport(plan.planId, waves, graph.conflicts),
    exitCode: 0,
  };
}
