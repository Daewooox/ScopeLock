import { spawn, type ChildProcess } from "node:child_process";
import type { CommandSpec } from "@scopelock/core";

export type TerminationReason = "timeout" | "sigint" | "sigterm" | "second-signal";

export type ProcessTermination = {
  reason: TerminationReason | null;
  requestedSignal: NodeJS.Signals | null;
  escalated: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export type ProcessTreeHandle = {
  readonly child: ChildProcess;
  terminate(reason: Exclude<TerminationReason, "second-signal">): void;
  forceTerminate(): void;
  wait(): Promise<ProcessTermination>;
};

export type RunSignalCoordinator = {
  readonly signal: AbortSignal;
  register(tree: ProcessTreeHandle): () => void;
  dispose(): void;
};

type SpawnProcessTreeInput = {
  command: CommandSpec;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  gracefulTimeoutMs: number;
};

function signalFor(reason: Exclude<TerminationReason, "second-signal">): NodeJS.Signals {
  return reason === "sigint" ? "SIGINT" : "SIGTERM";
}

function killUnixGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

type TaskkillChild = {
  on(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};

type TaskkillSpawner = (
  command: string,
  args: string[],
  options: { shell: false; stdio: "ignore"; windowsHide: true },
) => TaskkillChild;

export function launchWindowsTaskkill(
  pid: number,
  spawnTaskkill: TaskkillSpawner = (command, args, options) => spawn(command, args, options),
): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const killer = spawnTaskkill("taskkill", ["/PID", String(pid), "/T", "/F"], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  killer.on("error", () => {});
  killer.unref();
}

export function spawnProcessTree(input: SpawnProcessTreeInput): ProcessTreeHandle {
  if (!Number.isSafeInteger(input.gracefulTimeoutMs) || input.gracefulTimeoutMs < 0) {
    throw new TypeError("gracefulTimeoutMs must be a non-negative integer");
  }
  const command = input.command;
  const child = Array.isArray(command)
    ? spawn(command[0] as string, command.slice(1), {
        cwd: input.cwd,
        env: input.env,
        detached: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn(command, [], {
        cwd: input.cwd,
        env: input.env,
        detached: true,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

  let reason: TerminationReason | null = null;
  let requestedSignal: NodeJS.Signals | null = null;
  let escalated = false;
  let closed = false;
  let escalationTimer: NodeJS.Timeout | null = null;

  const forceTerminate = () => {
    if (closed || child.pid === undefined) return;
    reason ??= "second-signal";
    requestedSignal ??= "SIGTERM";
    escalated = true;
    if (process.platform === "win32") launchWindowsTaskkill(child.pid);
    else killUnixGroup(child.pid, "SIGKILL");
  };

  const terminate = (nextReason: Exclude<TerminationReason, "second-signal">) => {
    if (closed || reason !== null || child.pid === undefined) return;
    reason = nextReason;
    requestedSignal = signalFor(nextReason);
    if (process.platform === "win32") {
      escalated = true;
      launchWindowsTaskkill(child.pid);
    } else {
      killUnixGroup(child.pid, requestedSignal);
    }
    escalationTimer = setTimeout(forceTerminate, input.gracefulTimeoutMs);
    escalationTimer.unref();
  };

  const result = new Promise<ProcessTermination>((resolve) => {
    const settle = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (closed) return;
      closed = true;
      if (escalationTimer !== null) clearTimeout(escalationTimer);
      resolve({ reason, requestedSignal, escalated, exitCode, signal });
    };
    child.once("close", (exitCode, signal) => {
      settle(exitCode, signal);
    });
    child.once("error", () => {
      settle(null, null);
    });
  });

  return {
    child,
    terminate,
    forceTerminate,
    wait: () => result,
  };
}

export function createRunSignalCoordinator(): RunSignalCoordinator {
  const controller = new AbortController();
  const active = new Set<ProcessTreeHandle>();
  let signalsSeen = 0;

  const terminate = (signal: "SIGINT" | "SIGTERM") => {
    signalsSeen += 1;
    if (signalsSeen === 1) {
      controller.abort(signal);
      const reason = signal === "SIGINT" ? "sigint" : "sigterm";
      for (const tree of active) tree.terminate(reason);
    } else {
      for (const tree of active) tree.forceTerminate();
    }
  };
  const onSigint = () => terminate("SIGINT");
  const onSigterm = () => terminate("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return {
    signal: controller.signal,
    register(tree) {
      active.add(tree);
      if (controller.signal.aborted) {
        const reason = controller.signal.reason === "SIGINT" ? "sigint" : "sigterm";
        tree.terminate(reason);
      }
      return () => active.delete(tree);
    },
    dispose() {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      active.clear();
    },
  };
}
