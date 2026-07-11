import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  approvedContractSchema,
  contractIdSchema,
  type ApprovedContract,
} from "../schemas/contract.js";
import { writeJsonAtomic } from "./atomic.js";
import type { ScopelockPaths } from "./paths.js";

export function contractFilePath(paths: ScopelockPaths, id: string): string {
  const safeId = contractIdSchema.parse(id);
  const root = resolve(paths.contractsDir);
  const candidate = resolve(root, `${safeId}.json`);
  const rel = relative(root, candidate);
  if (rel.length === 0 || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`contract path escapes contracts directory: ${id}`);
  }
  return candidate;
}

export async function saveContract(
  paths: ScopelockPaths,
  contract: ApprovedContract,
): Promise<string> {
  const filePath = contractFilePath(paths, contract.id);
  await writeJsonAtomic(filePath, contract);
  return filePath;
}

export async function loadContract(
  paths: ScopelockPaths,
  id: string,
): Promise<ApprovedContract> {
  const raw = await readFile(contractFilePath(paths, id), "utf8");
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
    return contractIdSchema.parse(parsed);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
