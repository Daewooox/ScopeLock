#!/usr/bin/env node
import { Command } from "commander";
import { CliError, run } from "./run.js";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { checkDriftCommand } from "./commands/check-drift.js";
import { approveCommand } from "./commands/approve.js";
import { rebaselineCommand } from "./commands/rebaseline.js";
import { exportPromptCommand } from "./commands/export-prompt.js";
import { injectContractCommand } from "./commands/inject-contract.js";
import { hookGateCommand } from "./commands/hook.js";
import { contractNewCommand } from "./commands/contract-new.js";
import { planParallelCommand } from "./commands/plan-parallel.js";
import { manifestCommand } from "./commands/manifest.js";
import { agentsPreflightCommand } from "./commands/agents-preflight.js";
import { runPlanCommand } from "./commands/run-plan.js";
import { reportCommand } from "./commands/report.js";
import { planFillCommandsCommand } from "./commands/plan-fill-commands.js";
import { planPrepareCommand } from "./commands/plan-prepare.js";
import {
  hooksInstallCommand,
  hooksUninstallCommand,
  hooksVerifyCommand,
} from "./commands/hooks.js";
import { setupCommand } from "./commands/setup.js";
import { taskStartCommand } from "./commands/task-start.js";
import { taskFinishCommand } from "./commands/task-finish.js";
import { confirmPrompt, questionPrompt } from "./prompts.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const program = new Command();

program
  .name("scopelock")
  .description("Local flight control for AI coding agents")
  .option("--json", "print machine-readable JSON");

program.addHelpText(
  "after",
  [
    "",
    "Quick start:",
    "  scopelock setup",
    "  scopelock task start --help",
    "  scopelock task finish --help",
  ].join("\n"),
);

function jsonOf(command: Command): { json: boolean } {
  const opts = command.optsWithGlobals<{ json?: boolean }>();
  return { json: opts.json === true };
}

function registerApprove(parent: Command, name: string, hidden = false): void {
  parent
  .command(name, { hidden })
  .description("approve a scope contract and capture its git baseline")
  .argument("<contract>", "path to approved contract JSON")
  .option("--no-activate", "save contract without making it active")
  .option("--json", "print machine-readable JSON")
  .action((contract: string, options: { activate: boolean }, command: Command) =>
    run(() => approveCommand(contract, options), jsonOf(command)),
  );
}

function registerRebaseline(parent: Command, name: string, hidden = false): void {
  parent
  .command(name, { hidden })
  .description("re-anchor an existing contract's baseline to the current commit (repairs a stale baseline)")
  .argument("[contract]", "contract id to rebaseline (default: the active contract)")
  .option("--json", "print machine-readable JSON")
  .action((contract: string | undefined, _options: unknown, command: Command) =>
    run(() => rebaselineCommand(contract), jsonOf(command)),
  );
}

program
  .command("setup")
  .helpGroup("Start here:")
  .description("prepare this repository and check agent protection")
  .option("--target <id>", "agent target: claude, codex, cursor (repeatable)", collect, [])
  .option("--install-hooks", "install missing ScopeLock hooks after confirmation")
  .option("--yes", "confirm the reviewed hook installation without prompting")
  .option("--mode <mode>", "hook mode: warn or strict", "warn")
  .option("--local", "use this local CLI path in installed hooks")
  .option("--json", "print machine-readable JSON")
  .action(
    (
      options: {
        target: string[];
        installHooks?: boolean;
        yes?: boolean;
        mode: "warn" | "strict";
        local?: boolean;
      },
      command: Command,
    ) => {
      const json = jsonOf(command);
      return run(
        () => setupCommand(
          {
            targets: options.target,
            installHooks: options.installHooks,
            yes: options.yes,
            mode: options.mode,
            local: options.local,
            interactive: !json.json && process.stdin.isTTY === true && process.stdout.isTTY === true,
          },
          { confirm: (message) => confirmPrompt(message) },
        ),
        json,
      );
    },
  );

program
  .command("init")
  .helpGroup("Start here:")
  .description("initialize ScopeLock in this repository")
  .option("--json", "print machine-readable JSON")
  .action((_options, command: Command) => run(initCommand, jsonOf(command)));

