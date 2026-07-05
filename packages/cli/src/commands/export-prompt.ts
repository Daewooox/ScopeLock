import {
  agentIdSchema,
  findRepoRoot,
  getActiveContractId,
  loadContract,
  renderAgentPrompt,
  scopelockPaths,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";

export async function exportPromptCommand(options: {
  target: string;
}): Promise<CommandResult> {
  const target = agentIdSchema.parse(options.target);
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "export-prompt must run inside a git repository",
    );
  }

  const paths = scopelockPaths(root);
  const activeId = await getActiveContractId(paths);
  if (activeId === null) {
    throw new CliError(
      "NO_ACTIVE_CONTRACT",
      "no active approved contract; approve one with `scopelock approve <file>`",
    );
  }

  const contract = await loadContract(paths, activeId);
  const prompt = renderAgentPrompt(contract, target);
  return {
    data: { prompt, target },
    human: prompt,
    exitCode: 0,
  };
}
