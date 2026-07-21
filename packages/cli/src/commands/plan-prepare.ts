import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  HARNESSES,
  agentIdSchema,
  findRepoRoot,
  formatZodError,
  probeHookConfig,
  planWorkingDirectorySchema,
  schedulePlanSchema,
  writeJsonAtomic,
  type AgentEnvironmentPreflightReport,
  type AgentId,
  type PlanValidation,
  type SchedulePlan,
  type ScopeConflict,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections, renderStatusTable, type StatusRow } from "../ui.js";
import { createNoopReporter } from "../progress/noop-reporter.js";
import type { ProgressReporter } from "../progress/types.js";
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
  validationCwd?: string;
  validationChecks?: Array<{ id: string; command: string[] }>;
  acceptanceChecks?: string[];
  reporter?: ProgressReporter;
};

type ValidationCheckInput = {
  id: string;
  command: string[];
  cwd?: string;
  required: boolean;
};

type ComposedValidation = {
  checks: ValidationCheckInput[];
  setup?: string[];
} | null;

/**
 * The smallest possible precedence chain for composing an ordered validation
 * checks array from every source `plan prepare` can see. Deliberately not a
 * framework plugin registry - just an explicit, readable if/else chain that
 * mirrors the plan's stated precedence:
 *
 *   1. Explicit repeated `--validation-check <id> <argv...>` flags win.
 *   2. Legacy `--validation-command` converts to one modern check.
 *   3. An existing plan's own validation (checks or legacy command) wins
 *      over auto-detection.
 *   4. Auto-detection creates one check with a stable id.
 */
function composeValidationChecks(input: {
  explicitChecks?: Array<{ id: string; command: string[] }>;
  legacyCommand?: string[];
  legacySetupCommand?: string[];
  existing?: PlanValidation;
  detected: { id: string; command: string[]; setup?: string[] } | null;
}): ComposedValidation {
  const setup = input.legacySetupCommand?.length
    ? input.legacySetupCommand
    : input.existing?.setup ?? input.detected?.setup;

  if (input.explicitChecks?.length) {
    return {
      setup,
      checks: input.explicitChecks.map((check) => ({
        id: check.id,
        command: check.command,
        required: true,
      })),
    };
  }

  if (input.legacyCommand?.length) {
    return {
      setup,
      checks: [{ id: "repository-validation", command: input.legacyCommand, required: true }],
    };
  }

  if (input.existing?.checks) {
    return {
      setup,
      checks: input.existing.checks.map((check) => ({
        id: check.id,
        command: check.command,
        cwd: check.cwd,
        required: check.required,
      })),
    };
  }

  if (input.existing?.command) {
    return {
      setup,
      checks: [{ id: "repository-validation", command: input.existing.command, required: true }],
    };
  }

  if (input.detected) {
    return {
      setup,
      checks: [{ id: input.detected.id, command: input.detected.command, required: true }],
    };
  }

  return null;
}

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

export async function packageManagerRunCommand(
  manager: string,
  script: string,
  options: {
    platform?: NodeJS.Platform;
    nodeExecutable?: string;
  } = {},
): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || manager !== "npm") return [manager, "run", script];

  // Windows cannot spawn npm.cmd with shell:false. Invoke npm's JavaScript
  // entrypoint directly so generated plans remain shell-free and reviewable.
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const npmCli = join(dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js");
  if (!(await exists(npmCli))) {
    throw new CliError(
      "NPM_CLI_NOT_FOUND",
      `cannot compose a shell-free npm command; npm-cli.js was not found beside ${nodeExecutable}`,
    );
  }
  return [nodeExecutable, npmCli, "run", script];
}

async function detectValidationProfile(root: string): Promise<{
  id: string;
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
        const command = await packageManagerRunCommand(manager, script);
        return {
          id: script === "check" ? "npm-check" : "npm-test",
          ...(typeof values.prepare === "string"
            ? { setup: await packageManagerRunCommand(manager, "prepare") }
            : {}),
          command,
        };
      }
    }
  }
  if (await exists(join(root, "Package.swift"))) return { id: "swift-test", command: ["swift", "test"] };
  if (await exists(join(root, "Cargo.toml"))) return { id: "cargo-test", command: ["cargo", "test"] };
  if (await exists(join(root, "go.mod"))) return { id: "go-test", command: ["go", "test", "./..."] };
  return null;
}

function stageLines(stages: string[][]): string[] {
  return stages.map((stage, index) => `stage ${index + 1}: [${stage.join(", ")}]`);
}

function result(
  data: Record<string, unknown>,
  checkRows: StatusRow[],
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
      { title: "Checks", lines: renderStatusTable("Check", ["Detail"], checkRows) },
      { title: "Result", lines: humanResult },
      { title: "Next", lines: next },
    ]),
    exitCode,
  };
}

