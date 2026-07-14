import { access, readFile } from "node:fs/promises";
import {
  approvedContractSchema,
  currentBranch,
  contractFilePath,
  findRepoRoot,
  headSha,
  saveContract,
  scopelockPaths,
  setActiveContractId,
  writeApprovalSeal,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";
import { renderSections } from "../ui.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function approveCommand(
  contractPath: string,
  options: { activate: boolean },
): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "approve must run inside a git repository",
    );
  }

  const sha = headSha(root);
  if (sha === null) {
    throw new CliError(
      "NO_HEAD",
      "cannot approve before the repository has an initial commit",
    );
  }

  const raw = await readFile(contractPath, "utf8");
  const parsed = approvedContractSchema.parse(JSON.parse(raw));
  const stamped = approvedContractSchema.parse({
    ...parsed,
    baseline: {
      headSha: sha,
      branch: currentBranch(root),
      capturedAt: new Date().toISOString(),
    },
  });

  const paths = scopelockPaths(root);
  if (await exists(contractFilePath(paths, stamped.id))) {
    throw new CliError(
      "CONTRACT_ID_EXISTS",
      `contract id already exists: ${stamped.id}`,
    );
  }

  const savedPath = await saveContract(paths, stamped);
  if (options.activate) {
    await setActiveContractId(paths, stamped.id);
  }
  const sealPath = await writeApprovalSeal(root, stamped);

  return {
    data: {
      contractId: stamped.id,
      baseline: stamped.baseline,
      active: options.activate,
      path: savedPath,
      sealPath,
    },
    human: renderSections([
      { title: "Context", lines: `Task boundary  ${stamped.id}` },
      {
        title: "Result",
        lines: [
          `Approved  yes${options.activate ? ", active" : ""}`,
          `Baseline  ${sha}`,
          `Contract  ${savedPath}`,
        ],
      },
      {
        title: "Next",
        lines: options.activate
          ? "Share it with an agent: scopelock contract inject"
          : "Activate or select the contract before starting work",
      },
    ]),
    exitCode: 0,
  };
}
