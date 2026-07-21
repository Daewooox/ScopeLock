import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, type CommandResult } from "./run.js";

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
