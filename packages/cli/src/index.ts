#!/usr/bin/env node
import { Command } from "commander";
import { run } from "./run.js";
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
import {
  hooksInstallCommand,
  hooksUninstallCommand,
  hooksVerifyCommand,
} from "./commands/hooks.js";

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

const program = new Command();

program
  .name("scopelock")
  .description("Local guardrails for AI coding agents")
  .option("--json", "print machine-readable JSON");

function jsonOf(command: Command): { json: boolean } {
  const opts = command.optsWithGlobals<{ json?: boolean }>();
  return { json: opts.json === true };
}

program
  .command("approve")
  .description("approve a contract and capture the current git baseline")
  .argument("<contract>", "path to approved contract JSON")
  .option("--no-activate", "save contract without making it active")
  .option("--json", "print machine-readable JSON")
  .action((contract: string, options: { activate: boolean }, command: Command) =>
    run(() => approveCommand(contract, options), jsonOf(command)),
  );

program
  .command("rebaseline")
  .description("re-anchor an existing contract's baseline to the current commit (repairs a stale baseline)")
  .argument("[contract]", "contract id to rebaseline (default: the active contract)")
  .option("--json", "print machine-readable JSON")
  .action((contract: string | undefined, _options: unknown, command: Command) =>
    run(() => rebaselineCommand(contract), jsonOf(command)),
  );

program
  .command("init")
  .description("create the .scopelock directory and default config")
  .option("--json", "print machine-readable JSON")
  .action((_options, command: Command) => run(initCommand, jsonOf(command)));

program
  .command("doctor")
  .description("check local ScopeLock setup")
  .option("--json", "print machine-readable JSON")
  .action((_options, command: Command) => run(doctorCommand, jsonOf(command)));

program
  .command("check-drift")
  .description("compare the approved contract with actual repo changes")
  .option("--base <sha>", "override the approved baseline SHA")
  .option("--json", "print machine-readable JSON")
  .action((options: { base?: string }, command: Command) =>
    run(() => checkDriftCommand(options), jsonOf(command)),
  );

program
  .command("export-prompt")
  .description("print the active contract as agent instructions")
  .requiredOption("--target <id>", "agent target: claude, codex, cursor")
  .option("--json", "print machine-readable JSON")
  .action((options: { target: string }, command: Command) =>
    run(() => exportPromptCommand(options), jsonOf(command)),
  );

program
  .command("inject-contract")
  .description("inject the active contract into the target agent doc file")
  .option("--target <id>", "agent target: claude, codex, cursor")
  .option("--json", "print machine-readable JSON")
  .action((options: { target?: string }, command: Command) =>
    run(() => injectContractCommand(options), jsonOf(command)),
  );

const contract = program
  .command("contract")
  .description("author and inspect ScopeLock contracts");

contract
  .command("new")
  .description("scaffold a schema-valid draft contract (deterministic, no LLM)")
  .requiredOption("--task <text>", "one-line description of the task")
  .option("--id <id>", "contract id (default: slug of task + date)")
  .option("--planned <glob>", "planned path glob (repeatable)", collect, [])
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
        forbidden: string[];
        read: string[];
        agent: string[];
        test: string[];
        out?: string;
      },
      command: Command,
    ) => run(() => contractNewCommand(options), jsonOf(command)),
  );

program
  .command("plan-parallel")
  .description("derive a parallel-safe schedule (waves) from a plan of task contracts")
  .argument("<plan>", "path to a plan-parallel JSON file")
  .option(
    "--include-read-hazards",
    "also order writer-before-reader using each contract's readPathPatterns (F2)",
  )
  .option("--json", "print machine-readable JSON")
  .action((plan: string, options: { includeReadHazards?: boolean }, command: Command) =>
    run(() => planParallelCommand(plan, options), jsonOf(command)),
  );

program
  .command("manifest")
  .description("build a deterministic repo manifest from tracked git files")
  .option("--json", "print machine-readable JSON")
  .action((_options, command: Command) => run(manifestCommand, jsonOf(command)));

program
  .command("run")
  .description("thin dispatcher: run plan tasks by safe waves and write a receipt")
  .requiredOption("--plan <path>", "path to a plan JSON file")
  .option("--no-read-hazards", "ignore contract readPathPatterns when scheduling")
  .option("--no-defer-write-conflicts", "run write-write conflicts instead of deferring one side")
  .option("--no-check-drift", "skip the final check-drift receipt step")
  .option("--receipt <path>", "write receipt to a custom path")
  .option("--json", "print machine-readable JSON")
  .action(
    (
      options: {
        plan: string;
        readHazards?: boolean;
        deferWriteConflicts?: boolean;
        checkDrift?: boolean;
        receipt?: string;
      },
      command: Command,
    ) => run(() => runPlanCommand(options), jsonOf(command)),
  );

const agents = program.command("agents").description("agent environment attestation");

agents
  .command("preflight")
  .description("verify agent rules/skills are physically present and consistent before dispatch (read-only)")
  .requiredOption("--manifest <path>", "path to an agent workspace manifest JSON file")
  .option("--target <id>", "restrict the check to this target (repeatable)", collect, [])
  .option("--json", "print machine-readable JSON")
  .action(
    (options: { manifest: string; target: string[] }, command: Command) =>
      run(() => agentsPreflightCommand(options), jsonOf(command)),
  );

const hook = program.command("hook").description("internal hook entrypoints");

hook
  .command("gate")
  .description("evaluate a hook event and deny in strict mode")
  .option("--format <format>", "hook host output format: plain or codex", "plain")
  .action((options: { format: "plain" | "codex" }) => hookGateCommand({ format: options.format }));

hook
  .command("audit")
  .description("evaluate a hook event and always audit instead of denying")
  .action(() => hookGateCommand({ forceAudit: true }));

const hooks = program.command("hooks").description("install or uninstall agent hooks");

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

// Explicit "node" convention (argv[0]=runtime, argv[1]=script): commander
// otherwise auto-detects Electron-based runtimes and shifts argv parsing.
await program.parseAsync(process.argv, { from: "node" });
