import { lstat, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  type SchedulePlanTask,
  type TaskScope,
  getActiveContractId,
  loadContract,
  normalizePlanValidation,
  prepareAggregatePatch,
  prepareScopedPatch,
  removeIsolatedWorktree,
  setActiveContractId,
  verifyApprovalSeal,
  worktreeHead,
  writeApprovalSeal,
  type ApprovedContract,
  type IsolatedWorktree,
  type NormalizedPlanValidation,
  type PreparedPatch,
  WorktreeError,
} from "@scopelock/core";
import { checkDriftCommand } from "./check-drift.js";
import { CliError, type CommandResult, type ExitCode } from "../run.js";
import { color, renderTable, statusLabel } from "../ui.js";
import {
  createRunSignalCoordinator,
  spawnProcessTree,
  type RunSignalCoordinator,
} from "../process-tree.js";
import { redactSecrets } from "../redaction.js";

type RunPlanOptions = {
  plan: string;
  readHazards?: boolean;
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
const ISOLATION_OPERATION_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const MAX_ISOLATED_PATCH_BYTES = 50 * 1024 * 1024;
const MAX_ISOLATED_TASKS = 32;

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
  cwd?: string;
  outputArtifacts: {
    command?: OutputArtifact;
    stdout?: OutputArtifact;
    stderr?: OutputArtifact;
  };
  environment?: {
    pathPrepend: string[];
    workspaceLinks: Array<{ path: string; source: string }>;
  };
  termination?: {
    reason: string;
    requestedSignal: NodeJS.Signals | null;
    escalated: boolean;
    platform: NodeJS.Platform;
  };
  isolation?: {
    baseSha: string;
    outcome:
      | "no-changes"
      | "accepted-integration"
      | "rejected-no-changes"
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

/**
 * A single entry from `execution.validation.checks` (or the one synthesized
 * `repository-validation` check for a legacy `execution.validation.command`
 * plan, see `normalizePlanValidation`) after it has actually run - or been
 * recorded `skipped` because setup or an earlier required check pre-empted
 * it. `required` is carried alongside the run so downstream consumers (the
 * promotion gate here, and evidence-summary derivation in a later task) can
 * tell a blocking failure from an informational one without cross-referencing
 * the plan again.
 */
type ValidationCheckRun = TaskRun & { required: boolean };

type RunIsolation = {
  mode: "worktree";
  trustTier: "workspace-gated";
  runBaseSha: string;
  integrationHeadSha: string;
  aggregatePatchSha256: string | null;
  aggregatePatchBytes: number;
  finalPromotion: "applied" | "no-changes" | "blocked";
  validationWorkspaceClean: boolean;
  validationSetup: TaskRun | null;
  validationChecks: ValidationCheckRun[];
  interrupted: boolean;
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
  task: { id: string; contract: string; command?: CommandSpec; cwd?: string },
  timeoutMs: number,
  storeRawOutput: boolean,
  coordinator?: RunSignalCoordinator,
  executionEnvironment?: {
    env: NodeJS.ProcessEnv;
    pathPrepend: string[];
    workspaceLinks: Array<{ path: string; source: string }>;
  },
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
      ...(task.cwd ? { cwd: task.cwd } : {}),
      outputArtifacts: {},
    };
  }
  const command = task.command;
  const persistedCommand = await persistCommand(artifactDir, task.id, command, storeRawOutput);
  const tree = spawnProcessTree({
    command,
    cwd,
    env: executionEnvironment?.env,
    gracefulTimeoutMs: 2_000,
  });
  const unregister = coordinator?.register(tree);
  let stdout = "";
  let stderr = "";
  tree.child.stdout?.on("data", (chunk) => { stdout = appendCaptured(stdout, chunk); });
  tree.child.stderr?.on("data", (chunk) => { stderr = appendCaptured(stderr, chunk); });
  tree.child.on("error", (error) => { stderr = appendCaptured(stderr, Buffer.from(error.message)); });
  const timer = setTimeout(() => tree.terminate("timeout"), timeoutMs);
  timer.unref();
  const termination = await tree.wait();
  clearTimeout(timer);
  unregister?.();
  if (termination.reason === "timeout") {
    stderr += `${stderr.length > 0 ? "\n" : ""}task timed out after ${timeoutMs}ms`;
  } else if (termination.reason !== null) {
    stderr += `${stderr.length > 0 ? "\n" : ""}task interrupted by signal`;
  }
  const persistedStdout = await persistOutput(artifactDir, task.id, "stdout", stdout, storeRawOutput);
  const persistedStderr = await persistOutput(artifactDir, task.id, "stderr", stderr, storeRawOutput);
  return {
    id: task.id,
    status: termination.exitCode === 0 && termination.reason === null ? "passed" : "failed",
    command: persistedCommand.preview,
    exitCode: termination.exitCode,
    durationMs: Date.now() - started,
    stdout: persistedStdout.preview,
    stderr: persistedStderr.preview,
    ...(task.cwd ? { cwd: task.cwd } : {}),
    outputArtifacts: {
      ...(persistedCommand.artifact ? { command: persistedCommand.artifact } : {}),
      ...(persistedStdout.artifact ? { stdout: persistedStdout.artifact } : {}),
      ...(persistedStderr.artifact ? { stderr: persistedStderr.artifact } : {}),
    },
    ...(executionEnvironment ? {
      environment: {
        pathPrepend: executionEnvironment.pathPrepend,
        workspaceLinks: executionEnvironment.workspaceLinks,
      },
    } : {}),
    ...(termination.reason !== null ? {
      termination: {
        reason: termination.reason,
        requestedSignal: termination.requestedSignal,
        escalated: termination.escalated,
        platform: process.platform,
      },
    } : {}),
  };
}

