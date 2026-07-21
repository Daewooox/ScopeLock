import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHuman } from "./sanitize.mjs";

describe("sanitizeHuman", () => {
  it("replaces the fixture repo's absolute path with a relative dot", () => {
    const human = "Ready plan written  /tmp/scopelock-demo-svg-abc123/ready.json";
    assert.equal(
      sanitizeHuman(human, "/tmp/scopelock-demo-svg-abc123"),
      "Ready plan written  ./ready.json",
    );
  });

  it("replaces a timestamped drift report filename with a fixed placeholder", () => {
    const human = "Drift report  ./.scopelock/reports/drift-2026-07-21T14-04-44.234Z.json";
    assert.equal(
      sanitizeHuman(human, "/tmp/anything"),
      "Drift report  ./.scopelock/reports/drift-demo.json",
    );
  });

  it("replaces a timestamped flight report HTML filename with a fixed placeholder", () => {
    const human = "Flight Report ./.scopelock/reports/drift-2026-07-21T14-04-44.234Z.html";
    assert.equal(
      sanitizeHuman(human, "/tmp/anything"),
      "Flight Report ./.scopelock/reports/drift-demo.html",
    );
  });

  it("is idempotent when run twice", () => {
    const human = "Ready plan written  /tmp/scopelock-demo-svg-abc123/ready.json\nDrift report  ./.scopelock/reports/drift-2026-07-21T14-04-44.234Z.json";
    const once = sanitizeHuman(human, "/tmp/scopelock-demo-svg-abc123");
    const twice = sanitizeHuman(once, "/tmp/scopelock-demo-svg-abc123");
    assert.equal(once, twice);
  });
});
