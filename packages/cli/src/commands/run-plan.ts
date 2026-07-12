import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  agentEnvironmentPreflightReportSchema,
  applyPreparedPatch,
  agentWorkspaceManifestSchema,
  approvedContractSchema,
  assertIsolationReady,
  buildConflictGraph,
  commitIntegrationWave,
  createIsolatedWorktree,
  createIsolationTempRoot,
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
  type CommandSpec,
  type EnforcementMode,
  type ScopeConflict,
  type TaskScope,
  getActiveContractId,
  loadContract,
  prepareAggregatePatch,
  prepareScopedPatch,
  removeIsolatedWorktree,
  verifyApprovalSeal,
  worktreeHead,
  type ApprovedContract,
  type IsolatedWorktree,
  type PreparedPatch,
  WorktreeError,
} from "@scopelock/core";
import { checkDriftCommand } from "./check-drift.js";
import { CliError, type CommandResult, type ExitCode } from "../run.js";
import { color, renderTable, statusLabel } from "../ui.js";

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
  isolate?: boolean;
};

/**
 * Interpreter basenames that execute an inline command string just like
 * `shell: true` would - an argv array of the form `["sh", "-c", "..."]` is
 * not meaningfully safer than the string form `--allow-shell` gates. Matching
 * on basename (case-insensitive, extension-stripped) so `/bin/sh`,
 * `C:\Windows\System32\cmd.exe`, etc. are all caught, not just a bare name.
 */
const SHELL_INTERPRETER_BASENAMES = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "cmd",
  "powershell",
  "pwsh",
]);

/** `-c`, `/c`, `-Command`, `/Command`, ... - the "run this string" flag, whatever the shell family calls it. */
const SHELL_INLINE_COMMAND_FLAG = /^[-/](c|command)$/i;

function stripExeSuffix(name: string): string {
  return name.toLowerCase().endsWith(".exe") ? name.slice(0, -4) : name;
}

/**
 * True when `command` will execute through a shell one way or another: the
 * string form (always spawned with `shell: true`, see runCommand below), or
 * an argv array whose first element is a known shell interpreter invoked
 * with its inline-command flag - `--allow-shell` must gate both, or it gates
 * nothing a moderately careful plan author can't trivially route around.
 */
function usesShellInterpreter(command: CommandSpec): boolean {
  if (typeof command === "string") return true;
  const first = command[0];
  if (typeof first !== "string") return false;
  const name = stripExeSuffix(basename(first));
  if (!SHELL_INTERPRETER_BASENAMES.has(name)) return false;
  return command.slice(1).some((arg) => SHELL_INLINE_COMMAND_FLAG.test(arg));
}

const COMMAND_PREVIEW_BYTES = 400;
const OUTPUT_PREVIEW_BYTES = 400;
const DEFAULT_TASK_TIMEOUT_MS = 15 * 60_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_ISOLATED_PATCH_BYTES = 50 * 1024 * 1024;

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

type OutputArtifact = {
  path: string;
  bytes: number;
  sha256: string;
  previewBytes: number;
  truncated: boolean;
};

type TaskRun = {
  id: string;
  status: "passed" | "failed" | "skipped" | "blocked";
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
  isolation?: {
    baseSha: string;
    outcome:
      | "no-changes"
      | "accepted-integration"
      | "rejected-scope"
      | "rejected-unsupported"
      | "rejected-conflict"
      | "not-promoted-final";
    patchSha256: string | null;
    patchBytes: number;
    changedFiles: Array<{
      path: string;
      previousPath: string | null;
      status: string;
      classification: string;
    }>;
    findings: Array<{ code: string; path: string | null; detail: string }>;
  };
};

