import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { ApprovedContract } from "../schemas/contract.js";
import { runGit } from "../git/exec.js";
import { hooksConfigPath } from "../harness/hooks-merge.js";
import { hashFileBytes } from "../agents/hash.js";
import { contractFilePath } from "./contracts.js";
import { scopelockPaths } from "./paths.js";
import { writeJsonAtomic } from "./atomic.js";

const approvalSealSchema = z.object({
  schemaVersion: z.literal(1),
  repoFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  contractId: z.string().min(1),
  contractDigest: z.string().regex(/^[a-f0-9]{64}$/),
  baselineSha: z.string().min(1),
  configDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  hookDigests: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/).nullable()),
  approvedAt: z.iso.datetime(),
});

export type ApprovalSealVerification = {
  ok: boolean;
  reason: "ok" | "missing" | "invalid" | "mismatch";
  detail: string;
};

function stateBaseDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "ScopeLock", "state");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ScopeLock", "state");
  }
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "scopelock");
}

async function repoFingerprint(repoRoot: string): Promise<string> {
  const canonicalRoot = await realpath(repoRoot);
  const common = runGit(["rev-parse", "--git-common-dir"], canonicalRoot);
  const commonDir = common.ok
    ? resolve(canonicalRoot, common.stdout)
    : canonicalRoot;
  return createHash("sha256").update(canonicalRoot).update("\0").update(commonDir).digest("hex");
}

async function digestIfPresent(path: string): Promise<string | null> {
  try {
    await access(path);
    return hashFileBytes(path);
  } catch {
    return null;
  }
}

async function sealPath(repoRoot: string, contractId: string): Promise<string> {
  return join(stateBaseDir(), await repoFingerprint(repoRoot), "approvals", `${contractId}.json`);
}

async function currentHookDigests(repoRoot: string): Promise<Record<string, string | null>> {
  return Object.fromEntries(
    await Promise.all(
      (["claude", "cursor", "codex"] as const).map(async (target) => [
        target,
        await digestIfPresent(hooksConfigPath(repoRoot, target)),
      ]),
    ),
  );
}

export async function writeApprovalSeal(repoRoot: string, contract: ApprovedContract): Promise<string> {
  if (contract.baseline === null) throw new Error("cannot seal a contract without a baseline");
  const paths = scopelockPaths(repoRoot);
  const path = await sealPath(repoRoot, contract.id);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(path, {
    schemaVersion: 1,
    repoFingerprint: await repoFingerprint(repoRoot),
    contractId: contract.id,
    contractDigest: hashFileBytes(contractFilePath(paths, contract.id)),
    baselineSha: contract.baseline.headSha,
    configDigest: await digestIfPresent(paths.configPath),
    hookDigests: await currentHookDigests(repoRoot),
    approvedAt: new Date().toISOString(),
  });
  return path;
}

export async function verifyApprovalSeal(
  repoRoot: string,
  contract: ApprovedContract,
): Promise<ApprovalSealVerification> {
  let raw: string;
  try {
    raw = await readFile(await sealPath(repoRoot, contract.id), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ok: false, reason: "missing", detail: "approval seal is missing; run scopelock rebaseline" };
    }
    return { ok: false, reason: "invalid", detail: error instanceof Error ? error.message : String(error) };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid", detail: "approval seal is not valid JSON" };
  }
  const parsed = approvalSealSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid", detail: "approval seal is invalid" };
  const paths = scopelockPaths(repoRoot);
  const current = {
    repoFingerprint: await repoFingerprint(repoRoot),
    contractDigest: hashFileBytes(contractFilePath(paths, contract.id)),
    baselineSha: contract.baseline?.headSha ?? "",
    configDigest: await digestIfPresent(paths.configPath),
    hookDigests: await currentHookDigests(repoRoot),
  };
  if (
    parsed.data.repoFingerprint !== current.repoFingerprint ||
    parsed.data.contractDigest !== current.contractDigest ||
    parsed.data.baselineSha !== current.baselineSha ||
    parsed.data.configDigest !== current.configDigest ||
    JSON.stringify(parsed.data.hookDigests) !== JSON.stringify(current.hookDigests)
  ) {
    return { ok: false, reason: "mismatch", detail: "approved contract or guardrail configuration changed after approval" };
  }
  return { ok: true, reason: "ok", detail: "approval seal matches" };
}
