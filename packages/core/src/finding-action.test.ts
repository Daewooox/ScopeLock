import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findingActionSchema, resolveFindingAction } from "./index.js";

describe("finding action", () => {
  it("preserves supported actions", () => {
    assert.equal(resolveFindingAction("auto-fix"), "auto-fix");
    assert.equal(resolveFindingAction("ask-user"), "ask-user");
    assert.equal(resolveFindingAction("no-op"), "no-op");
  });

  it("fails closed to ask-user for absent, unknown, or malformed values", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "AUTO-FIX",
      "fix",
      {},
      [],
      1,
      true,
    ]) {
      assert.equal(resolveFindingAction(raw), "ask-user");
    }
  });

  it("parses supported schema values and catches everything else as ask-user", () => {
    assert.equal(findingActionSchema.parse("auto-fix"), "auto-fix");
    assert.equal(findingActionSchema.parse("ask-user"), "ask-user");
    assert.equal(findingActionSchema.parse("no-op"), "no-op");

    for (const raw of [undefined, null, "", "AUTO-FIX", {}, []]) {
      assert.equal(findingActionSchema.parse(raw), "ask-user");
    }
  });
});
