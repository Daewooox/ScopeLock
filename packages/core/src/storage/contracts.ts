import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  approvedContractSchema,
  type ApprovedContract,
} from "../schemas/contract.js";
import { writeJsonAtomic } from "./atomic.js";
import type { ScopelockPaths } from "./paths.js";

export async function saveContract(
  paths: ScopelockPaths,
  contract: ApprovedContract,
): Promise<string> {
  const filePath = join(paths.contractsDir, `${contract.id}.json`);
  await writeJsonAtomic(filePath, contract);
  return filePath;
}

export async function loadContract(
  paths: ScopelockPaths,
  id: string,
): Promise<ApprovedContract> {
  const raw = await readFile(join(paths.contractsDir, `${id}.json`), "utf8");
  return approvedContractSchema.parse(JSON.parse(raw));
}

export async function setActiveContractId(
  paths: ScopelockPaths,
  id: string,
): Promise<void> {
  // Stored as a JSON string (quoted) so read/write share one atomic codepath.
  await writeJsonAtomic(paths.activePath, id);
}

/** Returns null when no contract has been activated yet. */
export async function getActiveContractId(
  paths: ScopelockPaths,
): Promise<string | null> {
  try {
    const raw = await readFile(paths.activePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
