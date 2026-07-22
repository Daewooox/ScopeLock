// scripts/demo-vhs/smoke.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCommands, stripTrailingClear } from "./smoke.mjs";

describe("smoke", () => {
  it("extractCommands skips the first Type line and unescapes double-quoted strings", () => {
    const tape = [
      'Type "REPO=$(pwd); cd fixture; export PATH=\\"x:$PATH\\"; clear"',
      "Enter",
      'Type `scopelock task start "Add a dark mode toggle" --agent codex --allow src --yes`',
      "Enter",
      'Type "node $REPO/scripts/demo-vhs/write-guided-source.mjs; clear"',
      "Enter",
      'Type "scopelock task finish"',
      "Enter",
    ].join("\n");

    const commands = extractCommands(tape);
    assert.deepEqual(commands, [
      'scopelock task start "Add a dark mode toggle" --agent codex --allow src --yes',
      "node $REPO/scripts/demo-vhs/write-guided-source.mjs; clear",
      "scopelock task finish",
    ]);
  });

  it("stripTrailingClear removes a trailing '; clear' or '&& clear'", () => {
    assert.equal(stripTrailingClear("echo hi; clear"), "echo hi");
    assert.equal(stripTrailingClear("echo hi && clear"), "echo hi");
    assert.equal(stripTrailingClear("scopelock task finish"), "scopelock task finish");
  });
});
