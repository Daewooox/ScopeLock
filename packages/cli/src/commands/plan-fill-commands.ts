import { isAbsolute, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  AgentInvocationError,
  agentIdSchema,
  approvedContractSchema,
  buildAgentCommand,
  renderAgentPrompt,
  schedulePlanSchema,
  writeJsonAtomic,
  type AgentId,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

type FillCommandsOptions = {
  target: string;
  out?: string;
  force?: boolean;
};

async function readJson(path: string, notFoundCode: string): Promise<unknown> {
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

async function commandFor(
  contractPath: string,
  target: AgentId,
  isolationBound: boolean,
): Promise<string[]> {
  const raw = await readJson(contractPath, "CONTRACT_NOT_FOUND");
  const contract = approvedContractSchema.parse(raw);
  if (contract.baseline === null) {
    throw new CliError(
      "CONTRACT_NOT_APPROVED",
      `contract ${contract.id} has no approved git baseline; run scopelock contract approve first`,
    );
  }
  return buildAgentCommand(target, renderAgentPrompt(contract, target), { isolationBound });
}

export async function planFillCommandsCommand(
  planPath: string,
  options: FillCommandsOptions,
): Promise<CommandResult> {
  const target = agentIdSchema.parse(options.target);
  const isolationBound = target === "cursor";
  const cwd = process.cwd();
  const plan = schedulePlanSchema.parse(await readJson(planPath, "PLAN_NOT_FOUND"));
  const tasks = [];
  const unsupported: Array<{ taskId: string; target: AgentId; reason: string }> = [];

  for (const task of plan.tasks) {
    if (task.command !== undefined && options.force !== true) {
      tasks.push(task);
      continue;
    }
    const contractPath = isAbsolute(task.contract) ? task.contract : resolve(cwd, task.contract);
    try {
      tasks.push({ ...task, command: await commandFor(contractPath, target, isolationBound) });
    } catch (error) {
      if (error instanceof AgentInvocationError && error.code === "UNSUPPORTED_TARGET") {
        unsupported.push({ taskId: task.id, target, reason: error.message });
        tasks.push(task);
        continue;
      }
      if (error instanceof AgentInvocationError) {
        throw new CliError(error.code, `task ${task.id}: ${error.message}`);
      }
      throw error;
    }
  }

  const enrichedPlan = schedulePlanSchema.parse({
    ...plan,
    ...(isolationBound ? { execution: { isolation: "required" } } : {}),
    tasks,
  });
  const outputPath = options.out
    ? isAbsolute(options.out)
      ? options.out
      : resolve(cwd, options.out)
    : null;
  if (outputPath !== null) await writeJsonAtomic(outputPath, enrichedPlan);

  const unsupportedLines = unsupported.map(
    (item) => `unsupported ${item.taskId}: ${item.reason}`,
  );
  const filled = tasks.filter((task, index) => task.command !== plan.tasks[index]?.command).length;
  const human = outputPath === null
    ? [...unsupportedLines, ...(unsupportedLines.length > 0 ? [""] : []), JSON.stringify(enrichedPlan, null, 2)].join("\n")
    : renderSections([
        { title: "Context", lines: [`Plan  ${plan.planId}`, `Target  ${target}`] },
        {
          title: "Checks",
          lines: [
            `${filled} task command${filled === 1 ? "" : "s"} composed`,
            ...(isolationBound ? ["Isolated execution required"] : []),
            ...unsupportedLines,
          ],
        },
        {
          title: "Result",
          lines: unsupported.length > 0
            ? `Plan needs attention\nOutput  ${outputPath}`
            : `Reviewable plan prepared\nOutput  ${outputPath}\nNo agent was started`,
        },
        {
          title: "Next",
          lines: unsupported.length > 0
            ? "Resolve unsupported tasks, then compose the plan again"
            : `Review the file, then run: scopelock run ${JSON.stringify(outputPath)} --yes${isolationBound ? " --isolate" : ""}`,
        },
      ]);

  return {
    data: { plan: enrichedPlan, outputPath, unsupported },
    human,
    exitCode: unsupported.length > 0 ? 1 : 0,
  };
}
