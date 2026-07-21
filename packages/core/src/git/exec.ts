import { spawn, spawnSync } from "node:child_process";

const safeGitCommands = new Map(
  [
    "add",
    "cat-file",
    "check-ref-format",
    "commit",
    "diff",
    "fetch",
    "ls-files",
    "ls-tree",
    "remote",
    "rev-list",
    "rev-parse",
    "show",
    "status",
    "worktree",
  ].map((command) => [command, command]),
);

const safeGitOptionsByCommand = new Map(
  Object.entries({
    add: ["-A", "-N"],
    "cat-file": ["-e"],
    commit: ["-qm"],
    diff: ["--find-renames", "--name-status", "--no-abbrev", "--numstat", "--raw", "-C", "-M", "-z"],
    fetch: ["--no-tags"],
    "ls-files": ["-z"],
    "ls-tree": ["--name-only"],
    "rev-list": ["--max-count=20"],
    "rev-parse": ["--abbrev-ref", "--git-common-dir", "--git-dir", "--show-toplevel", "--verify"],
    status: ["--porcelain=v2", "--renames", "--untracked-files=all", "-z"],
    worktree: ["--detach", "--force", "--porcelain"],
  }).map(([command, options]) => [
    command,
    new Map(options.map((option) => [option, option])),
  ]),
);

const safeGitGlobalOptions = new Map(
  ["--version", "-c"].map((option) => [option, option]),
);

const safeInlineGitConfigs = new Map(
  [
    "user.name=ScopeLock",
    "user.email=scopelock@localhost",
  ].map((config) => [config, config]),
);

function sanitizeGitArguments(args: string[]): { args: string[] } | { error: string } {
  const sanitized: string[] = [];
  let expectsConfig = false;
  let commandSeen = false;
  let optionsEnded = false;
  let versionRequested = false;
  let currentCommand: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (expectsConfig) {
      const config = safeInlineGitConfigs.get(argument);
      if (config === undefined) return { error: `unsafe git config at argument ${index}` };
      sanitized.push(config);
      expectsConfig = false;
      continue;
    }

    if (/^ext::/iu.test(argument)) {
      return { error: `unsafe git argument at index ${index}` };
    }
    if (optionsEnded) {
      if (argument.startsWith("--")) {
        return { error: `unsafe git argument at index ${index}` };
      }
      sanitized.push(argument);
      continue;
    }
    if (argument === "--") {
      if (!commandSeen) return { error: `unsafe git argument at index ${index}` };
      sanitized.push("--");
      optionsEnded = true;
      continue;
    }

    if (!commandSeen) {
      if (argument.startsWith("--")) {
        const option = safeGitGlobalOptions.get(argument);
        if (option === undefined) return { error: `unsafe git argument at index ${index}` };
        sanitized.push(option);
        versionRequested = option === "--version";
        continue;
      }
      if (argument.startsWith("-")) {
        const option = safeGitGlobalOptions.get(argument);
        if (option === undefined) return { error: `unsafe git argument at index ${index}` };
        sanitized.push(option);
        expectsConfig = option === "-c";
        continue;
      }
      const command = safeGitCommands.get(argument);
      if (command === undefined) return { error: `unsafe git command at index ${index}` };
      if (command === "fetch") {
        sanitized.push(
          "-c",
          "core.sshCommand=ssh",
          "-c",
          "core.askPass=",
          "-c",
          "credential.helper=",
          "-c",
          "core.gitProxy=",
        );
      }
      sanitized.push(command);
      if (command === "fetch") sanitized.push("--upload-pack=git-upload-pack");
      commandSeen = true;
      currentCommand = command;
      continue;
    }

    if (argument.startsWith("--")) {
      const option = safeGitOptionsByCommand.get(currentCommand ?? "")?.get(argument);
      if (option === undefined) return { error: `unsafe git argument at index ${index}` };
      sanitized.push(option);
      continue;
    }
    if (argument.startsWith("-")) {
      const option = safeGitOptionsByCommand.get(currentCommand ?? "")?.get(argument);
      if (option === undefined) return { error: `unsafe git argument at index ${index}` };
      sanitized.push(option);
      continue;
    }
    sanitized.push(argument);
  }

  if (expectsConfig) return { error: "unsafe git config: missing value after -c" };
  if (!commandSeen && !versionRequested) return { error: "unsafe git command: missing command" };
  return { args: sanitized };
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GIT_ASKPASS",
    "GIT_EXEC_PATH",
    "GIT_PROXY_COMMAND",
    "GIT_SSH",
    "SSH_ASKPASS",
  ]) {
    delete env[name];
  }
  env.GIT_ALLOW_PROTOCOL = "file:git:http:https:ssh";
  env.GIT_SSH_COMMAND = "ssh";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

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
  const sanitized = sanitizeGitArguments(args);
  if ("error" in sanitized) {
    return { ok: false, stdout: "", stderr: sanitized.error };
  }
  const result = spawnSync("git", sanitized.args, {
    cwd,
    encoding: "utf8",
    env: gitEnvironment(),
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
  const sanitized = sanitizeGitArguments(args);
  if ("error" in sanitized) {
    return Promise.resolve({
      ok: false,
      stdout: Buffer.alloc(0),
      stderr: sanitized.error,
      exitCode: null,
      timedOut: false,
    });
  }

  return new Promise((resolve) => {
    const child = spawn("git", sanitized.args, {
      cwd,
      env: gitEnvironment(),
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
