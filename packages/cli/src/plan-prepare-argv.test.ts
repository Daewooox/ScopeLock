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
      "--validation-cwd", "app",
      "--validation-command", "uv", "run", "--frozen", "pytest",
    ];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.validationSetupCommand, ["uv", "sync", "--frozen", "--group", "tests"]);
    assert.deepEqual(result.validationCommand, ["uv", "run", "--frozen", "pytest"]);
    assert.deepEqual(result.rest, [
      "plan.json", "--target", "claude", "--out", "ready.json", "--validation-cwd", "app",
    ]);
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

  it("collects repeated --validation-check occurrences into {id, command} entries", () => {
    const argv = [
      "plan.json",
      "--target", "claude",
      "--out", "ready-plan.json",
      "--validation-cwd", "app",
      "--validation-check", "widget-tests", "flutter", "test", "test/widgets/async_submit_test.dart",
      "--validation-check", "analyze", "flutter", "analyze",
      "--acceptance-check", "widget-tests",
      "--acceptance-check", "analyze",
    ];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.validationChecks, [
      { id: "widget-tests", command: ["flutter", "test", "test/widgets/async_submit_test.dart"] },
      { id: "analyze", command: ["flutter", "analyze"] },
    ]);
    assert.deepEqual(result.acceptanceChecks, ["widget-tests", "analyze"]);
    assert.deepEqual(result.rest, [
      "plan.json", "--target", "claude", "--out", "ready-plan.json", "--validation-cwd", "app",
    ]);
  });

  it("preserves option-like child argv (e.g. --fatal-infos, --coverage) inside a --validation-check byte-for-byte", () => {
    const argv = [
      "plan.json",
      "--validation-check", "analyze", "flutter", "analyze", "--fatal-infos", "--coverage",
      "--target", "claude",
    ];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.validationChecks, [
      { id: "analyze", command: ["flutter", "analyze", "--fatal-infos", "--coverage"] },
    ]);
    assert.deepEqual(result.rest, ["plan.json", "--target", "claude"]);
  });

  it("throws when --validation-check is missing both id and command", () => {
    const argv = ["plan.json", "--validation-check", "--target", "claude"];
    assert.throws(() => extractPlanPrepareValidationArgv(argv), /--validation-check requires an id/);
  });

  it("throws when --validation-check has an id but no command", () => {
    const argv = ["plan.json", "--validation-check", "widget-tests", "--target", "claude"];
    assert.throws(() => extractPlanPrepareValidationArgv(argv), /--validation-check requires an id/);
  });

  it("does not reject duplicate --validation-check ids (that is a schema-level concern)", () => {
    const argv = [
      "plan.json",
      "--validation-check", "analyze", "flutter", "analyze",
      "--validation-check", "analyze", "flutter", "test",
    ];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.validationChecks, [
      { id: "analyze", command: ["flutter", "analyze"] },
      { id: "analyze", command: ["flutter", "test"] },
    ]);
  });

  it("collects repeated --acceptance-check ids, duplicates included, without duplicate detection", () => {
    const argv = [
      "plan.json",
      "--acceptance-check", "analyze",
      "--acceptance-check", "analyze",
      "--target", "claude",
    ];
    const result = extractPlanPrepareValidationArgv(argv);
    assert.deepEqual(result.acceptanceChecks, ["analyze", "analyze"]);
    assert.deepEqual(result.rest, ["plan.json", "--target", "claude"]);
  });

  it("throws when --acceptance-check is missing its id", () => {
    const argv = ["plan.json", "--acceptance-check", "--target", "claude"];
    assert.throws(() => extractPlanPrepareValidationArgv(argv), /--acceptance-check requires exactly one id/);
  });

  it("rejects mixing legacy --validation-command with new --validation-check", () => {
    const argv = [
      "plan.json",
      "--validation-command", "npm", "run", "check",
      "--validation-check", "analyze", "flutter", "analyze",
    ];
    assert.throws(
      () => extractPlanPrepareValidationArgv(argv),
      /--validation-command is a legacy alias.*cannot be combined with --validation-check/,
    );
  });
});