program
  .command("doctor")
  .helpGroup("Start here:")
  .description("diagnose the local ScopeLock setup")
  .option("--json", "print machine-readable JSON")
  .action((_options, command: Command) => run(doctorCommand, jsonOf(command)));

function registerContractExport(parent: Command, name: string, hidden = false): void {
  parent
  .command(name, { hidden })
  .description("render the active contract as agent-ready instructions")
  .requiredOption("--target <id>", "agent target: claude, codex, cursor")
  .option("--json", "print machine-readable JSON")
  .action((options: { target: string }, command: Command) =>
    run(() => exportPromptCommand(options), jsonOf(command)),
  );
}

function registerContractInject(parent: Command, name: string, hidden = false): void {
  parent
  .command(name, { hidden })
  .description("place the active contract in the target agent instruction file")
  .option("--target <id>", "agent target: claude, codex, cursor")
  .option("--json", "print machine-readable JSON")
  .action((options: { target?: string }, command: Command) =>
    run(() => injectContractCommand(options), jsonOf(command)),
  );
}

const contract = program
  .command("contract")
  .helpGroup("Protect one task:")
  .description("create, approve, and share task boundaries");

contract
  .command("new")
  .description("create a reviewable draft scope contract")
  .requiredOption("--task <text>", "one-line description of the task")
  .option("--id <id>", "contract id (default: slug of task + date)")
  .option("--planned <glob>", "planned path glob (repeatable)", collect, [])
  .option("--allow-all", "explicitly allow changes to every path not forbidden")
  .option("--forbidden <glob>", "forbidden path glob (repeatable)", collect, [])
  .option("--read <glob>", "read-only path glob, advisory (repeatable)", collect, [])
  .option("--agent <id>", "target agent: claude, codex, cursor (repeatable)", collect, [])
  .option("--test <type>", "required test type, e.g. unit (repeatable)", collect, [])
  .option("--out <path>", "write to a file instead of stdout")
  .option("--json", "print machine-readable JSON")
  .action(
    (
      options: {
        task: string;
        id?: string;
        planned: string[];
        allowAll?: boolean;
        forbidden: string[];
        read: string[];
        agent: string[];
        test: string[];
        out?: string;
      },
      command: Command,
    ) => run(() => contractNewCommand(options), jsonOf(command)),
  );

registerApprove(contract, "approve");
registerRebaseline(contract, "rebaseline");
registerContractExport(contract, "export");
registerContractInject(contract, "inject");

// Compatibility aliases stay parseable but no longer crowd the public help.
registerApprove(program, "approve", true);
registerRebaseline(program, "rebaseline", true);
registerContractExport(program, "export-prompt", true);
registerContractInject(program, "inject-contract", true);

const task = program
  .command("task")
  .helpGroup("Protect one task:")
  .description("start and verify one bounded agent task");

task
  .command("start")
  .description("create, review, and approve a task boundary")
  .argument("[description]", "one-line description of the task")
  .option("--agent <id>", "agent: claude, codex, or cursor")
  .option("--allow <path>", "file, directory, or glob the agent may change (repeatable)", collect, [])
  .option("--block <path>", "file, directory, or glob the agent must not change (repeatable)", collect, [])
  .option("--context <path>", "task context path, advisory (repeatable)", collect, [])
  .option("--read <path>", "alias for --context (repeatable)", collect, [])
  .option("--test <type>", "required test type, for example unit (repeatable)", collect, [])
  .option("--id <id>", "contract id")
  .option("--yes", "approve the displayed boundary without prompting")
  .option("--inject", "update the target agent instruction file after preflight")
  .option("--json", "print machine-readable JSON")
  .action(
    (
      description: string | undefined,
      options: {
        agent?: string;
        allow: string[];
        block: string[];
        context: string[];
        read: string[];
        test: string[];
        id?: string;
        yes?: boolean;
        inject?: boolean;
      },
      command: Command,
    ) => {
      const json = jsonOf(command);
      const interactive = !json.json && process.stdin.isTTY === true && process.stdout.isTTY === true;
      return run(
        () => taskStartCommand(
          {
            description,
            ...options,
            context: [...options.context, ...options.read],
            interactive,
          },
          {
            question: questionPrompt,
            confirm: (message) => confirmPrompt(message, {
              suffix: "Continue? [y/N] ",
              cancellationCode: "TASK_START_CANCELLED",
              cancellationMessage: "task start cancelled before the next mutation",
            }),
          },
        ),
        json,
      );
    },
  );