type RunIsolation = {
  mode: "worktree";
  trustTier: "workspace-gated";
  runBaseSha: string;
  integrationHeadSha: string;
  aggregatePatchSha256: string | null;
  aggregatePatchBytes: number;
  finalPromotion: "applied" | "no-changes" | "blocked";
  cleanup: { status: "ok" | "warning"; remaining: string[] };
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

async function loadTaskContract(task: { contract: string }): Promise<ApprovedContract> {
  const raw = await readJsonFile(task.contract, "CONTRACT_NOT_FOUND");
  return approvedContractSchema.parse(raw);
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
  task: { id: string; contract: string; command?: CommandSpec },
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

function isolatedTaskId(taskId: string, waveIndex: number): string {
  const digest = createHash("sha256").update(taskId).digest("hex").slice(0, 10);
  return `w${waveIndex}-${safeFilePart(taskId).slice(0, 40)}-${digest}`;
}

function isolatedEvidence(
  baseSha: string,
  patch: PreparedPatch | null,
  outcome: NonNullable<TaskRun["isolation"]>["outcome"],
  findings: Array<{ code: string; path: string | null; detail: string }> = [],
): NonNullable<TaskRun["isolation"]> {
  return {
    baseSha,
    outcome,
    patchSha256: patch?.sha256 ?? null,
    patchBytes: patch?.bytes ?? 0,
    changedFiles:
      patch?.changedFiles.map((file) => ({
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
        classification: file.classification,
      })) ?? [],
    findings,
  };
}

async function runIsolatedTasks(input: {
  cwd: string;
  waves: string[][];
  byId: Map<string, { id: string; contract: string; command?: CommandSpec }>;
  deferredSet: Set<string>;
  contracts: Map<string, ApprovedContract>;
  artifactDir: string;
  timeoutMs: number;
  storeRawOutput: boolean;
}): Promise<{ taskRuns: TaskRun[]; isolation: RunIsolation }> {
  const { headSha: runBaseSha } = await assertIsolationReady(input.cwd);
  const tempRoot = await createIsolationTempRoot();
  const patchDir = join(tempRoot, "patches");
  const cleanupRemaining: string[] = [];
  let integration: IsolatedWorktree | null = null;
  const taskRuns: TaskRun[] = [];
  try {
    integration = await createIsolatedWorktree({
      repoRoot: input.cwd,
      tempRoot,
      id: "run",
      kind: "integration",
      baseSha: runBaseSha,
      timeoutMs: input.timeoutMs,
    });

    for (let waveIndex = 0; waveIndex < input.waves.length; waveIndex += 1) {
      const wave = input.waves[waveIndex] ?? [];
      const baseSha = await worktreeHead(integration, input.timeoutMs);
      const runnable = wave
        .filter((id) => !input.deferredSet.has(id))
        .map((id) => input.byId.get(id))
        .filter((task): task is { id: string; contract: string; command?: CommandSpec } => task !== undefined);
      const created: Array<{
        task: { id: string; contract: string; command?: CommandSpec };
        worktree: IsolatedWorktree;
      }> = [];
      try {
        for (const task of runnable) {
          created.push({
            task,
            worktree: await createIsolatedWorktree({
              repoRoot: input.cwd,
              tempRoot,
              id: isolatedTaskId(task.id, waveIndex),
              kind: "task",
              baseSha,
              timeoutMs: input.timeoutMs,
            }),
          });
        }
      } catch (error) {
        for (const item of created) {
          try {
            await removeIsolatedWorktree({
              repoRoot: input.cwd,
              worktree: item.worktree,
              timeoutMs: input.timeoutMs,
            });
          } catch {
            cleanupRemaining.push(item.worktree.path);
          }
        }
        throw error;
      }
      const executions = await Promise.all(
        created.map(async ({ task, worktree }) => {
          const run = await runCommand(
            worktree.path,
            input.artifactDir,
            task,
            input.timeoutMs,
            input.storeRawOutput,
          );
          return { task, worktree, run };
        }),
      );

      for (const execution of executions) {
        try {
          if (execution.run.status === "skipped") {
            execution.run.isolation = isolatedEvidence(baseSha, null, "no-changes");
            taskRuns.push(execution.run);
            continue;
          }
          const contract = input.contracts.get(execution.task.id);
          if (contract === undefined) throw new Error(`missing contract for task ${execution.task.id}`);
          const prepared = await prepareScopedPatch({
            worktree: execution.worktree,
            scope: contract.scope,
            patchDir,
            maxPatchBytes: MAX_ISOLATED_PATCH_BYTES,
            timeoutMs: input.timeoutMs,
          });
          if (execution.run.status === "failed") {
            execution.run.isolation = isolatedEvidence(
              baseSha,
              prepared.patch,
              "rejected-conflict",
              prepared.findings,
            );
            taskRuns.push(execution.run);
            continue;
          }
          if (!prepared.accepted) {
            const unsupported = prepared.findings.some((finding) =>
              finding.code.startsWith("UNSUPPORTED"),
            );
            execution.run.status = "blocked";
            execution.run.stderr = [
              execution.run.stderr,
              ...prepared.findings.map((finding) => finding.detail),
            ]
              .filter(Boolean)
              .join("\n");
            execution.run.isolation = isolatedEvidence(
              baseSha,
              prepared.patch,
              unsupported ? "rejected-unsupported" : "rejected-scope",
              prepared.findings,
            );
            taskRuns.push(execution.run);
            continue;
          }
          if (prepared.patch === null) {
            execution.run.isolation = isolatedEvidence(baseSha, null, "no-changes");
            taskRuns.push(execution.run);
            continue;
          }
          const applied = await applyPreparedPatch({
            repoRoot: integration.path,
            patch: prepared.patch,
            timeoutMs: input.timeoutMs,
          });
          if (!applied.applied) {
            execution.run.status = "blocked";
            execution.run.stderr = [execution.run.stderr, applied.reason].filter(Boolean).join("\n");
            execution.run.isolation = isolatedEvidence(
              baseSha,
              prepared.patch,
              "rejected-conflict",
              [{ code: "INTEGRATION_PATCH_CONFLICT", path: null, detail: applied.reason }],
            );
          } else {
            execution.run.isolation = isolatedEvidence(
              baseSha,
              prepared.patch,
              "accepted-integration",
            );
          }
          taskRuns.push(execution.run);
        } catch (error) {
          execution.run.status = "blocked";
          const detail = error instanceof Error ? error.message : String(error);
          execution.run.stderr = [execution.run.stderr, detail].filter(Boolean).join("\n");
          execution.run.isolation = isolatedEvidence(baseSha, null, "rejected-conflict", [
            { code: "ISOLATION_ERROR", path: null, detail },
          ]);
          taskRuns.push(execution.run);
        } finally {
          try {
            await removeIsolatedWorktree({
              repoRoot: input.cwd,
              worktree: execution.worktree,
              timeoutMs: input.timeoutMs,
            });
          } catch {
            cleanupRemaining.push(execution.worktree.path);
          }
        }
      }
      await commitIntegrationWave({ worktree: integration, waveIndex, timeoutMs: input.timeoutMs });
    }

    const integrationHeadSha = await worktreeHead(integration, input.timeoutMs);
    const aggregate = await prepareAggregatePatch({
      worktree: { ...integration, baseSha: runBaseSha },
      patchDir,
      maxPatchBytes: MAX_ISOLATED_PATCH_BYTES,
      timeoutMs: input.timeoutMs,
    });
    let finalPromotion: RunIsolation["finalPromotion"] = "no-changes";
    const aggregatePatch = aggregate.patch;
    if (!aggregate.accepted) {
      finalPromotion = "blocked";
    } else if (aggregatePatch !== null) {
      try {
        await assertIsolationReady(input.cwd, runBaseSha, input.timeoutMs);
        const applied = await applyPreparedPatch({
          repoRoot: input.cwd,
          patch: aggregatePatch,
          timeoutMs: input.timeoutMs,
        });
        finalPromotion = applied.applied ? "applied" : "blocked";
      } catch {
        finalPromotion = "blocked";
      }
    }
    if (finalPromotion === "blocked") {
      for (const task of taskRuns) {
        if (task.isolation?.outcome !== "accepted-integration") continue;
        task.status = "blocked";
        task.isolation.outcome = "not-promoted-final";
        task.isolation.findings.push({
          code: "FINAL_PROMOTION_BLOCKED",
          path: null,
          detail: "aggregate patch was not applied to the user repository",
        });
      }
    }
    const completedIntegration = integration;
    try {
      await removeIsolatedWorktree({
        repoRoot: input.cwd,
        worktree: completedIntegration,
        timeoutMs: input.timeoutMs,
      });
      integration = null;
    } catch {
      cleanupRemaining.push(completedIntegration.path);
    }
    return {
      taskRuns,
      isolation: {
        mode: "worktree",
        trustTier: "workspace-gated",
        runBaseSha,
        integrationHeadSha,
        aggregatePatchSha256: aggregatePatch?.sha256 ?? null,
        aggregatePatchBytes: aggregatePatch?.bytes ?? 0,
        finalPromotion,
        cleanup: {
          status: cleanupRemaining.length === 0 ? "ok" : "warning",
          remaining: cleanupRemaining.map((path) => basename(path)),
        },
      },
    };
  } finally {
    if (integration !== null) {
      try {
        await removeIsolatedWorktree({
          repoRoot: input.cwd,
          worktree: integration,
          timeoutMs: input.timeoutMs,
        });
      } catch {
        cleanupRemaining.push(integration.path);
      }
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function compactCommand(command: CommandSpec | null): string {
  if (command === null) return "-";
  if (Array.isArray(command)) return command.join(" ");
  return command;
}

function runStatus(task: TaskRun): "pass" | "warn" | "fail" | "skip" {
  if (task.status === "passed") return "pass";
  if (task.status === "failed") return "fail";
  if (task.status === "blocked") return "warn";
  return "skip";
}

function isolationErrorCode(error: WorktreeError): string {
  if (error.code === "DIRTY_REPO") return "ISOLATION_REQUIRES_CLEAN_REPO";
  if (error.code === "REPO_STATE_UNSAFE") return "ISOLATION_REPO_STATE_UNSAFE";
  if (error.code === "INVALID_BASE") return "ISOLATION_BASE_CHANGED";
  return "ISOLATION_SETUP_FAILED";
}

function ms(value: number): string {
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function humanReport(
  planId: string,
  receiptPath: string,
  taskRuns: TaskRun[],
  waves: string[][],
  conflicts: ScopeConflict[],
  deferred: string[],
  driftStatus: string,
  environmentStatus: string,
  isolationStatus: string,
): string {
  const failed = taskRuns.filter((task) => task.status === "failed").map((task) => task.id);
  const skipped = taskRuns.filter((task) => task.status === "skipped").map((task) => task.id);
  const blocked = taskRuns.filter((task) => task.status === "blocked").map((task) => task.id);
  const headingStatus = failed.length > 0 || skipped.length > 0 || blocked.length > 0 ? "warn" : "pass";
  const sequence =
    waves.length === 0
      ? "none"
      : waves.map((wave, index) => `${index + 1}. [${wave.join(", ")}]`).join(" -> ");
  const taskTable = renderTable(
    ["Task", "Status", "Result", "Exit", "Time", "Command"],
    taskRuns.map((task) => [
      task.id,
      statusLabel(runStatus(task)),
      task.isolation?.outcome ?? "direct",
      task.exitCode === null ? "-" : String(task.exitCode),
      ms(task.durationMs),
      compactCommand(task.command),
    ]),
  );
  const lines = [
    `${color("ScopeLock flight run", "bold")}: ${planId} ${statusLabel(headingStatus)}`,
    "",
    color("Execution sequence", "cyan"),
    `  ${sequence}`,
    "",
    color("Tasks", "cyan"),
    taskTable,
    "",
    color("Safety", "cyan"),
    renderTable(
      ["Check", "Result"],
      [
        ["environment", environmentStatus],
        ["conflicts", conflicts.length === 0 ? "none" : String(conflicts.length)],
        ["deferred", deferred.length === 0 ? "none" : deferred.join(", ")],
        ["drift", driftStatus],
        ["isolation", isolationStatus],
      ],
    ),
    "",
    `Receipt: ${receiptPath}`,
    `Next: scopelock report --open ${JSON.stringify(receiptPath)}`,
  ];
  if (failed.length > 0) lines.push(`failed: [${failed.join(", ")}]`);
  if (skipped.length > 0) lines.push(`skipped: [${skipped.join(", ")}]`);
  if (blocked.length > 0) lines.push(`blocked: [${blocked.join(", ")}]`);
  return lines.join("\n");
}

export async function runPlanCommand(options: RunPlanOptions): Promise<CommandResult> {
  const cwd = findRepoRoot(process.cwd());
  if (cwd === null) {
    throw new CliError("NOT_A_GIT_REPO", "scopelock run must be executed inside a git repository");
  }
  const planRaw = await readJsonFile(options.plan, "PLAN_NOT_FOUND");
  const plan = schedulePlanSchema.parse(planRaw);
  const runTasks = plan.tasks;
  const byId = new Map(runTasks.map((task) => [task.id, task]));
  const executableTasks = runTasks.filter((task) => task.command !== undefined);
  if (executableTasks.length > 0 && options.yes !== true) {
    throw new CliError(
      "PLAN_CONFIRMATION_REQUIRED",
      "plan commands execute with your user privileges; review the plan and pass --yes to run it",
    );
  }
  const shellTasks = executableTasks.filter(
    (task) => task.command !== undefined && usesShellInterpreter(task.command),
  );
  if (shellTasks.length > 0 && options.allowShell !== true) {
    throw new CliError(
      "SHELL_COMMAND_NOT_ALLOWED",
      `commands that run through a shell require --allow-shell (tasks: ${shellTasks.map((task) => task.id).join(", ")})`,
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
  const taskContracts = new Map<string, ApprovedContract>();
  for (const task of plan.tasks) {
    const contract = await loadTaskContract(task);
    taskContracts.set(task.id, contract);
    scopes.push({
      id: task.id,
      planned: contract.scope.plannedPathPatterns,
      forbidden: contract.scope.forbiddenPathPatterns,
      read: contract.scope.readPathPatterns,
    });
  }

  const graph = buildConflictGraph(scopes, { readHazards: options.readHazards !== false });
  const { waves, cycles } = schedule(graph);
  const deferred = options.deferWriteConflicts === false ? [] : deferredWriteConflictTasks(graph.conflicts);
  const deferredSet = new Set(deferred);
  const receiptPath = resolveReceiptPath(cwd, options.receipt);
  const artifactDir = join(dirname(receiptPath), `${basename(receiptPath, ".json")}-artifacts`);
  const startedAt = new Date().toISOString();
  const taskRuns: TaskRun[] = [];
  let isolation: RunIsolation | null = null;
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
    if (options.isolate === true) {
      let isolated: Awaited<ReturnType<typeof runIsolatedTasks>>;
      try {
        isolated = await runIsolatedTasks({
          cwd,
          waves,
          byId,
          deferredSet,
          contracts: taskContracts,
          artifactDir,
          timeoutMs,
          storeRawOutput,
        });
      } catch (error) {
        if (error instanceof WorktreeError) {
          throw new CliError(isolationErrorCode(error), error.message);
        }
        throw error;
      }
      taskRuns.push(...isolated.taskRuns);
      isolation = isolated.isolation;
    } else {
      for (const wave of waves) {
        const runnable = wave
          .filter((id) => !deferredSet.has(id))
          .map((id) => byId.get(id))
          .filter((task): task is (typeof runTasks)[number] => task !== undefined);
        taskRuns.push(
          ...(await Promise.all(runnable.map((task) => runCommand(cwd, artifactDir, task, timeoutMs, storeRawOutput)))),
        );
      }
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
    schemaVersion: options.isolate === true ? 5 : 4,
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
    ...(options.isolate === true ? { isolation } : {}),
    waves,
    conflicts: graph.conflicts,
    cycles,
    deferredTasks: deferred,
    handoffSummary: {
      passedTasks: taskRuns.filter((task) => task.status === "passed").map((task) => task.id).sort(),
      failedTasks: taskRuns.filter((task) => task.status === "failed").map((task) => task.id).sort(),
      skippedTasks: taskRuns.filter((task) => task.status === "skipped").map((task) => task.id).sort(),
      blockedTasks: taskRuns.filter((task) => task.status === "blocked").map((task) => task.id).sort(),
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
  const hasBlockedTask = taskRuns.some((task) => task.status === "blocked");
  const hasDriftProblems = drift?.status === "violations" || drift?.status === "error";
  const hasEnvironmentProblems = environment !== null && environment.status === "fail";
  const exitCode: ExitCode =
    cycles.length > 0 || hasFailedTask || hasSkippedTask || hasBlockedTask || hasDriftProblems || hasEnvironmentProblems
      ? 1
      : 0;

  return {
    data: { receiptPath, receipt },
    human: humanReport(
      plan.planId,
      receiptPath,
      taskRuns,
      waves,
      graph.conflicts,
      deferred,
      drift?.status ?? "not_checked",
      environment?.status ?? "not_configured",
      isolation?.finalPromotion ?? (options.isolate === true ? "not-run" : "off"),
    ),
    exitCode,
  };
}
