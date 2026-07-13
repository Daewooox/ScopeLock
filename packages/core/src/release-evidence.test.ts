import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { releaseEvidenceSchema } from "./index.js";

const validEvidence = {
  schemaVersion: 1,
  version: "0.1.0-beta.1",
  commitSha: "a".repeat(40),
  generatedAt: "2026-07-13T00:00:00.000Z",
  packages: [
    {
      name: "@scopelock/core",
      version: "0.1.0-beta.1",
      filename: "scopelock-core-0.1.0-beta.1.tgz",
      sha256: "b".repeat(64),
      sizeBytes: 100,
      fileCount: 10,
    },
  ],
  ciRunUrl: null,
  installSmoke: { linux: "passed", macos: "pending", windows: "pending" },
  security: { codeql: "pending", gitleaks: "pending", dependencyAudit: "passed" },
  manualApproval: "pending",
  publication: "not-performed",
};

describe("release evidence schema", () => {
  it("accepts bounded evidence without claiming publication", () => {
    assert.deepEqual(releaseEvidenceSchema.parse(validEvidence), validEvidence);
  });

  it("rejects malformed digests and unsupported publication claims", () => {
    assert.equal(
      releaseEvidenceSchema.safeParse({ ...validEvidence, commitSha: "main" }).success,
      false,
    );
    assert.equal(
      releaseEvidenceSchema.safeParse({ ...validEvidence, publication: "published" }).success,
      false,
    );
    assert.equal(
      releaseEvidenceSchema.safeParse({
        ...validEvidence,
        packages: [{ ...validEvidence.packages[0], version: "0.2.0" }],
      }).success,
      false,
    );
  });
});
