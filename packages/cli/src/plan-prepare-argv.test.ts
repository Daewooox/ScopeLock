import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractPlanPrepareValidationArgv } from "./plan-prepare-argv.js";

describe("extractPlanPrepareValidationArgv", () => {
  it("preserves option-like child tokens (e.g. --frozen) byte-for-byte", () => {
    const argv = [
      "plan.json",
      "--target", "claude",
      "--out", "ready.json",
      "--validation-setup-command", "uv", "sync", "--frozen", "--group", "tests",
      "--validation-command", "uv", "run", "--frozen", "pytest",
    ];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.validationSetupCommand, ["uv", "sync", "--frozen", "--group", "tests"]);
    assert.deepEqual(result.validationCommand, ["uv", "run", "--frozen", "pytest"]);
    assert.deepEqual(result.rest, ["plan.json", "--target", "claude", "--out", "ready.json"]);
  });

  it("returns undefined for a flag that is not present", () => {
    const argv = ["plan.json", "--target", "codex", "--out", "ready.json"];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.equal(result.validationCommand, undefined);
    assert.equal(result.validationSetupCommand, undefined);
    assert.deepEqual(result.rest, argv);
  });

  it("handles a simple non-option-like validation command unchanged", () => {
    const argv = ["plan.json", "--target", "codex", "--out", "ready.json", "--validation-command", "npm", "run", "check"];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.validationCommand, ["npm", "run", "check"]);
    assert.deepEqual(result.rest, ["plan.json", "--target", "codex", "--out", "ready.json"]);
  });

  it("works when only --validation-setup-command is present", () => {
    const argv = ["plan.json", "--validation-setup-command", "uv", "sync", "--frozen", "--target", "codex"];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.validationSetupCommand, ["uv", "sync", "--frozen"]);
    assert.equal(result.validationCommand, undefined);
    assert.deepEqual(result.rest, ["plan.json", "--target", "codex"]);
  });

  it("treats an empty value list (flag immediately followed by another known flag) as absent", () => {
    const argv = ["plan.json", "--validation-command", "--target", "codex"];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.equal(result.validationCommand, undefined);
    assert.deepEqual(result.rest, ["plan.json", "--target", "codex"]);
  });
});
