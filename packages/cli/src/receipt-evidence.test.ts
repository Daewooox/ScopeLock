import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveEvidenceSummary, type EvidenceInput } from "./receipt-evidence.js";

function baseInput(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    taskStatuses: ["passed"],
    cycleCount: 0,
    blockedByEnvironment: false,
    driftStatus: "ok",
    isolationOutcomes: ["accepted-integration"],
    validationChecks: [{ id: "check-one", status: "passed", required: true }],
    acceptanceCheckIds: [],
    promotion: "applied",
    cleanup: "ok",
    ...overrides,
  };
}

describe("deriveEvidenceSummary", () => {
  it("reports completed/clear/passed for an all-green isolated run", () => {
    const summary = deriveEvidenceSummary(baseInput());
    assert.equal(summary.execution, "completed");
    assert.equal(summary.scope, "clear");
    assert.equal(summary.validation, "passed");
    assert.equal(summary.acceptance, "unverified");
    assert.equal(summary.promotion, "applied");
    assert.equal(summary.cleanup, "ok");
  });

  it("marks validation attention when only an optional check fails", () => {
    const summary = deriveEvidenceSummary(
      baseInput({
        validationChecks: [
          { id: "optional-check", status: "failed", required: false },
          { id: "required-check", status: "passed", required: true },
        ],
      }),
    );
    assert.equal(summary.validation, "attention");
  });

  it("marks validation failed when a required check fails", () => {
    const summary = deriveEvidenceSummary(
      baseInput({
        validationChecks: [
          { id: "required-check", status: "failed", required: true },
        ],
      }),
    );
    assert.equal(summary.validation, "failed");
  });

  it("marks validation failed when a required check was skipped", () => {
    const summary = deriveEvidenceSummary(
      baseInput({
        validationChecks: [
          { id: "required-check", status: "skipped", required: true },
        ],
      }),
    );
    assert.equal(summary.validation, "failed");
  });

  it("reports validation not-run when no candidate changes existed", () => {
    const summary = deriveEvidenceSummary(
      baseInput({
        validationChecks: [{
          id: "required-check",
          status: "skipped",
          required: true,
          skipReason: "no-candidate-changes",
        }],
        promotion: "no-changes",
      }),
    );
    assert.equal(summary.validation, "not-run");
  });

  it("fails closed for blocked validation checks", () => {
    assert.equal(
      deriveEvidenceSummary(baseInput({
        validationChecks: [{ id: "required-check", status: "blocked", required: true }],
      })).validation,
      "failed",
    );
    assert.equal(
      deriveEvidenceSummary(baseInput({
        validationChecks: [{ id: "optional-check", status: "blocked", required: false }],
      })).validation,
      "attention",
    );
  });

  it("reports acceptance unverified when no acceptance ids were declared", () => {
    const summary = deriveEvidenceSummary(baseInput({ acceptanceCheckIds: [] }));
    assert.equal(summary.acceptance, "unverified");
  });

  it("reports acceptance verified when every declared check passed", () => {
    const summary = deriveEvidenceSummary(
      baseInput({
        validationChecks: [{ id: "check-one", status: "passed", required: true }],
        acceptanceCheckIds: ["check-one"],
      }),
    );
    assert.equal(summary.acceptance, "verified");
  });

  it("reports acceptance failed when a declared acceptance check failed", () => {
    const summary = deriveEvidenceSummary(
      baseInput({
        validationChecks: [{ id: "check-one", status: "failed", required: true }],
        acceptanceCheckIds: ["check-one"],
      }),
    );
    assert.equal(summary.acceptance, "failed");
  });

  it("reports scope not-checked when drift was not checked", () => {
    const summary = deriveEvidenceSummary(baseInput({ driftStatus: "not_checked", isolationOutcomes: [] }));
    assert.equal(summary.scope, "not-checked");
  });

  it("reports scope violations for a rejected-scope isolation outcome", () => {
    const summary = deriveEvidenceSummary(
      baseInput({ driftStatus: "not_checked", isolationOutcomes: ["rejected-scope"] }),
    );
    assert.equal(summary.scope, "violations");
  });

  it("reports scope violations for drift violations even if isolation outcomes are clean", () => {
    const summary = deriveEvidenceSummary(baseInput({ driftStatus: "violations" }));
    assert.equal(summary.scope, "violations");
  });

  it("reports scope violations for a drift error", () => {
    const summary = deriveEvidenceSummary(baseInput({ driftStatus: "error" }));
    assert.equal(summary.scope, "violations");
  });

  it("passes through a cleanup warning unchanged", () => {
    const summary = deriveEvidenceSummary(baseInput({ cleanup: "warning" }));
    assert.equal(summary.cleanup, "warning");
  });

  it("passes through promotion states unchanged", () => {
    assert.equal(deriveEvidenceSummary(baseInput({ promotion: "no-changes" })).promotion, "no-changes");
    assert.equal(deriveEvidenceSummary(baseInput({ promotion: "blocked" })).promotion, "blocked");
    assert.equal(
      deriveEvidenceSummary(baseInput({ promotion: "not-applicable" })).promotion,
      "not-applicable",
    );
  });

  it("reports execution blocked when any task is blocked or skipped", () => {
    assert.equal(
      deriveEvidenceSummary(baseInput({ taskStatuses: ["passed", "blocked"] })).execution,
      "blocked",
    );
    assert.equal(
      deriveEvidenceSummary(baseInput({ taskStatuses: ["passed", "skipped"] })).execution,
      "blocked",
    );
  });

  it("reports execution attention when a task failed but none blocked/skipped", () => {
    assert.equal(
      deriveEvidenceSummary(baseInput({ taskStatuses: ["passed", "failed"] })).execution,
      "attention",
    );
  });

  it("reports execution blocked when scheduling cycles or the environment prevent dispatch", () => {
    assert.equal(
      deriveEvidenceSummary(baseInput({ taskStatuses: [], cycleCount: 1 })).execution,
      "blocked",
    );
    assert.equal(
      deriveEvidenceSummary(baseInput({ taskStatuses: [], blockedByEnvironment: true })).execution,
      "blocked",
    );
  });

  it("derives direct execution (no isolation) as not-run validation, unverified acceptance, not-applicable promotion/cleanup", () => {
    const summary = deriveEvidenceSummary({
      taskStatuses: ["passed"],
      cycleCount: 0,
      blockedByEnvironment: false,
      driftStatus: "ok",
      isolationOutcomes: [],
      validationChecks: [],
      acceptanceCheckIds: [],
      promotion: "not-applicable",
      cleanup: "not-applicable",
    });
    assert.equal(summary.execution, "completed");
    assert.equal(summary.scope, "clear");
    assert.equal(summary.validation, "not-run");
    assert.equal(summary.acceptance, "unverified");
    assert.equal(summary.promotion, "not-applicable");
    assert.equal(summary.cleanup, "not-applicable");
  });
});