async function planPrepareWithReporter(
  planPath: string,
  options: PlanPrepareOptions,
  reporter: ProgressReporter,
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

  reporter.emit({ type: "phase", name: "scheduling" });
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
  const checkRows: StatusRow[] = [
    schedule.conflicts.length === 0
      ? { id: "Scope overlaps", status: "pass", cells: ["No overlaps found"] }
      : {
          id: "Scope overlaps",
          status: "warn",
          cells: [`${schedule.conflicts.length} ordered safely`],
          reason: "overlapping scope was reordered into separate stages",
        },
  ];
  const base = { target, schedule, checks };
  if (schedule.cycles.length > 0) {
    checks.push(`${schedule.cycles.length} unschedulable read-write group${schedule.cycles.length === 1 ? "" : "s"}`);
    checkRows.push({
      id: "Unschedulable groups",
      status: "fail",
      cells: [`${schedule.cycles.length} read-write group${schedule.cycles.length === 1 ? "" : "s"}`],
      reason: "circular dependencies block scheduling",
    });
    return result(
      { ...base, preflight: null, outputPath: null },
      checkRows,
      "Plan needs changes; no ready plan was written",
      `Adjust task boundaries, then run: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)}`,
      1,
    );
  }

  reporter.emit({ type: "phase", name: "preflight" });
  const executablePath = findAgentExecutable(target);
  const executable = { name: target === "cursor" ? "agent" : target, found: executablePath !== null, path: executablePath };
  const hook = probeHookConfig(root, target);
  checks.push(`${HARNESSES[target].label} CLI  ${executable.found ? "found" : "not found"}`);
  checkRows.push({
    // The label alone: "Codex CLI" already ends in CLI, so appending " CLI"
    // (as the JSON data.checks string historically does) would read
    // "Codex CLI CLI" in the human table. data.checks stays unchanged.
    id: HARNESSES[target].label,
    status: executable.found ? "pass" : "fail",
    cells: [executable.found ? "found" : "not found"],
    reason: executable.found ? undefined : "install the target agent's CLI",
  });
  checks.push(`Hook confidence  ${hook.capabilities.confidence}`);
  checkRows.push({
    id: "Hook confidence",
    status: hook.capabilities.confidence === "degraded" ? "warn" : "pass",
    cells: [hook.capabilities.confidence],
    // Live verification only exists for codex (`hooks verify --target codex`),
    // which is also the only target whose probe reports "degraded". Kept
    // under renderStatusTable's 100-char reason truncation limit.
    reason: hook.capabilities.confidence === "degraded"
      ? target === "codex"
        ? "project trust is not statically verifiable; run `scopelock hooks verify --target codex`"
        : "project trust could not be verified statically"
      : undefined,
  });

  let workspace: AgentEnvironmentPreflightReport | null = null;
  if (options.manifest !== undefined) {
    const preflight = await agentsPreflightCommand({ manifest: options.manifest, target: [target] });
    workspace = (preflight.data as { report: AgentEnvironmentPreflightReport }).report;
    checks.push(`Rules and skills  ${workspace.summary.status}`);
    checkRows.push({
      id: "Rules and skills",
      // summary.status is typed pass|warn|fail|blocked, but the roll-up in
      // preflight.ts never emits "blocked"; StatusRowStatus lacks it.
      status: workspace.summary.status as StatusRow["status"],
      cells: [workspace.summary.status],
      reason: workspace.summary.status !== "pass"
        ? `${workspace.summary.violationsCount} violation${workspace.summary.violationsCount === 1 ? "" : "s"} found`
        : undefined,
    });
  } else {
    checks.push("Rules and skills  not configured (no manifest supplied)");
    checkRows.push({
      id: "Rules and skills",
      status: "warn",
      cells: ["not configured"],
      reason: "no manifest supplied",
    });
  }
  const preflight = { executable, hook, workspace };
  if (!executable.found || (workspace !== null && workspace.summary.violationsCount > 0)) {
    return result(
      { ...base, preflight, outputPath: null },
      checkRows,
      "Environment needs attention; no ready plan was written",
      !executable.found
        ? `Install ${HARNESSES[target].label}, then run: scopelock setup --target ${target}`
        : `Review fixes: scopelock agents preflight --manifest ${JSON.stringify(options.manifest)} --target ${target}`,
      1,
    );
  }

  reporter.emit({ type: "phase", name: "composing" });
  const composed = await planFillCommandsCommand(planPath, {
    target,
    force: true,
    executable: executablePath ?? undefined,
  });
  const composition = composed.data as { plan: SchedulePlan; unsupported: unknown[] };
  if (composed.exitCode !== 0 || composition.unsupported.length > 0) {
    return result(
      { ...base, preflight, composition, outputPath: null },
      checkRows,
      "Agent commands could not be composed; no ready plan was written",
      "Review the unsupported tasks, then run: scopelock plan prepare",
      1,
    );
  }

  const rawValidationCwd = options.validationCwd ?? composition.plan.execution?.validation?.cwd;
  const parsedValidationCwd = rawValidationCwd === undefined
    ? undefined
    : planWorkingDirectorySchema.safeParse(rawValidationCwd);
  if (parsedValidationCwd !== undefined && !parsedValidationCwd.success) {
    throw new CliError(
      "INVALID_VALIDATION_CWD",
      "validation cwd must be a portable repository-relative directory",
    );
  }
  const validationCwd = parsedValidationCwd?.data;
  const validationRoot = validationCwd === undefined || validationCwd === "."
    ? root
    : resolve(root, validationCwd);
  const detectedValidation = await detectValidationProfile(validationRoot);
  const composedValidation = composeValidationChecks({
    explicitChecks: options.validationChecks,
    legacyCommand: options.validationCommand,
    legacySetupCommand: options.validationSetupCommand,
    existing: composition.plan.execution?.validation,
    detected: detectedValidation,
  });
  if (composedValidation === null) {
    checks.push("Repository validation  not detected");
    checkRows.push({
      id: "Repository validation",
      status: "fail",
      cells: ["not detected"],
      reason: "pass --validation-check to supply one",
    });
    return result(
      { ...base, preflight, composition, outputPath: null },
      checkRows,
      "Validation check is required; no ready plan was written",
      `Run again with: scopelock plan prepare ${JSON.stringify(planPath)} --target ${target} --out ${JSON.stringify(options.out)} --validation-check <id> <executable> [args...]`,
      1,
    );
  }
  const acceptanceCheckIds = options.acceptanceChecks?.length
    ? options.acceptanceChecks
    : composition.plan.execution?.validation?.acceptance?.checkIds ?? [];

  let readyPlan: SchedulePlan;
  try {
    readyPlan = schedulePlanSchema.parse({
      ...composition.plan,
      execution: {
        ...composition.plan.execution,
        isolation: "required",
        validation: {
          ...(validationCwd ? { cwd: validationCwd } : {}),
          ...(composedValidation.setup ? { setup: composedValidation.setup } : {}),
          checks: composedValidation.checks,
          ...(acceptanceCheckIds.length > 0 ? { acceptance: { checkIds: acceptanceCheckIds } } : {}),
        },
      },
    });
  } catch (error) {
    const message = formatZodError(error);
    if (message === null) throw error;
    throw new CliError("INVALID_VALIDATION_PROFILE", message);
  }
  await writeJsonAtomic(outputPath, readyPlan);
  checks.push(`${readyPlan.tasks.length} shell-free agent command${readyPlan.tasks.length === 1 ? "" : "s"} composed`);
  checkRows.push({ id: "Agent commands", status: "pass", cells: [`${readyPlan.tasks.length} composed`] });
  if (composedValidation.setup) {
    checks.push(`Validation setup  ${composedValidation.setup.join(" ")}`);
    checkRows.push({ id: "Validation setup", status: "pass", cells: [composedValidation.setup.join(" ")] });
  }
  if (validationCwd) {
    checks.push(`Validation cwd  ${validationCwd}`);
    checkRows.push({ id: "Validation cwd", status: "pass", cells: [validationCwd] });
  }
  for (const check of composedValidation.checks) {
    checks.push(
      `Validation check ${check.id}  required=${check.required}` +
        `${check.cwd ? ` cwd=${check.cwd}` : ""}  ${check.command.join(" ")}`,
    );
    checkRows.push({
      id: `Validation check ${check.id}`,
      status: "pass",
      cells: [`required=${check.required}${check.cwd ? ` cwd=${check.cwd}` : ""} ${check.command.join(" ")}`],
    });
  }
  return result(
    { ...base, preflight, plan: readyPlan, outputPath },
    checkRows,
    `Ready plan written  ${outputPath}\nNo agent was started`,
    `Review the file, then run: scopelock run ${JSON.stringify(outputPath)} --yes --isolate`,
    0,
  );
}

export async function planPrepareCommand(
  planPath: string,
  options: PlanPrepareOptions,
): Promise<CommandResult> {
  const reporter = options.reporter ?? createNoopReporter();
  try {
    return await planPrepareWithReporter(planPath, options, reporter);
  } finally {
    reporter.dispose();
  }
}
