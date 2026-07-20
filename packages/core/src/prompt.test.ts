import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARNESSES,
  AgentInvocationError,
  MAX_AGENT_PROMPT_BYTES,
  buildAgentCommand,
  injectContractSection,
  renderAgentPrompt,
  type AgentId,
  type ApprovedContract,
} from "./index.js";

const contract: ApprovedContract = {
  schemaVersion: 1,
  id: "contract-1",
  task: "Keep changes inside checkout UI",
  createdAt: "2026-07-05T00:00:00.000Z",
  baseline: null,
  targetAgents: ["codex"],
  scope: {
    plannedPathPatterns: ["src/checkout/**"],
    forbiddenPathPatterns: ["src/auth/**"],
    allowAllPaths: false,
    readPathPatterns: [],
  },
  nodes: [],
  risks: [],
  tests: [{ type: "unit", command: "pnpm test", required: true }],
  assumptions: ["Payment API contract stays unchanged."],
  openQuestions: ["Should empty cart be handled in this slice?"],
};

describe("harness registry", () => {
  it("has adapters for every AgentId", () => {
    const ids: AgentId[] = ["claude", "codex", "cursor"];
    assert.deepEqual(
      ids.map((id) => HARNESSES[id].id),
      ids,
    );
  });
});

describe("prompt rendering", () => {
  for (const target of ["claude", "codex", "cursor"] as const) {
    it(`renders required sections for ${target}`, () => {
      const prompt = renderAgentPrompt(contract, target);

      assert.match(prompt, /## Task/);
      assert.match(prompt, /## Approved Scope/);
      assert.match(prompt, /src\/checkout\/\*\*/);
      assert.match(prompt, /Do NOT modify/);
      assert.match(prompt, /pnpm test/);
      assert.match(prompt, /check_drift/);
      assert.match(prompt, /stop to ask/);
    });
  }

  it("defaults to interactive capability wording when context is omitted (public compatibility)", () => {
    const prompt = renderAgentPrompt(contract, "codex");

    // Conditional, not a blanket promise: tests run "if available", and the
    // agent must hand exact commands to the user when execution is not.
    assert.match(prompt, /if (your harness (can|provides)|available)/i);
    assert.match(prompt, /give the user the exact command/i);
    // check_drift is only called if the ScopeLock MCP tool is present; the
    // CLI fallback must be named explicitly for when it isn't.
    assert.match(prompt, /check_drift/);
    assert.match(prompt, /scopelock check-drift/i);
    assert.match(prompt, /stop to ask/);
  });

  it("restricted-runner context never asks the agent to search for MCP or claim test execution", () => {
    const prompt = renderAgentPrompt(contract, "codex", {
      execution: "restricted-runner",
      finalDriftOwner: "runner",
      validationOwner: "runner",
    });

    // Must not instruct the agent to call check_drift or hunt for MCP.
    assert.doesNotMatch(prompt, /check_drift/);
    assert.doesNotMatch(prompt, /MCP/);
    // Must not claim the agent ran or will run tests itself.
    assert.doesNotMatch(prompt, /\bI (ran|executed|will run)\b/i);
    assert.doesNotMatch(prompt, /run the required tests/i);
    // Must state the runner owns authoritative validation/drift after the
    // command finishes.
    assert.match(prompt, /ScopeLock runner/);
    assert.match(prompt, /(after|once) this command finishes/i);
    assert.match(prompt, /(validation|scope|drift)/i);
    // Still requires approved scope discipline and writing/updating tests.
    assert.match(prompt, /approved scope/i);
    assert.match(prompt, /(write|update).*regression test/i);
  });
});

describe("agent invocation", () => {
  it("builds a shell-free Codex argv command", () => {
    assert.deepEqual(buildAgentCommand("codex", "do the task"), [
      "codex",
      "exec",
      "--sandbox",
      "workspace-write",
      "do the task",
    ]);
    assert.equal(
      buildAgentCommand("codex", "do the task").includes("--dangerously-bypass-approvals-and-sandbox"),
      false,
    );
    assert.deepEqual(
      buildAgentCommand("codex", "do the task", { executable: "/Applications/ChatGPT.app/Contents/Resources/codex" }).slice(0, 2),
      ["/Applications/ChatGPT.app/Contents/Resources/codex", "exec"],
    );
  });

  it("builds the live-verified restricted Claude argv command", () => {
    const command = buildAgentCommand("claude", "do the task");

    assert.deepEqual(command.slice(0, 2), ["claude", "-p"]);
    assert.equal(command.at(-1), "do the task");
    // `--disallowedTools` (like `--tools`/`--allowedTools`) is variadic in the
    // real Claude CLI: without a `--` terminator right before the prompt, it
    // greedily swallows the prompt text word-by-word as bogus deny rules and
    // claude never sees a positional prompt at all - reproduced live against
    // Claude Code 2.1.207 (`claude -p --disallowedTools Bash "some words"`
    // fails with "Input must be provided ... as a prompt argument"; adding
    // `--` before the prompt fixes it). This assertion is the regression test
    // for that failure mode, not just "the prompt is somewhere in the argv".
    assert.equal(command.at(-2), "--");
    assert.equal(command.includes("dontAsk"), true);
    assert.equal(command.includes("Bash"), true);
    assert.equal(command.includes("--dangerously-skip-permissions"), false);
  });

  it("requires isolation binding for Cursor write commands", () => {
    assert.throws(
      () => buildAgentCommand("cursor", "do the task"),
      (error: unknown) =>
        error instanceof AgentInvocationError && error.code === "UNSUPPORTED_TARGET",
    );
    const command = buildAgentCommand("cursor", "do the task", { isolationBound: true });
    assert.deepEqual(command.slice(0, 8), [
      "agent", "--print", "--output-format", "stream-json",
      "--sandbox", "enabled", "--trust", "--workspace",
    ]);
    assert.equal(command.at(-2), "--");
    assert.equal(command.at(-1), "do the task");
    assert.equal(command.includes("--force"), false);
    assert.equal(command.includes("--yolo"), false);
    assert.equal(command.includes("disabled"), false);
  });

  it("rejects prompts above the conservative argv limit", () => {
    assert.throws(
      () => buildAgentCommand("codex", "x".repeat(MAX_AGENT_PROMPT_BYTES + 1)),
      (error: unknown) =>
        error instanceof AgentInvocationError && error.code === "PROMPT_TOO_LARGE",
    );
  });
});

describe("AGENTS.md injection", () => {
  it("appends a marked section when missing", () => {
    const injected = injectContractSection("Existing rules\n", "ScopeLock rules");
    assert.equal(
      injected,
      "Existing rules\n\n<!-- SCOPELOCK CONTRACT BEGIN -->\nScopeLock rules\n<!-- SCOPELOCK CONTRACT END -->\n",
    );
  });

  it("preserves existing bytes outside markers when appending", () => {
    const existing = "Existing rules  \n\n";
    const injected = injectContractSection(existing, "ScopeLock rules");

    assert.equal(injected.startsWith(existing), true);
  });

  it("replaces only the marked section and is idempotent", () => {
    const existing = [
      "Before",
      "<!-- SCOPELOCK CONTRACT BEGIN -->",
      "Old",
      "<!-- SCOPELOCK CONTRACT END -->",
      "After",
      "",
    ].join("\n");
    const once = injectContractSection(existing, "New");
    const twice = injectContractSection(once, "New");

    assert.equal(once, twice);
    assert.equal(
      once,
      "Before\n<!-- SCOPELOCK CONTRACT BEGIN -->\nNew\n<!-- SCOPELOCK CONTRACT END -->\nAfter\n",
    );
  });
});
