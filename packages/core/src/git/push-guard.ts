import { runGitAsync } from "./exec.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_UNINCORPORATED_COMMITS = 20;

export type PushGuardVerdict =
  | {
      safe: true;
      lease: { remoteRef: string; expectedRemoteSha: string | null };
    }
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

const objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const remoteNamePattern = /^(?!-)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function canonicalBranchRef(remoteRef: string): string | null {
  if (remoteRef.length === 0 || remoteRef.startsWith("-")) return null;
  return remoteRef.startsWith("refs/heads/")
    ? remoteRef
    : `refs/heads/${remoteRef}`;
}

export async function checkPushSafety(
  input: CheckPushSafetyInput,
): Promise<PushGuardVerdict> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const remoteRef = canonicalBranchRef(input.remoteRef);
  if (
    !remoteNamePattern.test(input.remote) ||
    remoteRef === null ||
    !objectIdPattern.test(input.localSha)
  ) {
    return unsafe();
  }

  const [remotes, validRef] = await Promise.all([
    runGitAsync(["remote"], input.repoRoot, { timeoutMs }),
    runGitAsync(["check-ref-format", remoteRef], input.repoRoot, { timeoutMs }),
  ]);
  if (
    !remotes.ok ||
    !validRef.ok ||
    !remotes.stdout.toString("utf8").split(/\r?\n/).includes(input.remote)
  ) {
    return unsafe();
  }

  const fetch = await runGitAsync(
    ["fetch", "--no-tags", "--", input.remote, remoteRef],
    input.repoRoot,
    { timeoutMs },
  );

  if (!fetch.ok) {
    if (!fetch.timedOut && isMissingRemoteRef(fetch.stderr)) {
      return {
        safe: true,
        lease: { remoteRef, expectedRemoteSha: null },
      };
    }
    return unsafe();
  }

  const remoteSha = await runGitAsync(["rev-parse", "FETCH_HEAD"], input.repoRoot, {
    timeoutMs,
  });
  if (!remoteSha.ok) {
    return unsafe();
  }
  const expectedRemoteSha = remoteSha.stdout.toString("utf8").trim();
  if (!objectIdPattern.test(expectedRemoteSha)) {
    return unsafe();
  }

  const revList = await runGitAsync(
    [
      "rev-list",
      `--max-count=${MAX_UNINCORPORATED_COMMITS}`,
      expectedRemoteSha,
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

  return unincorporated.length === 0
    ? { safe: true, lease: { remoteRef, expectedRemoteSha } }
    : unsafe(unincorporated);
}
