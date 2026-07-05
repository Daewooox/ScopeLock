import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  approvedContractSchema,
  currentBranch,
  findRepoRoot,
  headSha,
  saveContract,
  scopelockPaths,
  setActiveContractId,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";

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
  if (await exists(join(paths.contractsDir, `${stamped.id}.json`))) {
    throw new CliError(
      "CONTRACT_ID_EXISTS",
      `contract id already exists: ${stamped.id}`,
    );
  }

  const savedPath = await saveContract(paths, stamped);
  if (options.activate) {
    await setActiveContractId(paths, stamped.id);
  }

  return {
    data: {
      contractId: stamped.id,
      baseline: stamped.baseline,
      active: options.activate,
      path: savedPath,
    },
    human: `approved ${stamped.id} at ${sha}${options.activate ? " (active)" : ""}`,
    exitCode: 0,
  };
}
