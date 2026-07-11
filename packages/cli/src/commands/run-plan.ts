import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  agentEnvironmentPreflightReportSchema,
  agentWorkspaceManifestSchema,
  approvedContractSchema,
  buildConflictGraph,
  findRepoRoot,
  hashFileBytes,
  runAgentPreflight,
  schedule,
  schedulePlanSchema,
  scopelockConfigSchema,
  scopelockPaths,
  writeJsonAtomic,
  type AgentEnvironmentPreflightReport,
  type ArtifactCheckResult,
  type EnforcementMode,
  type ScopeConflict,
  type TaskScope,
  getActiveContractId,
  loadContract,
  verifyApprovalSeal,
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
  allowShell?: boolean;
  yes?: boolean;
  timeoutMs?: number;
  storeRawOutput?: boolean;
};

type CommandSpec = string | string[];

const COMMAND_PREVIEW_BYTES = 400;
const OUTPUT_PREVIEW_BYTES = 400;
const DEFAULT_TASK_TIMEOUT_MS = 15 * 60_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;

function redactSecrets(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED]")
    .replace(/\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|NPM_TOKEN|GITHUB_TOKEN)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1[REDACTED]@");
}

function appendCaptured(current: string, chunk: Buffer): string {
  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current);
  if (remaining <= 0) return current;
  return current + truncateUtf8(chunk.toString(), remaining);
}

type RunTask = {
  id: string;
  contract: string;
  command?: CommandSpec;
};

type OutputArtifact = {
  path: string;
  bytes: number;
  sha256: string;
  previewBytes: number;
  truncated: boolean;
};

type TaskRun = {
  id: string;
  status: "passed" | "failed" | "skipped";
  command: CommandSpec | null;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputArtifacts: {
    command?: OutputArtifact;
    stdout?: OutputArtifact;
    stderr?: OutputArtifact;
  };
};

