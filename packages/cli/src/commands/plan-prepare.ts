import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  HARNESSES,
  agentIdSchema,
  findRepoRoot,
  probeHookConfig,
  schedulePlanSchema,
  writeJsonAtomic,
  type AgentEnvironmentPreflightReport,
  type AgentId,
  type SchedulePlan,
  type ScopeConflict,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";
import { agentsPreflightCommand } from "./agents-preflight.js";
import { planFillCommandsCommand } from "./plan-fill-commands.js";
import { planParallelCommand } from "./plan-parallel.js";
import { findAgentExecutable } from "./setup.js";

type PlanPrepareOptions = {
  target: string;
  out: string;
  manifest?: string;
  readHazards?: boolean;
  validationCommand?: string[];
  validationSetupCommand?: string[];
};

type ScheduleData = {
  planId: string;
  waves: string[][];
  conflicts: ScopeConflict[];
  cycles: string[][];
};

function parseTarget(raw: string): AgentId {
  const parsed = agentIdSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CliError("UNKNOWN_TARGET", `unknown agent target: ${raw}`);
  }
  return parsed.data;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectValidationProfile(root: string): Promise<{
  setup?: string[];
  command: string[];
} | null> {
  const packagePath = join(root, "package.json");
  if (await exists(packagePath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(packagePath, "utf8"));
    } catch {
      throw new CliError("INVALID_PACKAGE_JSON", `cannot detect validation from ${packagePath}`);
    }
    const scripts = typeof parsed === "object" && parsed !== null && "scripts" in parsed
      ? (parsed as { scripts?: unknown }).scripts
      : null;
    if (typeof scripts === "object" && scripts !== null) {
      const values = scripts as Record<string, unknown>;
      const script = typeof values.check === "string"
        ? "check"
        : typeof values.test === "string"
          ? "test"
          : null;
      if (script !== null) {
        const manager = await exists(join(root, "pnpm-lock.yaml"))
          ? "pnpm"
          : await exists(join(root, "yarn.lock"))
            ? "yarn"
            : await exists(join(root, "bun.lock")) || await exists(join(root, "bun.lockb"))
              ? "bun"
              : "npm";
        return {
          ...(typeof values.prepare === "string" ? { setup: [manager, "run", "prepare"] } : {}),
          command: [manager, "run", script],
        };
      }
    }
  }
  if (await exists(join(root, "Package.swift"))) return { command: ["swift", "test"] };
  if (await exists(join(root, "Cargo.toml"))) return { command: ["cargo", "test"] };
  if (await exists(join(root, "go.mod"))) return { command: ["go", "test", "./..."] };
  return null;
}

function stageLines(stages: string[][]): string[] {
  return stages.map((stage, index) => `stage ${index + 1}: [${stage.join(", ")}]`);
}

function result(
  data: Record<string, unknown>,
  humanResult: string,
  next: string,
  exitCode: 0 | 1,
): CommandResult {
  const schedule = data.schedule as ScheduleData;
  const stages = stageLines(schedule.waves);
  return {
    data: { ...data, stages: schedule.waves, conflicts: schedule.conflicts, cycles: schedule.cycles },
    human: renderSections([
      { title: "Context", lines: [`Plan    ${schedule.planId}`, `Target  ${String(data.target)}`] },
      { title: "Execution stages", lines: stages.length > 0 ? stages : "none" },
      { title: "Checks", lines: data.checks as string[] },
      { title: "Result", lines: humanResult },
      { title: "Next", lines: next },
    ]),
    exitCode,
  };
}

