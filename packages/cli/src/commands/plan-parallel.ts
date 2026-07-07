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
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CliError(notFoundCode, `file not found: ${path}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError("FILE_READ_ERROR", `cannot read ${path}: ${message}`);
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
    read: contract.scope.readPathPatterns,
  };
}

function humanConflict(conflict: ScopeConflict): string {
  const witness = conflict.witness ?? "(no witness)";
  return `  ${conflict.a} x ${conflict.b} [${conflict.kind}]: ${witness}`;
}

function humanReport(
  planId: string,
  waves: string[][],
  conflicts: ScopeConflict[],
  cycles: string[][],
): string {
  const lines = [`plan ${planId}`];
  if (cycles.length > 0) {
    lines.push(
      "error: not parallelizable - read-write cycles detected (serialize or redesign contracts):",
      ...cycles.map((cycle) => `  cycle: [${cycle.join(", ")}]`),
    );
  }
  lines.push(...waves.map((wave, index) => `wave ${index + 1}: [${wave.join(", ")}]`));
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

  const readHazards = options.includeReadHazards === true;
  const graph = buildConflictGraph(scopes, { readHazards });
  const { waves, cycles } = schedule(graph);

  return {
    data: { planId: plan.planId, waves, conflicts: graph.conflicts, cycles },
    human: humanReport(plan.planId, waves, graph.conflicts, cycles),
    exitCode: cycles.length > 0 ? 1 : 0,
  };
}
