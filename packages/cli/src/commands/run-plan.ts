import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import {
  approvedContractSchema,
  buildConflictGraph,
  findRepoRoot,
  schedule,
  schedulePlanSchema,
  scopelockPaths,
  writeJsonAtomic,
  type ScopeConflict,
  type TaskScope,
} from "@scopelock/core";
import { readFile } from "node:fs/promises";
import { checkDriftCommand } from "./check-drift.js";
import { CliError, type CommandResult, type ExitCode } from "../run.js";

type RunPlanOptions = {
  plan: string;
  readHazards?: boolean;
  deferWriteConflicts?: boolean;
  checkDrift?: boolean;
  receipt?: string;
};

type CommandSpec = string | string[];

type RunTask = {
  id: string;
  contract: string;
  command?: CommandSpec;
};

type TaskRun = {
  id: string;
  status: "passed" | "failed" | "skipped";
  command: CommandSpec | null;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
};

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

function parseRunTasks(planRaw: unknown): RunTask[] {
  if (typeof planRaw !== "object" || planRaw === null || !("tasks" in planRaw)) {
    throw new CliError("INVALID_INPUT", "plan must contain tasks");
  }
  const tasks = (planRaw as { tasks: unknown }).tasks;
  if (!Array.isArray(tasks)) {
    throw new CliError("INVALID_INPUT", "plan tasks must be an array");
  }
  return tasks.map((task) => {
    if (typeof task !== "object" || task === null) {
      throw new CliError("INVALID_INPUT", "plan task must be an object");
    }
    const candidate = task as { id?: unknown; contract?: unknown; command?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.contract !== "string") {
      throw new CliError("INVALID_INPUT", "plan task must include string id and contract");
    }
    if (
      candidate.command !== undefined &&
      typeof candidate.command !== "string" &&
      !(
        Array.isArray(candidate.command) &&
        candidate.command.length > 0 &&
        candidate.command.every((part) => typeof part === "string")
      )
    ) {
      throw new CliError(
        "INVALID_INPUT",
        `task ${candidate.id} command must be a string or non-empty string[]`,
      );
    }
    return {
      id: candidate.id,
      contract: candidate.contract,
      command: candidate.command as CommandSpec | undefined,
    };
  });
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

function deferredWriteConflictTasks(conflicts: ScopeConflict[]): string[] {
  const deferred = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.kind === "write-write") {
      deferred.add([conflict.a, conflict.b].sort()[1]);
    }
  }
  return [...deferred].sort();
}

function resolveReceiptPath(cwd: string, receipt: string | undefined): string {
  if (receipt) return isAbsolute(receipt) ? receipt : join(cwd, receipt);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return join(scopelockPaths(cwd).reportsDir, `run-${stamp}.json`);
}

async function runCommand(cwd: string, task: RunTask): Promise<TaskRun> {
  const started = Date.now();
  if (!task.command) {
    return {
      id: task.id,
      status: "skipped",
      command: null,
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: "no command configured",
    };
  }
  const command = task.command;
  return new Promise((resolve) => {
    const child = Array.isArray(command)
      ? spawn(command[0] as string, command.slice(1), {
          cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(command, [], { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        id: task.id,
        status: code === 0 ? "passed" : "failed",
        command,
        exitCode: code,
        durationMs: Date.now() - started,
        stdout,
        stderr,
      });
    });
  });
}

function humanReport(planId: string, receiptPath: string, taskRuns: TaskRun[]): string {
  const failed = taskRuns.filter((task) => task.status === "failed").map((task) => task.id);
  const skipped = taskRuns.filter((task) => task.status === "skipped").map((task) => task.id);
  const lines = [
    `run ${planId}`,
    `receipt: ${receiptPath}`,
    `tasks: ${taskRuns.length}, failed: ${failed.length}, skipped: ${skipped.length}`,
  ];
  if (failed.length > 0) lines.push(`failed: [${failed.join(", ")}]`);
  if (skipped.length > 0) lines.push(`skipped: [${skipped.join(", ")}]`);
  return lines.join("\n");
}

export async function runPlanCommand(options: RunPlanOptions): Promise<CommandResult> {
  const cwd = findRepoRoot(process.cwd());
  if (cwd === null) {
    throw new CliError("NOT_A_GIT_REPO", "scopelock run must be executed inside a git repository");
  }
  const planRaw = await readJsonFile(options.plan, "PLAN_NOT_FOUND");
  const plan = schedulePlanSchema.parse(planRaw);
  const runTasks = parseRunTasks(planRaw);
  const byId = new Map(runTasks.map((task) => [task.id, task]));

  const scopes: TaskScope[] = [];
  for (const task of plan.tasks) {
    scopes.push(await loadTaskScope(task));
  }

  const graph = buildConflictGraph(scopes, { readHazards: options.readHazards !== false });
  const { waves, cycles } = schedule(graph);
  const deferred = options.deferWriteConflicts === false ? [] : deferredWriteConflictTasks(graph.conflicts);
  const deferredSet = new Set(deferred);
  const startedAt = new Date().toISOString();
  const taskRuns: TaskRun[] = [];

  if (cycles.length === 0) {
    for (const wave of waves) {
      const runnable = wave
        .filter((id) => !deferredSet.has(id))
        .map((id) => byId.get(id))
        .filter((task): task is RunTask => task !== undefined);
      taskRuns.push(...(await Promise.all(runnable.map((task) => runCommand(cwd, task)))));
    }
  }

  for (const id of deferred) {
    taskRuns.push({
      id,
      status: "skipped",
      command: byId.get(id)?.command ?? null,
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: "deferred due to write-write conflict",
    });
  }

  let drift: { status: "ok" | "violations" | "error"; data?: unknown; error?: string } | null = null;
  if (options.checkDrift !== false) {
    try {
      const result = await checkDriftCommand({});
      drift = { status: result.exitCode === 0 ? "ok" : "violations", data: result.data };
    } catch (error) {
      drift = { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }

  const receiptPath = resolveReceiptPath(cwd, options.receipt);
  const receipt = {
    schemaVersion: 1,
    planId: plan.planId,
    startedAt,
    finishedAt: new Date().toISOString(),
    waves,
    conflicts: graph.conflicts,
    cycles,
    deferredTasks: deferred,
    taskRuns,
    drift,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeJsonAtomic(receiptPath, receipt);

  const hasFailedTask = taskRuns.some((task) => task.status === "failed");
  const hasSkippedTask = taskRuns.some((task) => task.status === "skipped");
  const hasDriftProblems = drift?.status === "violations" || drift?.status === "error";
  const exitCode: ExitCode = cycles.length > 0 || hasFailedTask || hasSkippedTask || hasDriftProblems ? 1 : 0;

  return {
    data: { receiptPath, receipt },
    human: humanReport(plan.planId, receiptPath, taskRuns),
    exitCode,
  };
}
