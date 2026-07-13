import {
  approvedContractSchema,
  currentBranch,
  findRepoRoot,
  getActiveContractId,
  headSha,
  loadContract,
  saveContract,
  scopelockPaths,
  writeApprovalSeal,
} from "@scopelock/core";
import { CliError, type CommandResult } from "../run.js";

/**
 * Re-anchor an existing approved contract's baseline to the current HEAD.
 *
 * This is the repair path for a stale baseline - e.g. the commit it was
 * stamped against was dropped by a history rewrite, rebase, or squash-merge,
 * so `check-drift` can no longer diff against it. Unlike `approve`, which
 * refuses an id that already exists, `rebaseline` operates on the already
 * saved contract in place: everything (id, task, scope, createdAt) is kept;
 * only the baseline commit/branch/timestamp are refreshed.
 *
 * Semantics: re-anchoring to HEAD means "treat the current commit as the new
 * starting point" - drift accumulated in commits before the new baseline is
 * no longer reported. That is exactly what you want when resuming after a
 * rewrite; it is not an undo of real work.
 */
export async function rebaselineCommand(
  contractId?: string,
): Promise<CommandResult> {
  const root = findRepoRoot(process.cwd());
  if (root === null) {
    throw new CliError(
      "NOT_A_GIT_REPO",
      "rebaseline must run inside a git repository",
    );
  }

  const paths = scopelockPaths(root);
  const id = contractId ?? (await getActiveContractId(paths));
  if (id === null) {
    throw new CliError(
      "NO_ACTIVE_CONTRACT",
      "no contract id given and no active contract; pass `scopelock contract rebaseline <id>`",
    );
  }

  const sha = headSha(root);
  if (sha === null) {
    throw new CliError(
      "NO_HEAD",
      "cannot rebaseline before the repository has an initial commit",
    );
  }

  let contract;
  try {
    contract = await loadContract(paths, id);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CliError("CONTRACT_NOT_FOUND", `contract not found: ${id}`);
    }
    throw error;
  }

  const rebaselined = approvedContractSchema.parse({
    ...contract,
    baseline: {
      headSha: sha,
      branch: currentBranch(root),
      capturedAt: new Date().toISOString(),
    },
  });
  const savedPath = await saveContract(paths, rebaselined);
  const sealPath = await writeApprovalSeal(root, rebaselined);

  return {
    data: {
      contractId: id,
      baseline: rebaselined.baseline,
      path: savedPath,
      sealPath,
    },
    human: `rebaselined ${id} to ${sha}`,
    exitCode: 0,
  };
}
