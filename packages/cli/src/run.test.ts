import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { decisionFor, hookDecisionFor } from "./decision-envelope.js";
import { CliError, run, type CommandResult } from "./run.js";

let previousStdinTty: boolean | undefined;
let previousStdoutTty: boolean | undefined;
let previousCi: string | undefined;
let previousExitCode: string | number | null | undefined;

beforeEach(() => {
  previousStdinTty = process.stdin.isTTY;
  previousStdoutTty = process.stdout.isTTY;
  previousCi = process.env.CI;
  previousExitCode = process.exitCode;
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: previousStdinTty, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: previousStdoutTty, configurable: true });
  if (previousCi === undefined) delete process.env.CI;
  else process.env.CI = previousCi;
  process.exitCode = previousExitCode;
});

function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
}

function okResult(suggestedNext?: CommandResult["suggestedNext"]): CommandResult {
  return { data: { ok: true }, human: "done", exitCode: 0, suggestedNext };
}

async function captureStdout(action: () => Promise<void>): Promise<string> {
  const write = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    await action();
    return output;
  } finally {
    process.stdout.write = write;
  }
}

describe("decision envelopes", () => {
  it("uses a stable mapped fix and a safe generic fallback", () => {
    assert.equal(
      decisionFor("denied", "SENSITIVE_ACCESS_DENIED", "finding").fix,
      "Remove or redesign the sensitive local-file read.",
    );
    assert.equal(
      decisionFor("blocked", "FUTURE_POLICY_CODE", "blocked").fix,
      "Review the policy decision and correct the underlying issue before retrying.",
    );
  });

  it("classifies hook path denials and fail-closed gate blocks without renaming reasons", () => {
    for (const [reason, status, code] of [
      ["forbidden", "denied", "HOOK_FORBIDDEN_PATH"],
      ["outside", "denied", "HOOK_OUTSIDE_SCOPE"],
      ["self-protected", "denied", "HOOK_SELF_PROTECTED"],
      ["approval-integrity", "blocked", "HOOK_APPROVAL_INTEGRITY"],
      ["symlink-escape", "blocked", "HOOK_SYMLINK_ESCAPE"],
      ["config-error", "blocked", "HOOK_CONFIG_ERROR"],
      ["gate-error", "blocked", "HOOK_GATE_ERROR"],
    ]) {
      const decision = hookDecisionFor(reason, "MindTheDiff: denied");
      assert.equal(decision.status, status);
      assert.equal(decision.code, code);
    }
  });

  it("adds a decision to JSON while preserving data and escaping control characters", async () => {
    const output = await captureStdout(() => run(
      async () => ({
        data: { existing: true },
        human: null,
        exitCode: 1 as const,
        decision: decisionFor("denied", "SCOPE_DRIFT_VIOLATIONS", "outside scope\u0007"),
      }),
      { json: true },
    ));
    assert.doesNotThrow(() => JSON.parse(output));
    assert.deepEqual(JSON.parse(output), {
      status: "violations",
      data: { existing: true },
      decision: {
        status: "denied",
        code: "SCOPE_DRIFT_VIOLATIONS",
        reason: "outside scope\u0007",
        fix: "Review the drift report and revert or approve the unexpected changes.",
      },
    });
    assert.equal(process.exitCode, 1);
  });

  it("renders a control-safe human decision", async () => {
    const output = await captureStdout(() => run(
      async () => ({
        data: {},
        human: "existing output",
        exitCode: 1 as const,
        decision: decisionFor("blocked", "FUTURE_POLICY_CODE", "blocked\u0007 here"),
      }),
      { json: false },
    ));
    assert.match(output, /existing output\n\nBLOCKED \[FUTURE_POLICY_CODE\]: blocked here/u);
    assert.doesNotMatch(output, /\u0007/u);
  });

  it("does not append human decision text to a command's JSON mode", async () => {
    const output = await captureStdout(() => run(
      async () => ({
        data: {},
        human: JSON.stringify({ existing: true, decision: { code: "FUTURE_POLICY_CODE" } }),
        humanIsJson: true,
        exitCode: 1 as const,
        decision: decisionFor("blocked", "FUTURE_POLICY_CODE", "blocked"),
      }),
      { json: false },
    ));
    assert.deepEqual(JSON.parse(output), { existing: true, decision: { code: "FUTURE_POLICY_CODE" } });
  });

  it("keeps operational error JSON unchanged", async () => {
    const output = await captureStdout(() => run(
      async () => { throw new CliError("INVALID_INPUT", "bad input"); },
      { json: true },
    ));
    assert.deepEqual(JSON.parse(output), {
      status: "error",
      error: { code: "INVALID_INPUT", message: "bad input" },
    });
    assert.equal(process.exitCode, 2);
  });
});

describe("run() suggested-next-command prompt", () => {
  it("spawns the suggested command when the TTY confirm accepts", async () => {
    setTty(true);
    delete process.env.CI;
    const spawnCalls: string[][] = [];
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => true,
        spawnNext: async (argv) => {
          spawnCalls.push(argv);
          return 1;
        },
      },
    );
    assert.deepEqual(spawnCalls, [["check-drift"]]);
    assert.equal(process.exitCode, 1);
  });

  it("does not spawn and keeps the original exit code when declined", async () => {
    setTty(true);
    delete process.env.CI;
    let spawned = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => false,
        spawnNext: async () => {
          spawned = true;
          return 0;
        },
      },
    );
    assert.equal(spawned, false);
    assert.equal(process.exitCode, 0);
  });

  it("never offers the prompt under --json, even with suggestedNext present", async () => {
    setTty(true);
    delete process.env.CI;
    let confirmCalled = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: true },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });

  it("never offers the prompt outside a real TTY", async () => {
    setTty(false);
    delete process.env.CI;
    let confirmCalled = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });

  it("never offers the prompt when CI=true", async () => {
    setTty(true);
    process.env.CI = "true";
    let confirmCalled = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });

  it("falls back to the original exit code when confirm throws (SIGINT/cancellation)", async () => {
    setTty(true);
    delete process.env.CI;
    let spawned = false;
    await run(
      async () => okResult({ label: "Verify current changes", argv: ["check-drift"] }),
      { json: false },
      {
        confirm: async () => {
          throw new Error("cancelled");
        },
        spawnNext: async () => {
          spawned = true;
          return 0;
        },
      },
    );
    assert.equal(spawned, false);
    assert.equal(process.exitCode, 0);
  });

  it("skips the prompt entirely when suggestedNext is absent, matching today's behavior", async () => {
    setTty(true);
    delete process.env.CI;
    let confirmCalled = false;
    await run(
      async () => okResult(undefined),
      { json: false },
      {
        confirm: async () => {
          confirmCalled = true;
          return true;
        },
      },
    );
    assert.equal(confirmCalled, false);
    assert.equal(process.exitCode, 0);
  });
});
