import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import {
  HARNESSES,
  agentIdSchema,
  enforcementModeSchema,
  findRepoRoot,
  hooksConfigPath,
  probeHookConfig,
  type AgentId,
  type EnforcementMode,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections, renderTable } from "../ui.js";
import { initCommand } from "./init.js";
import { doctorCommand } from "./doctor.js";
import { hooksInstallCommand } from "./hooks.js";

const EXECUTABLES: Record<AgentId, string> = {
  claude: "claude",
  codex: "codex",
  cursor: "agent",
};

const TARGETS: AgentId[] = ["claude", "codex", "cursor"];

function findExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const rawDir of (env.PATH ?? "").split(delimiter)) {
    const dir = rawDir.replace(/^"|"$/g, "");
    if (dir.length === 0) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      try {
        accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // Keep looking along PATH.
      }
    }
  }
  return null;
}

export type SetupOptions = {
  targets: string[];
  installHooks?: boolean;
  yes?: boolean;
  mode: EnforcementMode;
  local?: boolean;
  interactive: boolean;
  cwd?: string;
};

type SetupDependencies = {
  confirm?: (message: string, target: AgentId) => Promise<boolean>;
  executable?: (name: string) => string | null;
};

export async function setupCommand(
  options: SetupOptions,
  dependencies: SetupDependencies = {},
): Promise<CommandResult> {
  if (options.installHooks === true && options.yes !== true && !options.interactive) {
    throw new CliError(
      "SETUP_CONFIRMATION_REQUIRED",
      "non-interactive hook installation requires --yes",
    );
  }

  const cwd = options.cwd ?? process.cwd();
  const root = findRepoRoot(cwd);
  if (root === null) {
    throw new CliError("NOT_A_GIT_REPO", "setup must run inside a git repository");
  }

  const selected = options.targets.length === 0
    ? TARGETS
    : [...new Set(options.targets.map((target) => agentIdSchema.parse(target)))];
  const mode = enforcementModeSchema.parse(options.mode);
  const executable = dependencies.executable ?? findExecutable;

  const initialized = await initCommand(cwd);
  const before = selected.map((id) => ({
    id,
    executable: executable(EXECUTABLES[id]),
    hook: probeHookConfig(root, id),
  }));
  const explicitTargets = options.targets.length > 0;
  const candidates = before.filter((target) => {
    if (target.hook.installed) return false;
    if (options.installHooks === true) return explicitTargets || target.executable !== null;
    return options.interactive && target.executable !== null;
  });

  const accepted: AgentId[] = [];
  if (options.yes === true && options.installHooks === true) {
    accepted.push(...candidates.map((target) => target.id));
  } else if (options.interactive) {
    const confirm = dependencies.confirm;
    if (confirm === undefined) {
      throw new CliError("INTERACTIVE_REQUIRED", "setup confirmation handler is unavailable");
    }
    for (const target of candidates) {
      const message = [
        `Install ScopeLock hooks for ${HARNESSES[target.id].label}?`,
        `File to update  ${hooksConfigPath(root, target.id)}`,
        "Existing data   preserved",
      ].join("\n");
      if (await confirm(message, target.id)) accepted.push(target.id);
    }
  }

  for (const target of accepted) {
    await hooksInstallCommand({
      target,
      mode,
      local: options.local,
      cwd,
    });
  }

  const doctor = await doctorCommand(cwd);
  const targets = before.map((target) => {
    const hook = probeHookConfig(root, target.id);
    const capability = target.id === "cursor"
      ? "audit after write"
      : hook.capabilities.canDeny
        ? "deny before write"
        : "detection only";
    return {
      id: target.id,
      label: HARNESSES[target.id].label,
      executable: target.executable,
      hook,
      capability,
    };
  });
  const table = renderTable(
    ["Agent", "CLI", "Hook", "Capability", "Confidence"],
    targets.map((target) => [
      target.label,
      target.executable === null ? "not found" : "found",
      target.hook.installed ? "installed" : "not installed",
      target.hook.installed ? target.capability : "not active",
      target.hook.capabilities.confidence,
    ]),
  );
  const initData = initialized.data as { created: boolean };
  const result = doctor.exitCode === 0
    ? accepted.length > 0
      ? `Ready; installed hooks for ${accepted.join(", ")}`
      : "Ready with drift detection; hook protection is optional"
    : "Setup needs attention; no agent was started";

  return {
    data: {
      repoRoot: root,
      initialized: initData.created,
      targets,
      installedHooks: accepted,
      doctor: doctor.data,
    },
    human: renderSections([
      { title: "Context", lines: [`Repository  ${root}`, `Initialized ${initData.created ? "now" : "already"}`] },
      { title: "Checks", lines: table },
      { title: "Result", lines: result },
      {
        title: "Next",
        lines: doctor.exitCode === 0
          ? "Define a task boundary: scopelock contract new --help"
          : "Apply the reported fixes, then run: scopelock setup",
      },
    ]),
    exitCode: doctor.exitCode,
  };
}
