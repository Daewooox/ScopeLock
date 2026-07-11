import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARNESSES,
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