task
  .command("finish")
  .description("check the active task and create its Flight Report")
  .option("--out <path>", "write HTML report to this path")
  .option("--open", "open the generated report in the default browser")
  .option("--json", "print machine-readable JSON")
  .action((options: { out?: string; open?: boolean }, command: Command) =>
    run(() => taskFinishCommand(options), jsonOf(command)),
  );

program
  .command("check-drift")
  .helpGroup("Protect one task:")
  .description("verify changes against the approved task boundary")
  .option("--base <sha>", "override the approved baseline SHA")
  .option("--json", "print machine-readable JSON")
  .action((options: { base?: string }, command: Command) =>
    run(() => checkDriftCommand(options), jsonOf(command)),
  );

function registerPlanSchedule(parent: Command, name: string, hidden = false): void {
  parent
  .command(name, { hidden })
  .description("detect task conflicts and build safe execution stages")
  .argument("<plan>", "path to a plan-parallel JSON file")
  .option(
    "--include-read-hazards",
    "also order writer-before-reader using each contract's readPathPatterns (F2)",
  )
  .option("--json", "print machine-readable JSON")
  .action((plan: string, options: { includeReadHazards?: boolean }, command: Command) =>
    run(() => planParallelCommand(plan, options), jsonOf(command)),
  );
}

function registerPlanCompose(parent: Command, name: string, hidden = false): void {
  parent
  .command(name, { hidden })
  .description("add explicit, reviewable agent commands to a plan")
  .argument("<plan>", "path to a plan JSON file")
  .requiredOption("--target <id>", "agent target: codex, claude, or cursor")
  .option("--out <path>", "write the enriched plan to this path")
  .option("--force", "replace commands already present in the plan")
  .option("--json", "print machine-readable JSON")
  .action(
    (
      planPath: string,
      options: { target: string; out?: string; force?: boolean },
      command: Command,
    ) => run(() => planFillCommandsCommand(planPath, options), jsonOf(command)),
  );
}

const plan = program
  .command("plan")
  .helpGroup("Coordinate agents:")
  .description("schedule and compose multi-agent work");

registerPlanSchedule(plan, "schedule");
registerPlanCompose(plan, "compose");

plan
  .command("prepare")
  .description("validate, schedule, preflight, and compose a reviewable plan")
  .argument("<plan>", "path to a plan JSON file")
  .requiredOption("--target <id>", "agent target: codex, claude, or cursor")
  .requiredOption("--out <path>", "write the ready plan to a separate file")
  .option("--manifest <path>", "check rules and skills from an agent workspace manifest")
  .option("--no-read-hazards", "ignore contract readPathPatterns when scheduling")
  .option("--json", "print machine-readable JSON")
  .action(
    (
      planPath: string,
      options: { target: string; out: string; manifest?: string; readHazards?: boolean },
      command: Command,
    ) => run(() => planPrepareCommand(planPath, options), jsonOf(command)),
  );

registerPlanCompose(plan, "fill-commands", true);
registerPlanSchedule(program, "plan-parallel", true);

program
  .command("manifest")
  .helpGroup("Inspect:")
  .description("build a deterministic repo manifest from tracked git files")
  .option("--json", "print machine-readable JSON")
  .action((_options, command: Command) => run(manifestCommand, jsonOf(command)));

