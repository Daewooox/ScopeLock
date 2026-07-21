import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EVIDENCE_GLOSSES,
  classifyEvidenceStatus,
  normalizeEvidenceStatus,
} from "./evidence-display.js";

describe("evidence display classification", () => {
  it("classifies good statuses", () => {
    for (const status of ["passed", "pass", "ok", "completed", "clear", "verified", "applied", "no-changes", "yes"]) {
      assert.equal(classifyEvidenceStatus(status), "good", status);
    }
  });

  it("classifies bad statuses", () => {
    for (const status of ["failed", "fail", "error", "violations", "blocked", "no"]) {
      assert.equal(classifyEvidenceStatus(status), "bad", status);
    }
  });

  it("classifies attention statuses and unknown strings", () => {
    for (const status of ["attention", "warning", "warn", "totally-new-status", ""]) {
      assert.equal(classifyEvidenceStatus(status), "attention", status);
    }
  });

  it("classifies not-exercised statuses in both spellings", () => {
    for (const status of [
      "not-applicable", "not_applicable",
      "not-checked", "not_checked",
      "not-run", "not_run",
      "unverified",
      "not-configured", "not_configured",
      "off",
      "skipped",
      "not-started", "not_started",
    ]) {
      assert.equal(classifyEvidenceStatus(status), "not-exercised", status);
    }
  });

  it("normalizes underscores to hyphens", () => {
    assert.equal(normalizeEvidenceStatus("not_applicable"), "not-applicable");
    assert.equal(normalizeEvidenceStatus("no-changes"), "no-changes");
  });

  it("has a non-empty gloss for every not-exercised status", () => {
    for (const status of ["not-applicable", "not-checked", "not-run", "unverified", "not-configured", "off", "skipped", "not-started"]) {
      const gloss = EVIDENCE_GLOSSES[status];
      assert.equal(typeof gloss, "string", status);
      assert.ok(gloss.length > 0, status);
    }
  });
});
