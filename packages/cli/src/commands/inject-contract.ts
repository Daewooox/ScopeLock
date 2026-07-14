import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  agentIdSchema,
  findRepoRoot,
  getActiveContractId,
  getHarness,
  injectContractSection,
  loadContract,
  renderAgentPrompt,
  scopelockPaths,
} from "@scopelock/core";
import type { AgentId } from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function injectContractCommand(options: {
  target?: string;
}): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "inject-contract must run inside a git repository",
    );
  }

  const paths = scopelockPaths(root);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError(
      "NO_ACTIVE_CONTRACT",
      "no active approved contract; approve one with `scopelock contract approve <file>`",
    );
  }

  const contract = await loadContract(paths, activeId);
  const target: AgentId =
    options.target === undefined
      ? (contract.targetAgents[0] ?? "codex")
      : agentIdSchema.parse(options.target);
  const harness = getHarness(target);
  const docPath = join(root, harness.docFile);
  const prompt = renderAgentPrompt(contract, target);
  const next = injectContractSection(await readExisting(docPath), prompt);

  await writeFile(docPath, next, "utf8");

  return {
    data: { target, docFile: harness.docFile, path: docPath },
    human: renderSections([
      { title: "Context", lines: [`Task boundary  ${contract.id}`, `Agent          ${target}`] },
      { title: "Result", lines: `Instructions updated  ${harness.docFile}` },
      { title: "Next", lines: "Let the agent work, then verify: scopelock check-drift" },
    ]),
    exitCode: 0,
  };
}
