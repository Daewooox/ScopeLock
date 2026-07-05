import { spawn, spawnSync } from "node:child_process";

export type GitResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type GitAsyncResult = {
  ok: boolean;
  stdout: Buffer;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

/**
 * Minimal synchronous git runner, enough for doctor/init. Phase 1 replaces
 * heavy usage with an async runner with timeouts; keep this one for cheap
 * one-shot queries.
 */
export function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    return { ok: false, stdout: "", stderr: result.error.message };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function runGitAsync(
  args: string[],
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<GitAsyncResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;

  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;

    const finish = (result: GitAsyncResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      finish({
        ok: false,
        stdout: Buffer.concat(stdout),
        stderr: error.message,
        exitCode: null,
        timedOut,
      });
    });

    child.on("close", (code) => {
      finish({
        ok: code === 0 && !timedOut,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
        exitCode: code,
        timedOut,
      });
    });
  });
}