type ReceiptEnvironment = {
  manifestDigest: string;
  mode: EnforcementMode;
  status: AgentEnvironmentPreflightReport["summary"]["status"];
  violationsCount: number;
  targets: Array<{
    id: string;
    version: string | null;
    rulesDigest: string | null;
    skillsDigest: string | null;
    hookConfidence: string;
    violations: string[];
  }>;
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

async function maybeReadJsonFile(path: string): Promise<unknown | null> {
  try {
    return await readJsonFile(path, "NOT_FOUND");
  } catch (error) {
    if (error instanceof CliError && error.code === "NOT_FOUND") return null;
    throw error;
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
        candidate.command.every((part) => typeof part === "string") &&
        candidate.command[0]?.length > 0
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

async function loadMode(cwd: string): Promise<EnforcementMode> {
  const raw = await readJsonFile(scopelockPaths(cwd).configPath, "NOT_INITIALIZED");
  return scopelockConfigSchema.parse(raw).mode;
}

function digestResults(results: ArtifactCheckResult[]): string | null {
  const digests = results
    .map((result) => result.digest)
    .filter((digest): digest is string => digest !== null)
    .sort();
  if (digests.length === 0) return null;
  return createHash("sha256").update(digests.join("\n")).digest("hex");
}

async function maybeEnvironment(cwd: string): Promise<ReceiptEnvironment | null> {
  const manifestPath = join(cwd, ".scopelock", "agents.json");
  const raw = await maybeReadJsonFile(manifestPath);
  if (raw === null) return null;
  const manifest = agentWorkspaceManifestSchema.parse(raw);
  const report = agentEnvironmentPreflightReportSchema.parse(
    runAgentPreflight({ manifest, repoRoot: cwd }),
  );
  const mode = await loadMode(cwd);
  return {
    manifestDigest: hashFileBytes(manifestPath),
    mode,
    status: report.summary.status,
    violationsCount: report.summary.violationsCount,
    targets: report.targets.map((target) => ({
      id: target.id,
      version: null,
      rulesDigest: digestResults(target.ruleResults),
      skillsDigest: digestResults(target.skillResults),
      hookConfidence: target.hook.capabilities.confidence,
      violations: target.violations.map((violation) => violation.code),
    })),
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

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const char of value) {
    const charBytes = Buffer.byteLength(char);
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    result += char;
  }
  return result;
}

async function persistOutput(
  artifactDir: string,
  taskId: string,
  stream: "stdout" | "stderr",
  value: string,
  storeRaw: boolean,
): Promise<{ preview: string; artifact?: OutputArtifact }> {
  if (value.length === 0) return { preview: "" };
  const safeValue = redactSecrets(value);
  const bytes = Buffer.byteLength(safeValue);
  const preview = truncateUtf8(safeValue, OUTPUT_PREVIEW_BYTES);
  const previewBytes = Buffer.byteLength(preview);
  if (!storeRaw) return { preview };
  const filePath = join(artifactDir, `${safeFilePart(taskId)}.${stream}.txt`);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await writeFile(filePath, safeValue, { encoding: "utf8", mode: 0o600 });
  return {
    preview,
    artifact: {
      path: filePath,
      bytes,
      sha256: createHash("sha256").update(safeValue).digest("hex"),
      previewBytes,
      truncated: previewBytes < bytes,
    },
  };
}

function previewCommand(command: CommandSpec, maxBytes: number): CommandSpec {
  if (typeof command === "string") return truncateUtf8(redactSecrets(command), maxBytes);
  let remaining = maxBytes;
  return command.map((part) => {
    const preview = truncateUtf8(redactSecrets(part), Math.max(0, remaining));
    remaining -= Buffer.byteLength(preview);
    return preview;
  });
}

async function persistCommand(
  artifactDir: string,
  taskId: string,
  command: CommandSpec | null,
  storeRaw: boolean,
): Promise<{ preview: CommandSpec | null; artifact?: OutputArtifact }> {
  if (command === null) return { preview: null };
  const safeCommand = typeof command === "string" ? redactSecrets(command) : command.map(redactSecrets);
  const raw = `${JSON.stringify(safeCommand, null, 2)}\n`;
  const bytes = Buffer.byteLength(raw);
  const preview = previewCommand(command, COMMAND_PREVIEW_BYTES);
  const previewBytes = Buffer.byteLength(JSON.stringify(preview));
  if (!storeRaw || previewBytes >= bytes) return { preview };
  const filePath = join(artifactDir, `${safeFilePart(taskId)}.command.json`);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await writeFile(filePath, raw, { encoding: "utf8", mode: 0o600 });
  return {
    preview,
    artifact: {
      path: filePath,
      bytes,
      sha256: createHash("sha256").update(raw).digest("hex"),
      previewBytes,
      truncated: true,
    },
  };
}

async function runCommand(
  cwd: string,
  artifactDir: string,
  task: RunTask,
  timeoutMs: number,
  storeRawOutput: boolean,
): Promise<TaskRun> {
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
      outputArtifacts: {},
    };
  }
  const command = task.command;
  const persistedCommand = await persistCommand(artifactDir, task.id, command, storeRawOutput);
  return new Promise((finish) => {
    let settled = false;
    const finishOnce = (result: TaskRun) => {
      if (settled) return;
      settled = true;
      finish(result);
    };
    const child = Array.isArray(command)
      ? spawn(command[0] as string, command.slice(1), {
          cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(command, [], { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = appendCaptured(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendCaptured(stderr, chunk);
    });
    child.on("error", async (error) => {
      clearTimeout(timer);
      const persistedStderr = await persistOutput(artifactDir, task.id, "stderr", error.message, storeRawOutput);
      finishOnce({
        id: task.id,
        status: "failed",
        command: persistedCommand.preview,
        exitCode: null,
        durationMs: Date.now() - started,
        stdout: "",
        stderr: persistedStderr.preview,
        outputArtifacts: {
          ...(persistedCommand.artifact ? { command: persistedCommand.artifact } : {}),
          ...(persistedStderr.artifact ? { stderr: persistedStderr.artifact } : {}),
        },
      });
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (timedOut) stderr += `${stderr.length > 0 ? "\n" : ""}task timed out after ${timeoutMs}ms`;
      const persistedStdout = await persistOutput(artifactDir, task.id, "stdout", stdout, storeRawOutput);
      const persistedStderr = await persistOutput(artifactDir, task.id, "stderr", stderr, storeRawOutput);
      finishOnce({
        id: task.id,
        status: code === 0 ? "passed" : "failed",
        command: persistedCommand.preview,
        exitCode: code,
        durationMs: Date.now() - started,
        stdout: persistedStdout.preview,
        stderr: persistedStderr.preview,
        outputArtifacts: {
          ...(persistedCommand.artifact ? { command: persistedCommand.artifact } : {}),
          ...(persistedStdout.artifact ? { stdout: persistedStdout.artifact } : {}),
          ...(persistedStderr.artifact ? { stderr: persistedStderr.artifact } : {}),
        },
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
  const executableTasks = runTasks.filter((task) => task.command !== undefined);
  if (executableTasks.length > 0 && options.yes !== true) {
    throw new CliError(
      "PLAN_CONFIRMATION_REQUIRED",
      "plan commands execute with your user privileges; review the plan and pass --yes to run it",
    );
  }
  const shellTasks = executableTasks.filter((task) => typeof task.command === "string");
  if (shellTasks.length > 0 && options.allowShell !== true) {
    throw new CliError(
      "SHELL_COMMAND_NOT_ALLOWED",
      `string shell commands require --allow-shell (tasks: ${shellTasks.map((task) => task.id).join(", ")})`,
    );
  }
  const activeId = await getActiveContractId(scopelockPaths(cwd));
  if (activeId === null) {
    throw new CliError("NO_ACTIVE_CONTRACT", "scopelock run requires an active approved contract");
  }
  const activeContract = await loadContract(scopelockPaths(cwd), activeId);
  const approvalIntegrity = await verifyApprovalSeal(cwd, activeContract);
  if (!approvalIntegrity.ok) {
    throw new CliError("APPROVAL_INTEGRITY_ERROR", approvalIntegrity.detail);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const storeRawOutput = options.storeRawOutput === true;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CliError("INVALID_TIMEOUT", "--timeout-ms must be a positive integer");
  }
  const planPath = isAbsolute(options.plan) ? options.plan : resolve(cwd, options.plan);
  const contractDigests = Object.fromEntries(
    runTasks.map((task) => {
      const path = isAbsolute(task.contract) ? task.contract : resolve(cwd, task.contract);
      return [task.id, { path: task.contract, sha256: hashFileBytes(path) }];
    }),
  );

  const scopes: TaskScope[] = [];
  for (const task of plan.tasks) {
    scopes.push(await loadTaskScope(task));
  }

  const graph = buildConflictGraph(scopes, { readHazards: options.readHazards !== false });
  const { waves, cycles } = schedule(graph);
  const deferred = options.deferWriteConflicts === false ? [] : deferredWriteConflictTasks(graph.conflicts);
  const deferredSet = new Set(deferred);
  const receiptPath = resolveReceiptPath(cwd, options.receipt);
  const artifactDir = join(dirname(receiptPath), `${basename(receiptPath, ".json")}-artifacts`);
  const startedAt = new Date().toISOString();
  const taskRuns: TaskRun[] = [];
  const environment = await maybeEnvironment(cwd);
  const blockedByEnvironment = environment?.mode === "strict" && environment.status === "fail";

  if (blockedByEnvironment) {
    for (const task of runTasks) {
      const persistedCommand = await persistCommand(artifactDir, task.id, task.command ?? null, storeRawOutput);
      taskRuns.push({
        id: task.id,
        status: "skipped",
        command: persistedCommand.preview,
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: "blocked by agent environment preflight",
        outputArtifacts: {
          ...(persistedCommand.artifact ? { command: persistedCommand.artifact } : {}),
        },
      });
    }
  } else if (cycles.length === 0) {
    for (const wave of waves) {
      const runnable = wave
        .filter((id) => !deferredSet.has(id))
        .map((id) => byId.get(id))
        .filter((task): task is RunTask => task !== undefined);
      taskRuns.push(
        ...(await Promise.all(runnable.map((task) => runCommand(cwd, artifactDir, task, timeoutMs, storeRawOutput)))),
      );
    }
  }

  for (const id of deferred) {
    const persistedCommand = await persistCommand(artifactDir, id, byId.get(id)?.command ?? null, storeRawOutput);
    taskRuns.push({
      id,
      status: "skipped",
      command: persistedCommand.preview,
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: "deferred due to write-write conflict",
      outputArtifacts: {
        ...(persistedCommand.artifact ? { command: persistedCommand.artifact } : {}),
      },
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

  const receipt = {
    schemaVersion: 4,
    planId: plan.planId,
    startedAt,
    finishedAt: new Date().toISOString(),
    limits: {
      commandPreviewBytes: COMMAND_PREVIEW_BYTES,
      outputPreviewBytes: OUTPUT_PREVIEW_BYTES,
      rawOutputStorage: storeRawOutput ? "local-redacted-artifacts" : "disabled",
      maxCapturedBytesPerStream: MAX_CAPTURE_BYTES,
      taskTimeoutMs: timeoutMs,
    },
    inputs: {
      plan: { path: options.plan, sha256: hashFileBytes(planPath) },
      contracts: contractDigests,
      shellAllowed: options.allowShell === true,
    },
    artifactsDir: artifactDir,
    environment,
    approvalIntegrity,
    blockedByEnvironment,
    waves,
    conflicts: graph.conflicts,
    cycles,
    deferredTasks: deferred,
    handoffSummary: {
      passedTasks: taskRuns.filter((task) => task.status === "passed").map((task) => task.id).sort(),
      failedTasks: taskRuns.filter((task) => task.status === "failed").map((task) => task.id).sort(),
      skippedTasks: taskRuns.filter((task) => task.status === "skipped").map((task) => task.id).sort(),
      driftStatus: drift?.status ?? "not_checked",
      environmentStatus: environment?.status ?? "not_configured",
    },
    taskRuns,
    drift,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeJsonAtomic(receiptPath, receipt);

  const hasFailedTask = taskRuns.some((task) => task.status === "failed");
  const hasSkippedTask = taskRuns.some((task) => task.status === "skipped");
  const hasDriftProblems = drift?.status === "violations" || drift?.status === "error";
  const hasEnvironmentProblems = environment !== null && environment.status === "fail";
  const exitCode: ExitCode =
    cycles.length > 0 || hasFailedTask || hasSkippedTask || hasDriftProblems || hasEnvironmentProblems
      ? 1
      : 0;

  return {
    data: { receiptPath, receipt },
    human: humanReport(plan.planId, receiptPath, taskRuns),
    exitCode,
  };
}