async function checkoutToolchainEnvironment(
  repoRoot: string,
  candidateRoot: string,
): Promise<{
  env: NodeJS.ProcessEnv;
  pathPrepend: string[];
  workspaceLinks: Array<{ path: string; source: string }>;
  cleanup(): Promise<void>;
} | undefined> {
  const sourceModules = join(repoRoot, "node_modules");
  const nodeBin = join(sourceModules, ".bin");
  try {
    if (!(await stat(sourceModules)).isDirectory() || !(await stat(nodeBin)).isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const candidateModules = join(candidateRoot, "node_modules");
  let createdLink = false;
  try {
    await lstat(candidateModules);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    await symlink(sourceModules, candidateModules, process.platform === "win32" ? "junction" : "dir");
    createdLink = true;
  }

  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = [nodeBin, env[pathKey]].filter(Boolean).join(delimiter);
  return {
    env,
    pathPrepend: [nodeBin],
    workspaceLinks: createdLink ? [{ path: candidateModules, source: sourceModules }] : [],
    cleanup: async () => {
      if (createdLink) await rm(candidateModules, { force: true });
    },
  };
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

type ValidationCheckSpec = NormalizedPlanValidation["checks"][number];

function candidateRoots(
  worktreePath: string,
  repoRoot: string,
  cwd: string | undefined,
): { candidateRoot: string; sourceRoot: string } {
  const rel = cwd === undefined || cwd === "." ? undefined : cwd;
  return {
    candidateRoot: rel === undefined ? worktreePath : join(worktreePath, rel),
    sourceRoot: rel === undefined ? repoRoot : join(repoRoot, rel),
  };
}

/**
 * Builds the receipt entry for a check that never ran because setup failed
 * or an earlier required check already failed. Every declared check must
 * appear in `validationChecks` - never silently dropped - so downstream
 * evidence derivation can always account for the full declared list.
 */
async function skippedCheckRun(
  artifactDir: string,
  check: ValidationCheckSpec,
  reason: string,
  storeRawOutput: boolean,
): Promise<ValidationCheckRun> {
  const persistedCommand = await persistCommand(artifactDir, check.id, check.command, storeRawOutput);
  return {
    id: check.id,
    status: "skipped",
    command: persistedCommand.preview,
    exitCode: null,
    durationMs: 0,
    stdout: "",
    stderr: reason,
    cwd: check.cwd ?? ".",
    outputArtifacts: {
      ...(persistedCommand.artifact ? { command: persistedCommand.artifact } : {}),
    },
    required: check.required,
  };
}

/** Every declared check recorded `skipped` for the same `reason`, in order. */
async function skippedCheckRuns(
  artifactDir: string,
  checks: ValidationCheckSpec[],
  reason: string,
  storeRawOutput: boolean,
): Promise<ValidationCheckRun[]> {
  const runs: ValidationCheckRun[] = [];
  for (const check of checks) {
    runs.push(await skippedCheckRun(artifactDir, check, reason, storeRawOutput));
  }
  return runs;
}

async function runCandidateValidation(input: {
  repoRoot: string;
  worktree: IsolatedWorktree;
  tempRoot: string;
  artifactDir: string;
  setup?: CommandSpec;
  setupCwd?: string;
  checks: ValidationCheckSpec[];
  timeoutMs: number;
  storeRawOutput: boolean;
  coordinator: RunSignalCoordinator;
}): Promise<{ setup: TaskRun | null; checks: ValidationCheckRun[] }> {
  const controlPath = join(input.worktree.path, ".scopelock");
  const hiddenPath = join(input.tempRoot, "validation-control-state");
  let hidden = false;
  try {
    await rename(controlPath, hiddenPath);
    hidden = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  let setup: TaskRun | null = null;
  const checkRuns: ValidationCheckRun[] = [];
  let restoreError: unknown = null;
  // Toolchain symlinks are per effective cwd (checks may override the shared
  // default), cached so two checks sharing a cwd don't race to create/remove
  // the same node_modules symlink.
  const toolchains = new Map<string, Awaited<ReturnType<typeof checkoutToolchainEnvironment>>>();
  const toolchainFor = async (cwd: string | undefined) => {
    const key = cwd ?? ".";
    if (!toolchains.has(key)) {
      const { candidateRoot, sourceRoot } = candidateRoots(input.worktree.path, input.repoRoot, cwd);
      toolchains.set(key, await checkoutToolchainEnvironment(sourceRoot, candidateRoot));
    }
    return toolchains.get(key);
  };

  try {
    if (input.setup) {
      const { candidateRoot } = candidateRoots(input.worktree.path, input.repoRoot, input.setupCwd);
      const toolchain = await toolchainFor(input.setupCwd);
      setup = await runCommand(
        candidateRoot,
        input.artifactDir,
        { id: "validation-setup", contract: "", command: input.setup, cwd: input.setupCwd ?? "." },
        input.timeoutMs,
        input.storeRawOutput,
        input.coordinator,
        toolchain,
      );
    }

    // Fail-closed, strictly sequential: a required check that fails (or the
    // setup step failing before any check starts) stops every later check
    // dead - they are recorded skipped, not silently omitted, and never
    // spawned. `Promise.all` is intentionally not used here.
    let skipReason: string | null = setup !== null && setup.status !== "passed"
      ? "skipped: repository validation setup failed"
      : null;
    for (const check of input.checks) {
      if (skipReason !== null) {
        checkRuns.push(await skippedCheckRun(input.artifactDir, check, skipReason, input.storeRawOutput));
        continue;
      }
      const { candidateRoot } = candidateRoots(input.worktree.path, input.repoRoot, check.cwd);
      const toolchain = await toolchainFor(check.cwd);
      const run = await runCommand(
        candidateRoot,
        input.artifactDir,
        { id: check.id, contract: "", command: check.command, cwd: check.cwd ?? "." },
        input.timeoutMs,
        input.storeRawOutput,
        input.coordinator,
        toolchain,
      );
      checkRuns.push({ ...run, required: check.required });
      if (check.required && run.status !== "passed") {
        skipReason = "skipped: an earlier required check failed";
      }
    }
  } finally {
    for (const toolchain of toolchains.values()) {
      try {
        await toolchain?.cleanup();
      } catch (error) {
        restoreError = error;
      }
    }
    if (hidden) {
      try {
        await rename(hiddenPath, controlPath);
      } catch (error) {
        restoreError ??= error;
      }
    }
  }

  if (restoreError !== null) {
    const detail = restoreError instanceof Error ? restoreError.message : String(restoreError);
    const failedRun = checkRuns.at(-1) ?? setup;
    if (failedRun === null) throw restoreError;
    failedRun.status = "failed";
    failedRun.stderr = [failedRun.stderr, `failed to restore validation workspace: ${detail}`]
      .filter(Boolean)
      .join("\n");
  }
  return { setup, checks: checkRuns };
}

async function runIsolatedTasks(input: {
  cwd: string;
  waves: string[][];
  byId: Map<string, SchedulePlanTask>;
  contracts: Map<string, ApprovedContract>;
  validationSetupCommand?: CommandSpec;
  validationSetupCwd?: string;
  validationChecks: ValidationCheckSpec[];
  artifactDir: string;
  taskTimeoutMs: number;
  isolationTimeoutMs: number;
  storeRawOutput: boolean;
  signal: AbortSignal;
  coordinator: RunSignalCoordinator;
}): Promise<{ taskRuns: TaskRun[]; isolation: RunIsolation }> {
  const { headSha: runBaseSha } = await assertIsolationReady(
    input.cwd,
    undefined,
    input.isolationTimeoutMs,
  );
  const tempRoot = await createIsolationTempRoot();
  const patchDir = join(tempRoot, "patches");
  const cleanupRemaining: string[] = [];
  let integration: IsolatedWorktree | null = null;
  let tempRootRemoved = false;
  const taskRuns: TaskRun[] = [];
  try {
    integration = await createIsolatedWorktree({
      repoRoot: input.cwd,
      tempRoot,
      id: "run",
      kind: "integration",
      baseSha: runBaseSha,
      timeoutMs: input.isolationTimeoutMs,
    });

    for (let waveIndex = 0; waveIndex < input.waves.length; waveIndex += 1) {
      if (input.signal.aborted) break;
      const wave = input.waves[waveIndex] ?? [];
      const baseSha = await worktreeHead(integration, input.isolationTimeoutMs);
      const runnable = wave
        .map((id) => input.byId.get(id))
        .filter((task): task is SchedulePlanTask => task !== undefined);
      const created: Array<{
        task: SchedulePlanTask;
        worktree: IsolatedWorktree;
      }> = [];
      try {
        for (const task of runnable) {
          const worktree = await createIsolatedWorktree({
            repoRoot: input.cwd,
            tempRoot,
            id: isolatedTaskId(task.id, waveIndex),
            kind: "task",
            baseSha,
            timeoutMs: input.isolationTimeoutMs,
          });
          // `.scopelock/active` and the OS-level approval seal are per-machine
          // state, deliberately gitignored, so `git worktree add` never brings
          // them along. Without them the in-worktree Claude/Cursor/Codex hook
          // sees "no active contract" and denies every edit the agent makes,
          // even though the task's own contract was already approved against
          // this exact baseline. Mint a fresh pointer + seal scoped to the
          // worktree's own path so the hook resolves the same way it would in
          // the main checkout.
          const contract = input.contracts.get(task.id);
          if (contract === undefined) throw new Error(`missing contract for task ${task.id}`);
          if (contract.baseline !== null) {
            await setActiveContractId(scopelockPaths(worktree.path), contract.id);
            await writeApprovalSeal(worktree.path, contract);
          }
          created.push({ task, worktree });
        }
      } catch (error) {
        for (const item of created) {
          try {
            await removeIsolatedWorktree({
              repoRoot: input.cwd,
              worktree: item.worktree,
              timeoutMs: input.isolationTimeoutMs,
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
            input.taskTimeoutMs,
            input.storeRawOutput,
            input.coordinator,
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
            timeoutMs: input.isolationTimeoutMs,
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
            if (execution.task.expectsChanges === true) {
              const detail = "task exited successfully but produced no Git changes";
              execution.run.status = "blocked";
              execution.run.stderr = [execution.run.stderr, detail].filter(Boolean).join("\n");
              execution.run.isolation = isolatedEvidence(baseSha, null, "rejected-no-changes", [
                { code: "EXPECTED_CHANGES_MISSING", path: null, detail },
              ]);
              taskRuns.push(execution.run);
              continue;
            }
            execution.run.isolation = isolatedEvidence(baseSha, null, "no-changes");
            taskRuns.push(execution.run);
            continue;
          }
          const applied = await applyPreparedPatch({
            repoRoot: integration.path,
            patch: prepared.patch,
            timeoutMs: input.isolationTimeoutMs,
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
              timeoutMs: input.isolationTimeoutMs,
            });
          } catch {
            cleanupRemaining.push(execution.worktree.path);
          }
        }
      }
      await commitIntegrationWave({
        worktree: integration,
        waveIndex,
        timeoutMs: input.isolationTimeoutMs,
      });
    }

    const integrationHeadSha = await worktreeHead(integration, input.isolationTimeoutMs);
    const aggregate = await prepareAggregatePatch({
      worktree: { ...integration, baseSha: runBaseSha },
      patchDir,
      maxPatchBytes: MAX_ISOLATED_PATCH_BYTES,
      timeoutMs: input.isolationTimeoutMs,
    });
    const aggregatePatch = aggregate.patch;
    const candidateValidation = aggregatePatch === null
      ? {
          setup: null,
          checks: await skippedCheckRuns(
            input.artifactDir,
            input.validationChecks,
            "skipped: no candidate changes to validate",
            input.storeRawOutput,
          ),
        }
      : await runCandidateValidation({
          repoRoot: input.cwd,
          worktree: integration,
          tempRoot,
          artifactDir: input.artifactDir,
          setup: input.validationSetupCommand,
          setupCwd: input.validationSetupCwd,
          checks: input.validationChecks,
          timeoutMs: input.taskTimeoutMs,
          storeRawOutput: input.storeRawOutput,
          coordinator: input.coordinator,
        });
    const validationSetup = candidateValidation.setup;
    const validationChecks = candidateValidation.checks;
    const failedRequiredChecks = validationChecks.filter(
      (check) => check.required && check.status !== "passed",
    );
    let validationWorkspaceClean = true;
    if (aggregatePatch !== null) {
      try {
        await assertIsolationReady(integration.path, integrationHeadSha, input.isolationTimeoutMs);
      } catch {
        validationWorkspaceClean = false;
      }
    }
    let finalPromotion: RunIsolation["finalPromotion"] = "no-changes";
    if (input.signal.aborted) {
      finalPromotion = "blocked";
    } else if (!aggregate.accepted) {
      finalPromotion = "blocked";
    } else if (
      aggregatePatch !== null
      && (
        validationSetup?.status === "failed"
        || failedRequiredChecks.length > 0
        || !validationWorkspaceClean
      )
    ) {
      finalPromotion = "blocked";
    } else if (aggregatePatch !== null) {
      try {
        await assertIsolationReady(input.cwd, runBaseSha, input.isolationTimeoutMs);
        const applied = await applyPreparedPatch({
          repoRoot: input.cwd,
          patch: aggregatePatch,
          timeoutMs: input.isolationTimeoutMs,
        });
        finalPromotion = applied.applied ? "applied" : "blocked";
      } catch {
        finalPromotion = "blocked";
      }
    }
    if (finalPromotion === "blocked") {
      const failedRequiredSummary = failedRequiredChecks
        .map((check) => `${check.id}:${check.status}`)
        .join(", ");
      for (const task of taskRuns) {
        if (task.isolation?.outcome !== "accepted-integration") continue;
        task.status = "blocked";
        task.isolation.outcome = "not-promoted-final";
        task.isolation.findings.push({
          code: !validationWorkspaceClean
            ? "VALIDATION_MUTATED_CANDIDATE"
            : validationSetup?.status === "failed"
            ? "VALIDATION_SETUP_FAILED"
            : failedRequiredChecks.length > 0
              ? "VALIDATION_FAILED"
            : "FINAL_PROMOTION_BLOCKED",
          path: null,
          detail: !validationWorkspaceClean
            ? "validation changed candidate files; aggregate patch was not applied"
            : validationSetup?.status === "failed"
            ? "repository validation setup failed; aggregate patch was not applied"
            : failedRequiredChecks.length > 0
              ? `repository validation failed (${failedRequiredSummary}); aggregate patch was not applied`
            : "aggregate patch was not applied to the user repository",
        });
      }
    }
    if (input.signal.aborted) {
      const recorded = new Set(taskRuns.map((task) => task.id));
      for (const task of input.byId.values()) {
        if (recorded.has(task.id)) continue;
        const persistedCommand = await persistCommand(
          input.artifactDir,
          task.id,
          task.command ?? null,
          input.storeRawOutput,
        );
        taskRuns.push({
          id: task.id,
          status: "skipped",
          command: persistedCommand.preview,
          exitCode: null,
          durationMs: 0,
          stdout: "",
          stderr: "not run because isolated execution was interrupted",
          outputArtifacts: {
            ...(persistedCommand.artifact ? { command: persistedCommand.artifact } : {}),
          },
        });
      }
    }
    const completedIntegration = integration;
    try {
      await removeIsolatedWorktree({
        repoRoot: input.cwd,
        worktree: completedIntegration,
        timeoutMs: input.isolationTimeoutMs,
      });
      integration = null;
    } catch {
      cleanupRemaining.push(completedIntegration.path);
    }
    if (integration === null) {
      try {
        await rm(tempRoot, { recursive: true, force: true });
        tempRootRemoved = true;
      } catch {
        cleanupRemaining.push(tempRoot);
      }
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
        validationWorkspaceClean,
        validationSetup,
        validationChecks,
        interrupted: input.signal.aborted,
        cleanup: {
          status: cleanupRemaining.length === 0 ? "ok" : "warning",
          remaining: cleanupRemaining.map((path) => basename(path)),
        },
      },
    };
  } finally {
    if (integration !== null) {
      const cleanupIntegration = integration;
      try {
        await removeIsolatedWorktree({
          repoRoot: input.cwd,
          worktree: cleanupIntegration,
          timeoutMs: input.isolationTimeoutMs,
        });
        integration = null;
      } catch {
        cleanupRemaining.push(cleanupIntegration.path);
      }
    }
    if (!tempRootRemoved && integration === null) {
      try {
        await rm(tempRoot, { recursive: true, force: true });
        tempRootRemoved = true;
      } catch {
        // A normal-path failure is already recorded in the receipt. On an
        // exceptional path there is no trustworthy receipt to complete.
      }
    }
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
  validationSetupStatus: string,
  validationChecksSummary: string,
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
        ["validation setup", validationSetupStatus],
        ["validation checks", validationChecksSummary],
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

async function assertValidationWorkingDirectory(repoRoot: string, cwd: string | undefined): Promise<void> {
  const reviewed = cwd ?? ".";
  const requested = reviewed === "." ? repoRoot : resolve(repoRoot, reviewed);
  let canonicalRoot: string;
  let canonicalRequested: string;
  try {
    [canonicalRoot, canonicalRequested] = await Promise.all([realpath(repoRoot), realpath(requested)]);
    if (!(await stat(canonicalRequested)).isDirectory()) throw new Error("path is not a directory");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      "INVALID_VALIDATION_CWD",
      `validation cwd is unavailable or not a directory: ${reviewed} (${detail})`,
    );
  }
  const rel = relative(canonicalRoot, canonicalRequested);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CliError(
      "INVALID_VALIDATION_CWD",
      `validation cwd resolves outside the repository: ${reviewed}`,
    );
  }
}

export async function runPlanCommand(options: RunPlanOptions): Promise<CommandResult> {
  const cwd = findRepoRoot(process.cwd());
  if (cwd === null) {
    throw new CliError("NOT_A_GIT_REPO", "scopelock run must be executed inside a git repository");
  }
  const planRaw = await readJsonFile(options.plan, "PLAN_NOT_FOUND");
  const plan = schedulePlanSchema.parse(planRaw);
  const isolationRequirement = plan.execution?.isolation ?? "optional";
  if (isolationRequirement === "required" && options.isolate !== true) {
    throw new CliError(
      "PLAN_REQUIRES_ISOLATION",
      "this plan contains commands that may run only with --isolate",
    );
  }
  const runTasks = plan.tasks;
  if (options.isolate === true && runTasks.length > MAX_ISOLATED_TASKS) {
    throw new CliError(
      "ISOLATION_TASK_LIMIT_EXCEEDED",
      `isolated plans support at most ${MAX_ISOLATED_TASKS} tasks; split this plan into smaller runs`,
    );
  }
  const byId = new Map(runTasks.map((task) => [task.id, task]));
  const executableTasks = runTasks.filter((task) => task.command !== undefined);
  // `normalizePlanValidation` (Task 1) folds a legacy singular
  // `execution.validation.command` into a one-element `checks` array with id
  // `repository-validation`, so a v1 plan continues to execute unchanged
  // below without this file needing to know which form the plan used.
  const normalizedValidation = plan.execution?.validation
    ? normalizePlanValidation(plan.execution.validation)
    : null;
  const validationSetupCommand = normalizedValidation?.setup;
  const validationSetupCwd = plan.execution?.validation?.cwd;
  const validationChecks = normalizedValidation?.checks ?? [];
  if (options.isolate === true && executableTasks.length > 0 && validationChecks.length === 0) {
    throw new CliError(
      "VALIDATION_REQUIRED",
      "isolated execution requires execution.validation.checks (or the legacy command) before any agent starts",
    );
  }
  if (options.isolate === true && validationChecks.length > 0) {
    // Every check's working directory - the shared default or a per-check
    // override - must be validated before any agent starts, not lazily when
    // the check actually runs.
    await assertValidationWorkingDirectory(cwd, validationSetupCwd);
    for (const check of validationChecks) {
      await assertValidationWorkingDirectory(cwd, check.cwd);
    }
  }
  if (executableTasks.length > 0 && options.yes !== true) {
    throw new CliError(
      "PLAN_CONFIRMATION_REQUIRED",
      "plan commands execute with your user privileges; review the plan and pass --yes to run it",
    );
  }
  const shellTasks = executableTasks.filter(
    (task) => task.command !== undefined && usesShellInterpreter(task.command),
  );
  const validationSetupUsesShell = validationSetupCommand !== undefined
    && usesShellInterpreter(validationSetupCommand);
  const shellValidationChecks = validationChecks.filter((check) => usesShellInterpreter(check.command));
  if (
    (shellTasks.length > 0 || validationSetupUsesShell || shellValidationChecks.length > 0)
    && options.allowShell !== true
  ) {
    const labels = [
      ...shellTasks.map((task) => task.id),
      ...(validationSetupUsesShell ? ["validation-setup"] : []),
      ...shellValidationChecks.map((check) => `validation:${check.id}`),
    ];
    throw new CliError(
      "SHELL_COMMAND_NOT_ALLOWED",
      `commands that run through a shell require --allow-shell (tasks: ${labels.join(", ")})`,
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
  const deferred: string[] = [];
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
    const coordinator = createRunSignalCoordinator();
    try {
    if (options.isolate === true) {
      let isolated: Awaited<ReturnType<typeof runIsolatedTasks>>;
      try {
        isolated = await runIsolatedTasks({
          cwd,
          waves,
          byId,
          contracts: taskContracts,
          validationSetupCommand,
          validationSetupCwd,
          validationChecks,
          artifactDir,
          taskTimeoutMs: timeoutMs,
          isolationTimeoutMs: ISOLATION_OPERATION_TIMEOUT_MS,
          storeRawOutput,
          signal: coordinator.signal,
          coordinator,
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
          .map((id) => byId.get(id))
          .filter((task): task is (typeof runTasks)[number] => task !== undefined);
        taskRuns.push(
          ...(await Promise.all(runnable.map((task) => runCommand(
            cwd,
            artifactDir,
            task,
            timeoutMs,
            storeRawOutput,
            coordinator,
          )))),
        );
        if (coordinator.signal.aborted) break;
      }
    }
    } finally {
      coordinator.dispose();
    }
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
      executionRequirement: { isolation: isolationRequirement },
      effectiveExecutionMode: options.isolate === true ? "isolated" : "direct",
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
  const hasCleanupProblems = isolation?.cleanup.status === "warning";
  const exitCode: ExitCode =
    cycles.length > 0 || hasFailedTask || hasSkippedTask || hasBlockedTask || hasDriftProblems || hasEnvironmentProblems || hasCleanupProblems
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
      isolation?.validationSetup?.status ?? (validationSetupCommand ? "not-run" : "off"),
      isolation?.validationChecks && isolation.validationChecks.length > 0
        ? isolation.validationChecks.map((check) => `${check.id}:${check.status}`).join(", ")
        : (options.isolate === true ? "not-run" : "off"),
      isolation?.finalPromotion ?? (options.isolate === true ? "not-run" : "off"),
    ),
    exitCode,
  };
}
