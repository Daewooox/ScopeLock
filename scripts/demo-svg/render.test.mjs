import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ansiToSpans, renderTerminalSvg } from "./render.mjs";

describe("ansiToSpans", () => {
  it("splits a plain line into one span with the default fill", () => {
    assert.deepEqual(ansiToSpans("Cleared"), [{ text: "Cleared", fill: "#e6edf3", bold: false }]);
  });

  it("maps green (32) to the pass color and resets after 0", () => {
    assert.deepEqual(
      ansiToSpans("[32mPASS[0m found"),
      [
        { text: "PASS", fill: "#7ee787", bold: false },
        { text: " found", fill: "#e6edf3", bold: false },
      ],
    );
  });

  it("maps yellow (33) to the warn color and red (31) to the fail color", () => {
    assert.deepEqual(ansiToSpans("[33mWARN[0m"), [{ text: "WARN", fill: "#e3b341", bold: false }]);
    assert.deepEqual(ansiToSpans("[31mFAIL[0m"), [{ text: "FAIL", fill: "#ff7b72", bold: false }]);
  });

  it("treats bold (1) as a weight flag that keeps the current fill", () => {
    assert.deepEqual(
      ansiToSpans("[36m[1mChecks[0m"),
      [{ text: "Checks", fill: "#79c0ff", bold: true }],
    );
  });
});

describe("renderTerminalSvg", () => {
  it("produces valid SVG containing every scene's real text and a reduced-motion rule", () => {
    const svg = renderTerminalSvg({
      title: "Test demo",
      description: "A test description",
      promptPrefix: "$ scopelock",
      scenes: [
        { prompt: "task start \"Demo\" --agent codex", pendingLabel: "Describe and scope the task", human: "Context\n  Task boundary  demo-task\n\nResult\n  Approved" },
      ],
    });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>$/);
    assert.match(svg, /Approved/);
    assert.match(svg, /prefers-reduced-motion:reduce/);
    assert.match(svg, /task start &quot;Demo&quot; --agent codex/);
  });

  it("computes a taller canvas for scenes with more content lines", () => {
    const short = renderTerminalSvg({
      title: "t", description: "d", promptPrefix: "$",
      scenes: [{ prompt: "a", pendingLabel: "p", human: "one line" }],
    });
    const long = renderTerminalSvg({
      title: "t", description: "d", promptPrefix: "$",
      scenes: [{ prompt: "a", pendingLabel: "p", human: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n") }],
    });
    const heightOf = (svg) => Number(/height="(\d+)"/.exec(svg)[1]);
    assert.ok(heightOf(long) > heightOf(short));
  });
});
