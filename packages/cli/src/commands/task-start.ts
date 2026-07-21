import { access } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import {
  HARNESSES,
  agentIdSchema,
  buildRepoManifest,
  findRepoRoot,
  matchesAny,
  scopelockPaths,
  writeJsonAtomic,
  type AgentId,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections, renderStatusTable, type StatusRow } from "../ui.js";
import { approveCommand } from "./approve.js";
import { contractNewCommand } from "./contract-new.js";
import { initCommand } from "./init.js";
import { injectContractCommand } from "./inject-contract.js";
import { setupCommand } from "./setup.js";
import { createNoopReporter } from "../progress/noop-reporter.js";
import type { ProgressReporter } from "../progress/types.js";

export type TaskStartOptions = {
  description?: string;
  agent?: string;
  allow: string[];
  block: string[];
  context: string[];
  test: string[];
  id?: string;
  yes?: boolean;
  inject?: boolean;
  interactive: boolean;
  cwd?: string;
  reporter?: ProgressReporter;
};

type TaskStartDependencies = {
  question?: (message: string) => Promise<string>;
  confirm?: (message: string) => Promise<boolean>;
  setup?: typeof setupCommand;
};

function splitAnswer(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function normalizePath(input: string, tracked: Set<string>): string {
  let path = input.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (
    path.length === 0 ||
    path.startsWith("!") ||
    isAbsolute(path) ||
    /^[A-Za-z]:\//.test(path) ||
    path.split("/").includes("..")
  ) {
    throw new CliError("INVALID_SCOPE_PATH", `scope path must stay inside the repository: ${input}`);
  }
  if (path === ".") return "**";
  if (
    /[*?\[\]{}()]/.test(path) ||
    tracked.has(path) ||
    extname(path).length > 0 ||
    /(^|\/)\.env(?:\.|$)/.test(path)
  ) return path;
  return `${path}/**`;
}

export function compileScopeInputs(inputs: string[], trackedFiles: string[]): string[] {
  const tracked = new Set(trackedFiles);
  return [...new Set(inputs.map((input) => normalizePath(input, tracked)))];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function taskStartWithReporter(
  options: TaskStartOptions,
  dependencies: TaskStartDependencies,
  reporter: ProgressReporter,
): Promise<CommandResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = findRepoRoot(cwd);
  if (root === null) throw new CliError("NOT_A_GIT_REPO", "task start must run inside a git repository");

  reporter.emit({ type: "step", index: 1, total: 3, label: "Describe and scope the task" });

  const question = dependencies.question;
  const ask = async (message: string, current: string | undefined): Promise<string> => {
    if (current?.trim()) return current.trim();
    if (!options.interactive || question === undefined) return "";
    return (await question(message)).trim();
  };
  const askMany = async (message: string, current: string[]): Promise<string[]> => {
    if (current.length > 0) return current;
    if (!options.interactive || question === undefined) return [];
    return splitAnswer(await question(message));
  };

  const description = await ask("Describe the task in one line", options.description);
  const agentText = await ask("Agent (codex, claude, or cursor)", options.agent);
  const allow = await askMany("Paths the agent may change (comma-separated)", options.allow);
  const block = await askMany("Paths the agent must not change (comma-separated, blank for none)", options.block);
  const context = await askMany(
    "Task context the agent may need to read (comma-separated, advisory; blank for none)",
    options.context,
  );
  const tests = await askMany("Required test types (comma-separated, for example unit)", options.test);
  const missing = [
    description.length === 0 ? "description" : null,
    agentText.length === 0 ? "--agent" : null,
    allow.length === 0 ? "--allow" : null,
    tests.length === 0 ? "--test" : null,
  ].filter((value): value is string => value !== null);
  if (missing.length > 0) {
    throw new CliError(
      "TASK_INPUT_REQUIRED",
      `task start needs ${missing.join(", ")}; run \`scopelock task start --help\` for the non-interactive form`,
    );
  }

  const agent = agentIdSchema.parse(agentText);
  const manifest = buildRepoManifest(root);
  const planned = compileScopeInputs(allow, manifest.files);
  const forbidden = compileScopeInputs(block, manifest.files);
  const read = compileScopeInputs(context, manifest.files);
  const covered = manifest.files.filter((file) => matchesAny(file, planned));
  const coverage = manifest.files.length === 0 ? 0 : covered.length / manifest.files.length;
  const risky = manifest.riskyPaths.filter((file) => matchesAny(file, planned));
  const warnings = [
    coverage >= 0.5
      ? `Broad scope: ${covered.length}/${manifest.files.length} tracked files (${Math.round(coverage * 100)}%)`
      : null,
    risky.length > 0 ? `Sensitive files included: ${risky.join(", ")}` : null,
  ].filter((value): value is string => value !== null);
  const warningRows: StatusRow[] = [
    ...(coverage >= 0.5
      ? [{
          id: "Broad scope",
          status: "warn" as const,
          cells: [] as string[],
          reason: `${covered.length}/${manifest.files.length} tracked files (${Math.round(coverage * 100)}%)`,
        }]
      : []),
    ...(risky.length > 0
      ? [{ id: "Sensitive files", status: "warn" as const, cells: [] as string[], reason: risky.join(", ") }]
      : []),
  ];

  reporter.emit({ type: "step", index: 2, total: 3, label: "Review and approve" });

  await initCommand(root);
  const draftResult = await contractNewCommand({
    task: description,
    id: options.id,
    planned,
    forbidden,
    read,
    agent: [agent],
    test: tests,
  }, root);
  const contract = (draftResult.data as { contract: { id: string } }).contract;
  const draftPath = join(scopelockPaths(root).draftsDir, `${contract.id}.json`);
  if (await exists(draftPath)) {
    throw new CliError("DRAFT_EXISTS", `draft already exists: ${draftPath}; pass a unique --id`);
  }
  await writeJsonAtomic(draftPath, contract);

  const review = [
    `Task      ${description}`,
    `Agent     ${HARNESSES[agent].label}`,
    `May edit  ${planned.join(", ")}`,
    `Blocked   ${forbidden.length > 0 ? forbidden.join(", ") : "none"}`,
    `Context   ${read.length > 0 ? `${read.join(", ")} (advisory, not read containment)` : "none"}`,
    `Tests     ${tests.join(", ")}`,
    `Coverage  ${covered.length}/${manifest.files.length} tracked files; future matching files are included`,
    `Draft     ${draftPath}`,
    ...(warningRows.length > 0 ? [renderStatusTable("Warning", [], warningRows)] : []),
  ];

  let approved = options.yes === true;
  if (!approved && options.interactive) {
    if (dependencies.confirm === undefined) {
      throw new CliError("INTERACTIVE_REQUIRED", "task approval confirmation handler is unavailable");
    }
    approved = await dependencies.confirm(`${review.join("\n")}\n\nApprove this task boundary?`);
  }
  if (!approved) {
    if (!options.interactive) {
      throw new CliError(
        "TASK_APPROVAL_REQUIRED",
        `draft saved at ${draftPath}; review it, then run: scopelock contract approve ${JSON.stringify(draftPath)}`,
      );
    }
    return {
      data: { draftPath, approved: false, agent, warnings },
      human: renderSections([
        { title: "Review", lines: review },
        { title: "Result", lines: "Draft saved; task boundary was not approved\nAgent started  no" },
        { title: "Next", lines: `Review it, then run: scopelock contract approve ${JSON.stringify(draftPath)}` },
      ]),
      exitCode: 0,
    };
  }

  reporter.emit({ type: "step", index: 3, total: 3, label: "Connect the agent" });

  const approval = await approveCommand(draftPath, { activate: true }, root);
  const setup = dependencies.setup ?? setupCommand;
  const environment = await setup({
    targets: [agent],
    mode: "warn",
    interactive: false,
    cwd: root,
  });
  const target = (environment.data as {
    targets: Array<{ id: AgentId; executable: string | null; hook: { installed: boolean; capabilities: { confidence: string } } }>;
  }).targets.find((entry) => entry.id === agent);
  const environmentReady = environment.exitCode === 0 && target !== undefined && target.executable !== null;
  const targetFile = join(root, HARNESSES[agent].docFile);

  let inject = options.inject === true;
  if (!inject && options.interactive && environmentReady) {
    if (dependencies.confirm === undefined) {
      throw new CliError("INTERACTIVE_REQUIRED", "instruction injection confirmation handler is unavailable");
    }
    inject = await dependencies.confirm(
      `Place the approved task boundary in ${targetFile}?\nExisting content outside the ScopeLock block is preserved.`,
    );
  }
  let injection: CommandResult | null = null;
  if (inject && environmentReady) injection = await injectContractCommand({ target: agent }, root);

  const readiness = !environmentReady
    ? `Attention: ${HARNESSES[agent].label} CLI was not found or setup needs attention`
    : target?.hook.installed
      ? `Ready; hook confidence ${target.hook.capabilities.confidence}`
      : "Ready with drift detection; no active write hook";
  const resultLines = [
    "Approved  yes, active baseline captured",
    `Environment  ${readiness}`,
    `Instructions  ${injection === null ? "not changed" : `updated ${HARNESSES[agent].docFile}`}`,
    "Agent started  no",
    "Tests executed no",
    "OS sandbox     no",
  ];

  return {
    data: {
      draftPath,
      approved: true,
      approval: approval.data,
      agent,
      environment: environment.data,
      environmentReady,
      injection: injection?.data ?? null,
      warnings,
    },
    human: renderSections([
      { title: "Review", lines: review },
      { title: "Checks", lines: resultLines },
      { title: "Result", lines: environmentReady ? "Task boundary is ready" : "Task boundary approved; environment needs attention" },
      { title: "Next", lines: environmentReady ? "Let the agent work, then run: scopelock task finish" : `Install ${HARNESSES[agent].label}, then run: scopelock setup --target ${agent}` },
    ]),
    exitCode: environmentReady ? 0 : 1,
  };
}

export async function taskStartCommand(
  options: TaskStartOptions,
  dependencies: TaskStartDependencies = {},
): Promise<CommandResult> {
  const reporter = options.reporter ?? createNoopReporter();
  try {
    return await taskStartWithReporter(options, dependencies, reporter);
  } finally {
    reporter.dispose();
  }
}