export async function planPrepareCommand(
  planPath: string,
  options: PlanPrepareOptions,
): Promise<CommandResult> {
  const target = parseTarget(options.target);
  const cwd = process.cwd();
  const root = findRepoRoot(cwd);
  if (root === null) throw new CliError("NOT_A_GIT_REPO", "plan prepare must run inside a git repository");

  const outputPath = isAbsolute(options.out) ? options.out : resolve(cwd, options.out);
  const inputPath = isAbsolute(planPath) ? planPath : resolve(cwd, planPath);
  if (outputPath === inputPath) {
    throw new CliError("OUTPUT_MUST_DIFFER", "ready plan output must differ from the input plan");
  }

  const scheduled = await planParallelCommand(planPath, {
    includeReadHazards: options.readHazards !== false,
    requireApproved: true,
  });
  const schedule = scheduled.data as ScheduleData;
  const checks = [
    schedule.conflicts.length === 0
      ? "No scope overlaps found"
      : `${schedule.conflicts.length} scope overlap${schedule.conflicts.length === 1 ? "" : "s"} ordered safely`,
  ];
  const base = { target, schedule, checks };
  if (schedule.cycles.length > 0) {
    checks.push(`${schedule.cycles.length} unschedulable read-write group${schedule.cycles.length === 1 ? "" : "s"}`);
    return result(
      { ...base, preflight: null, outputPath: null },
      "Plan needs changes; no ready plan was written",
      `Adjust task boundaries, then run: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)}`,
      1,
    );
  }

  const executablePath = findAgentExecutable(target);
  const executable = { name: target === "cursor" ? "agent" : target, found: executablePath !== null, path: executablePath };
  const hook = probeHookConfig(root, target);
  checks.push(`${HARNESSES[target].label} CLI  ${executable.found ? "found" : "not found"}`);
  checks.push(`Hook confidence  ${hook.capabilities.confidence}`);

  let workspace: AgentEnvironmentPreflightReport | null = null;
  if (options.manifest !== undefined) {
    const preflight = await agentsPreflightCommand({ manifest: options.manifest, target: [target] });
    workspace = (preflight.data as { report: AgentEnvironmentPreflightReport }).report;
    checks.push(`Rules and skills  ${workspace.summary.status}`);
  } else {
    checks.push("Rules and skills  not configured (no manifest supplied)");
  }
  const preflight = { executable, hook, workspace };
  if (!executable.found || (workspace !== null && workspace.summary.violationsCount > 0)) {
    return result(
      { ...base, preflight, outputPath: null },
      "Environment needs attention; no ready plan was written",
      !executable.found
        ? `Install ${HARNESSES[target].label}, then run: scopelock setup --target ${target}`
        : `Review fixes: scopelock agents preflight --manifest ${JSON.stringify(options.manifest)} --target ${target}`,
      1,
    );
  }

  const composed = await planFillCommandsCommand(planPath, {
    target,
    force: true,
    executable: executablePath ?? undefined,
  });
  const composition = composed.data as { plan: SchedulePlan; unsupported: unknown[] };
  if (composed.exitCode !== 0 || composition.unsupported.length > 0) {
    return result(
      { ...base, preflight, composition, outputPath: null },
      "Agent commands could not be composed; no ready plan was written",
      "Review the unsupported tasks, then run: scopelock plan prepare",
      1,
    );
  }

  const detectedValidation = await detectValidationProfile(root);
  const validationCommand = options.validationCommand?.length
    ? options.validationCommand
    : composition.plan.execution?.validation?.command ?? detectedValidation?.command ?? null;
  const validationSetup = options.validationSetupCommand?.length
    ? options.validationSetupCommand
    : composition.plan.execution?.validation?.setup ?? detectedValidation?.setup;
  if (validationCommand === null || validationCommand.length === 0) {
    checks.push("Repository validation  not detected");
    return result(
      { ...base, preflight, composition, outputPath: null },
      "Validation command is required; no ready plan was written",
      `Run again with: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)} --validation-command <executable> [args...]`,
      1,
    );
  }
  const readyPlan = schedulePlanSchema.parse({
    ...composition.plan,
    execution: {
      ...composition.plan.execution,
      isolation: "required",
      validation: {
        ...(validationSetup ? { setup: validationSetup } : {}),
        command: validationCommand,
      },
    },
  });
  await writeJsonAtomic(outputPath, readyPlan);
  checks.push(`${readyPlan.tasks.length} shell-free agent command${readyPlan.tasks.length === 1 ? "" : "s"} composed`);
  if (validationSetup) checks.push(`Validation setup  ${validationSetup.join(" ")}`);
  checks.push(`Validation  ${validationCommand.join(" ")}`);
  return result(
    { ...base, preflight, plan: readyPlan, outputPath },
    `Ready plan written  ${outputPath}\nNo agent was started`,
    `Review the file, then run: scopelock run ${JSON.stringify(outputPath)} --yes --isolate`,
    0,
  );
}
