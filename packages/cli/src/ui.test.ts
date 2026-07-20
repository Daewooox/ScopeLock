import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderStatusTable } from "./ui.js";

describe("renderStatusTable", () => {
  it("dims a passing row's cells and adds no reason line", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "a", status: "pass", cells: ["12.4s"] },
    ]);
    const lines = output.split("\n");
    assert.equal(lines.length, 2); // header + one row, no reason sub-line
    assert.match(lines[1] ?? "", /a/);
  });

  it("keeps a failing row at full brightness and adds a truncated reason sub-line", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "b", status: "fail", cells: ["3.1s"], reason: "assertion failed: expected true, got false" },
    ]);
    const lines = output.split("\n");
    assert.equal(lines.length, 3); // header + row + reason sub-line
    assert.match(lines[2] ?? "", /↳ assertion failed: expected true, got false/);
  });

  it("truncates a long reason and appends the full-log path when present", () => {
    const longReason = "x".repeat(150);
    const output = renderStatusTable("Task", ["Time"], [
      { id: "c", status: "warn", cells: ["1.0s"], reason: longReason, logPath: "/tmp/artifact.txt" },
    ]);
    const reasonLine = output.split("\n")[2] ?? "";
    assert.match(reasonLine, /…/);
    assert.match(reasonLine, /\(full log: \/tmp\/artifact\.txt\)/);
    assert.ok(!reasonLine.includes("x".repeat(150)), "reason should be truncated, not shown in full");
  });

  it("truncates reasons by Unicode code point without splitting a surrogate pair", () => {
    const reason = `${"x".repeat(99)}🙂${"y".repeat(20)}`;
    const output = renderStatusTable("Task", ["Time"], [
      { id: "unicode", status: "fail", cells: ["1.0s"], reason },
    ]);
    const reasonLine = output.split("\n")[2] ?? "";
    assert.match(reasonLine, new RegExp(`${"x".repeat(99)}🙂…$`, "u"));
  });

  it("collapses multiline failure evidence into one stable table line", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "multiline", status: "fail", cells: ["1.0s"], reason: "first\r\nsecond\tthird" },
    ]);
    const lines = output.split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[2] ?? "", /↳ first second third$/);
  });

  it("removes terminal controls from failure evidence", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "control", status: "fail", cells: ["1.0s"], reason: "failure\u001b[2J\u0007" },
    ]);
    assert.doesNotMatch(output, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);
  });

  it("shows a skip reason even though skip is not fail/warn", () => {
    const output = renderStatusTable("Check", ["Time"], [
      { id: "analyze", status: "skip", cells: ["0.0s"], reason: "an earlier required check failed" },
    ]);
    const lines = output.split("\n");
    assert.equal(lines.length, 3);
    assert.match(lines[2] ?? "", /↳ an earlier required check failed/);
  });

  it("aligns columns by the widest cell in each column, including the id column", () => {
    const output = renderStatusTable("Task", ["Time"], [
      { id: "short", status: "pass", cells: ["1s"] },
      { id: "a-much-longer-task-id", status: "pass", cells: ["2s"] },
    ]);
    const lines = output.split("\n");
    const headerIdColumnWidth = (lines[0] ?? "").indexOf("Status");
    assert.ok(headerIdColumnWidth >= "a-much-longer-task-id".length);
  });
});
