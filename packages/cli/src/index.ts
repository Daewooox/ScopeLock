#!/usr/bin/env node
import { Command } from "commander";
import { run } from "./run.js";
import { initCommand } from "./commands/init.js";
import { doctorCommand } from "./commands/doctor.js";
import { checkDriftCommand } from "./commands/check-drift.js";
import { approveCommand } from "./commands/approve.js";
import { exportPromptCommand } from "./commands/export-prompt.js";
import { injectContractCommand } from "./commands/inject-contract.js";
import { hookGateCommand } from "./commands/hook.js";
import {
  hooksInstallCommand,
  hooksUninstallCommand,
} from "./commands/hooks.js";

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

const hook = program.command("hook").description("internal hook entrypoints");

hook
  .command("gate")
  .description("evaluate a hook event and deny in strict mode")
  .action(() => hookGateCommand());

hook
  .command("audit")
  .description("evaluate a hook event and always audit instead of denying")
  .action(() => hookGateCommand({ forceAudit: true }));

const hooks = program.command("hooks").description("install or uninstall agent hooks");

hooks
  .command("install")
  .requiredOption("--target <id>", "hook target: claude or cursor")
  .option("--mode <mode>", "warn or strict", "warn")
  .option("--json", "print machine-readable JSON")
  .action(
    (options: { target: string; mode: "warn" | "strict" }, command: Command) =>
      run(() => hooksInstallCommand(options), jsonOf(command)),
  );

hooks
  .command("uninstall")
  .requiredOption("--target <id>", "hook target: claude or cursor")
  .option("--json", "print machine-readable JSON")
  .action((options: { target: string }, command: Command) =>
    run(() => hooksUninstallCommand(options), jsonOf(command)),
  );

// Explicit "node" convention (argv[0]=runtime, argv[1]=script): commander
// otherwise auto-detects Electron-based runtimes and shifts argv parsing.
await program.parseAsync(process.argv, { from: "node" });