program
  .command("run")
  .helpGroup("Coordinate agents:")
  .description("run a reviewed plan in safe execution stages and write a receipt")
  .argument("[plan]", "path to a plan JSON file")
  .option("--plan <path>", "legacy form of the plan path")
  .option("--no-read-hazards", "ignore contract readPathPatterns when scheduling")
  .option("--no-defer-write-conflicts", "run write-write conflicts instead of deferring one side")
  .option("--no-check-drift", "skip the final check-drift receipt step")
  .option("--receipt <path>", "write receipt to a custom path")
  .option("--yes", "confirm that reviewed plan commands may execute with current user privileges")
  .option("--allow-shell", "allow string commands to run through the platform shell")
  .option("--timeout-ms <ms>", "per-task timeout in milliseconds", (value) => Number(value), 900_000)
  .option("--store-raw-output", "store redacted command/stdout/stderr artifacts locally")
  .option("--isolate", "run tasks in detached worktrees and promote only contract-approved diffs")
  .option("--json", "print machine-readable JSON")
  .action(
    (
      planPath: string | undefined,
      options: {
        plan?: string;
        readHazards?: boolean;
        deferWriteConflicts?: boolean;
        checkDrift?: boolean;
        receipt?: string;
        yes?: boolean;
        allowShell?: boolean;
        timeoutMs?: number;
        storeRawOutput?: boolean;
        isolate?: boolean;
      },
      command: Command,
    ) =>
      run(() => {
        if (planPath !== undefined && options.plan !== undefined && planPath !== options.plan) {
          throw new CliError("CONFLICTING_PLAN_PATHS", "pass the plan once: as an argument or with --plan");
        }
        const selectedPlan = planPath ?? options.plan;
        if (selectedPlan === undefined) {
          throw new CliError("PLAN_REQUIRED", "pass a plan path: scopelock run <plan.json>");
        }
        return runPlanCommand({ ...options, plan: selectedPlan });
      }, jsonOf(command)),
  );

program
  .command("report")
  .helpGroup("Inspect:")
  .description("render standalone HTML from a run receipt or drift report")
  .argument("<report>", "path to a ScopeLock receipt or drift JSON")
  .option("--out <path>", "write HTML report to this path")
  .option("--open", "open the generated report in the default browser")
  .option("--json", "print machine-readable JSON")
  .action((report: string, options: { out?: string; open?: boolean }, command: Command) =>
    run(() => reportCommand(report, options), jsonOf(command)),
  );

const agents = program
  .command("agents")
  .helpGroup("Advanced:")
  .description("agent environment attestation");

agents
  .command("preflight")
  .description("check agent rules, skills, and hook readiness before dispatch (read-only)")
  .requiredOption("--manifest <path>", "path to an agent workspace manifest JSON file")
  .option("--target <id>", "restrict the check to this target (repeatable)", collect, [])
  .option("--json", "print machine-readable JSON")
  .action(
    (options: { manifest: string; target: string[] }, command: Command) =>
      run(() => agentsPreflightCommand(options), jsonOf(command)),
  );

const hook = program.command("hook", { hidden: true }).description("internal hook entrypoints");

hook
  .command("gate")
  .description("evaluate a hook event and deny in strict mode")
  .option("--format <format>", "hook host output format: plain or codex", "plain")
  .action((options: { format: "plain" | "codex" }) => hookGateCommand({ format: options.format }));

hook
  .command("audit")
  .description("evaluate a hook event and always audit instead of denying")
  .action(() => hookGateCommand({ forceAudit: true }));

const hooks = program
  .command("hooks")
  .helpGroup("Advanced:")
  .description("manage agent enforcement hooks");

hooks
  .command("install")
  .requiredOption("--target <id>", "hook target: claude, cursor, or codex")
  .option("--mode <mode>", "warn or strict", "warn")
  .option(
    "--local",
    "write an absolute node invocation instead of the scopelock PATH binary",
  )
  .option("--json", "print machine-readable JSON")
  .action(
    (
      options: { target: string; mode: "warn" | "strict"; local?: boolean },
      command: Command,
    ) => run(() => hooksInstallCommand(options), jsonOf(command)),
  );

hooks
  .command("uninstall")
  .requiredOption("--target <id>", "hook target: claude, cursor, or codex")
  .option("--json", "print machine-readable JSON")
  .action((options: { target: string }, command: Command) =>
    run(() => hooksUninstallCommand(options), jsonOf(command)),
  );

hooks
  .command("verify")
  .requiredOption("--target <id>", "hook target: codex")
  .option("--codex-bin <path>", "Codex executable to use for live verification", "codex")
  .option("--timeout-ms <ms>", "verification timeout in milliseconds", (value) => Number(value), 90_000)
  .option("--json", "print machine-readable JSON")
  .action(
    (
      options: { target: string; codexBin: string; timeoutMs: number },
      command: Command,
    ) => run(() => hooksVerifyCommand(options), jsonOf(command)),
  );

program
  .commandsGroup("Help:")
  .helpCommand("help [command]", "display help for a command");

// Explicit "node" convention (argv[0]=runtime, argv[1]=script): commander
// otherwise auto-detects Electron-based runtimes and shifts argv parsing.
await program.parseAsync(process.argv, { from: "node" });
