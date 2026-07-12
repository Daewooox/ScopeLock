import { runGitAsync } from "./exec.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_UNINCORPORATED_COMMITS = 20;

export type PushGuardVerdict =
  | { safe: true }
  | { safe: false; unincorporated: string[] };

export type CheckPushSafetyInput = {
  repoRoot: string;
  remote: string;
  remoteRef: string;
  localSha: string;
  timeoutMs?: number;
};

function isMissingRemoteRef(stderr: string): boolean {
  return /couldn't find remote ref|could not find remote ref/i.test(stderr);
}

function unsafe(unincorporated: string[] = []): PushGuardVerdict {
  return { safe: false, unincorporated };
}

export async function checkPushSafety(
  input: CheckPushSafetyInput,
): Promise<PushGuardVerdict> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetch = await runGitAsync(
    ["fetch", "--no-tags", input.remote, input.remoteRef],
    input.repoRoot,
    { timeoutMs },
  );

  if (!fetch.ok) {
    if (!fetch.timedOut && isMissingRemoteRef(fetch.stderr)) {
      return { safe: true };
    }
    return unsafe();
  }

  const remoteSha = await runGitAsync(["rev-parse", "FETCH_HEAD"], input.repoRoot, {
    timeoutMs,
  });
  if (!remoteSha.ok) {
    return unsafe();
  }

  const revList = await runGitAsync(
    [
      "rev-list",
      `--max-count=${MAX_UNINCORPORATED_COMMITS}`,
      remoteSha.stdout.toString("utf8").trim(),
      `^${input.localSha}`,
    ],
    input.repoRoot,
    { timeoutMs },
  );
  if (!revList.ok) {
    return unsafe();
  }

  const unincorporated = revList.stdout
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return unincorporated.length === 0 ? { safe: true } : unsafe(unincorporated);
}
