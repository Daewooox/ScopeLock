# Real terminal-capture pipeline for the README hero SVGs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two hand-authored, stale README hero SVGs with ones generated from real ScopeLock CLI output, plus a `pnpm demo:svg` regeneration script and a CI check that fails when the committed SVGs drift from what the CLI actually produces.

**Architecture:** `scripts/demo-svg/capture.mjs` forces `process.stdout.isTTY = true` before importing `@scopelock/cli`'s command modules (so `packages/cli/src/ui.ts`'s module-load-time `supportsColor` picks up real ANSI colors), then drives `taskStartCommand`/`taskFinishCommand`/`planPrepareCommand` in-process against throwaway git fixtures, capturing each command's real `ProgressEvent` sequence and real (colored) `CommandResult.human` text. `scripts/demo-svg/sanitize.mjs` strips non-deterministic absolute paths and timestamps from that captured text. `scripts/demo-svg/render.mjs` maps the 7 known ANSI SGR codes to fixed SVG colors and lays out one animated "scene" per captured command (a pending sub-frame showing real step/phase labels, settling into the real colored output), with canvas height computed from actual content length so nothing is truncated. `scripts/demo-svg/generate.mjs` orchestrates the two demo scenarios and writes `docs/assets/scopelock-demo.svg` / `scopelock-plan-demo.svg`, with a `--check` mode for CI.

**Tech Stack:** Plain Node.js (`.mjs`, no build step, no new dependencies), Node's built-in test runner, the existing `@scopelock/cli` built command functions and `ui.ts` color codes.

## Global Constraints

- Zero new runtime or dev dependencies — everything is built from `node:*` builtins plus the already-built `@scopelock/cli`/`@scopelock/core` packages.
- The default (no-flag) capture/render/generate pipeline is POSIX-only (uses a fake-`codex`-executable-on-`PATH` technique that only needs a `#!/bin/sh` shim) — this is a deliberate, documented scope cut: `pnpm demo:svg` is a maintainer-invoked authoring tool, and the CI staleness check (Task 4) only needs to run on `ubuntu-latest`, not the full Windows/macOS/Linux matrix.
- The Guided scenario (`docs/assets/scopelock-demo.svg`) covers `task start` + `task finish` only — no `scopelock setup` (confirmed with maintainer: `setup` is untouched by the terminal UX work and adds length without adding anything new to show).
- The Standard scenario (`docs/assets/scopelock-plan-demo.svg`) covers `plan prepare` only, targeting two contracts with disjoint planned scopes and a read dependency between them (same writer/reader shape already used in `packages/cli/src/cli.test.ts`'s `run` describe block) — this naturally produces one real `WARN` ("Scope overlaps... ordered safely") alongside passing rows, a genuine (not fabricated) demonstration of the failure-first table's warning treatment.
- Every string that ends up in a generated SVG must come from real captured CLI output, run through `sanitize.mjs` — never hand-typed content standing in for real output.
- Regenerating twice in a row must produce byte-identical SVG files (this is what makes the CI check trustworthy).
- SVG canvas width matches the existing convention (960px content area); height is computed from actual content, not a fixed guess — the README `<img>` tags only set `width="900"`, no `height`, so a taller SVG scales proportionally with no layout change needed.
- ANSI color → SVG color mapping (fixed, from `packages/cli/src/ui.ts`'s `codes`): SGR `32` (green/pass) → `#7ee787`, SGR `33` (yellow/warn) → `#e3b341`, SGR `31` (red/fail) → `#ff7b72`, SGR `36` (cyan/section title) → `#79c0ff`, SGR `2` (dim) → `#8b949e`, SGR `1` (bold) → same fill, `font-weight:700`, SGR `0` (reset) → `#e6edf3` (matches the existing SVGs' `.text`/`.muted`/`.blue`/`.green`/`.amber` palette, plus one new red for the failure-first WARN/FAIL treatment the old SVGs never needed to show).

---

### Task 1: `capture.mjs` — real in-process CLI capture with forced TTY color

**Files:**
- Create: `scripts/demo-svg/capture.mjs`
- Test: `scripts/demo-svg/capture.test.mjs`

**Interfaces:**
- Consumes: `taskStartCommand`, `taskFinishCommand`, `planPrepareCommand` from `@scopelock/cli`'s built `dist/commands/*.js` (resolved via the pnpm workspace symlink — `@scopelock/cli` has no `exports` field restricting subpath access, the same way `packages/cli/src/cli.test.ts` reaches these from inside the package).
- Produces:
  - `export function forceTtyColor()` — call once, before any `@scopelock/cli` import, in every entrypoint script.
  - `export function recordingReporter(): { reporter: { emit(event): void; dispose(): void }, events: object[] }`.
  - `export function initFixtureRepo(): string` — creates and git-inits a temp dir, returns its absolute path.
  - `export function cleanupFixtureRepo(dir: string): void`.
  - `export function fakeCodexOnPath(dir: string): NodeJS.ProcessEnv` — returns a `process.env`-shaped object with `PATH` prepended with a directory containing a fake executable `codex`, so `findAgentExecutable("codex")` (used internally by `planPrepareCommand`/`taskStartCommand`) reports it as found.
  - `export function approveContract(dir: string, cliPath: string, env: NodeJS.ProcessEnv, id: string, planned: string[], read?: string[]): void` — spawns the built CLI's `contract new`/`contract approve` (mirroring `packages/cli/src/cli.test.ts`'s `writeContract` helper), writing an approved contract at `.scopelock/contracts/<id>.json`.
  - `export const cliBinPath: string` — absolute path to `packages/cli/dist/index.js`, computed from `import.meta.url`.
  - Task 3 (`generate.mjs`) imports all of the above and calls `taskStartCommand`/`taskFinishCommand`/`planPrepareCommand` directly, passing `recordingReporter().reporter` as their `reporter` option.

#### Step 1: Write the failing tests

Create `scripts/demo-svg/capture.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forceTtyColor,
  recordingReporter,
  initFixtureRepo,
  cleanupFixtureRepo,
  fakeCodexOnPath,
  approveContract,
  cliBinPath,
} from "./capture.mjs";

describe("capture", () => {
  it("forces stdout.isTTY to true", () => {
    forceTtyColor();
    assert.equal(process.stdout.isTTY, true);
  });

  it("recordingReporter records emitted events and dispose calls", () => {
    const recording = recordingReporter();
    recording.reporter.emit({ type: "phase", name: "scheduling" });
    recording.reporter.dispose();
    assert.deepEqual(recording.events, [{ type: "phase", name: "scheduling" }]);
  });

  it("initFixtureRepo creates a git-initialized directory", () => {
    const dir = initFixtureRepo();
    try {
      assert.equal(existsSync(join(dir, ".git")), true);
    } finally {
      cleanupFixtureRepo(dir);
    }
    assert.equal(existsSync(dir), false);
  });

  it("fakeCodexOnPath puts a resolvable codex executable on PATH", () => {
    const dir = initFixtureRepo();
    try {
      const env = fakeCodexOnPath(dir);
      const paths = env.PATH.split(":");
      const found = paths.some((p) => existsSync(join(p, "codex")));
      assert.equal(found, true);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("approveContract writes an approved contract file with a baseline", () => {
    const dir = initFixtureRepo();
    try {
      const env = fakeCodexOnPath(dir);
      approveContract(dir, cliBinPath, env, "demo-a", ["src/a.js"]);
      const contract = JSON.parse(
        readFileSync(join(dir, ".scopelock/contracts/demo-a.json"), "utf8"),
      );
      assert.equal(contract.id, "demo-a");
      assert.notEqual(contract.baseline, null);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });
});
```

#### Step 2: Run the tests to verify they fail

Run: `node --test scripts/demo-svg/capture.test.mjs`
Expected: FAIL — `Cannot find module './capture.mjs'` (the file doesn't exist yet).

#### Step 3: Implement `capture.mjs`

Create `scripts/demo-svg/capture.mjs`:

```js
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
export const cliBinPath = join(repoRoot, "packages/cli/dist/index.js");

export function forceTtyColor() {
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
}

export function recordingReporter() {
  const events = [];
  return {
    events,
    reporter: {
      emit(event) {
        events.push(event);
      },
      dispose() {},
    },
  };
}

export function initFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "scopelock-demo-svg-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "demo@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "ScopeLock Demo"], { cwd: dir });
  spawnSync("git", ["commit", "--allow-empty", "-qm", "init"], { cwd: dir });
  return dir;
}

export function cleanupFixtureRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export function fakeCodexOnPath(dir) {
  const bin = join(dir, ".demo-fake-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "fake-codex.cjs");
  const executable = join(bin, "codex");
  writeFileSync(script, "require('node:fs').writeFileSync('a.txt', 'ran')\n");
  writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`);
  chmodSync(executable, 0o755);
  return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
}

export function approveContract(dir, cliPath, env, id, planned, read = []) {
  const draftPath = join(dir, `${id}.json`);
  const draft = spawnSync(process.execPath, [
    cliPath, "contract", "new", "--task", id, "--id", id,
    ...planned.flatMap((glob) => ["--planned", glob]),
    ...read.flatMap((glob) => ["--read", glob]),
    "--out", draftPath,
  ], { cwd: dir, env, encoding: "utf8" });
  if (draft.status !== 0) {
    throw new Error(`contract new failed for ${id}: ${draft.stderr || draft.stdout}`);
  }
  const approved = spawnSync(process.execPath, [cliPath, "contract", "approve", draftPath], {
    cwd: dir, env, encoding: "utf8",
  });
  if (approved.status !== 0) {
    throw new Error(`contract approve failed for ${id}: ${approved.stderr || approved.stdout}`);
  }
}
```

#### Step 4: Run the tests to verify they pass

Run: `pnpm build && node --test scripts/demo-svg/capture.test.mjs`
Expected: PASS (5/5). `pnpm build` is required first because `approveContract` spawns the built `packages/cli/dist/index.js`.

#### Step 5: Commit

```bash
git add scripts/demo-svg/capture.mjs scripts/demo-svg/capture.test.mjs
git commit -m "feat(demo-svg): add real in-process CLI capture primitives"
```

---

### Task 2: `sanitize.mjs` + `render.mjs` — deterministic text cleanup and SVG authoring

**Files:**
- Create: `scripts/demo-svg/sanitize.mjs`
- Create: `scripts/demo-svg/render.mjs`
- Test: `scripts/demo-svg/sanitize.test.mjs`
- Test: `scripts/demo-svg/render.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 (pure string/data transforms, independently testable).
- Produces:
  - `export function sanitizeHuman(human: string, repoDir: string): string`.
  - `export function ansiToSpans(line: string): { text: string; fill: string; bold: boolean }[]`.
  - `export function renderTerminalSvg(options: { title: string; description: string; promptPrefix: string; scenes: { prompt: string; pendingLabel: string; human: string }[] }): string`.
  - Task 3 (`generate.mjs`) calls `sanitizeHuman` on every captured `human` string before building `scenes`, then calls `renderTerminalSvg` once per demo file.

#### Step 1: Write the failing tests

Create `scripts/demo-svg/sanitize.test.mjs`:

```js
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

  it("is idempotent when run twice", () => {
    const human = "Ready plan written  /tmp/scopelock-demo-svg-abc123/ready.json\nDrift report  ./.scopelock/reports/drift-2026-07-21T14-04-44.234Z.json";
    const once = sanitizeHuman(human, "/tmp/scopelock-demo-svg-abc123");
    const twice = sanitizeHuman(once, "/tmp/scopelock-demo-svg-abc123");
    assert.equal(once, twice);
  });
});
```

Create `scripts/demo-svg/render.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ansiToSpans, renderTerminalSvg } from "./render.mjs";

describe("ansiToSpans", () => {
  it("splits a plain line into one span with the default fill", () => {
    assert.deepEqual(ansiToSpans("Cleared"), [{ text: "Cleared", fill: "#e6edf3", bold: false }]);
  });

  it("maps green (32) to the pass color and resets after 0", () => {
    assert.deepEqual(
      ansiToSpans("[32mPASS[0m found"),
      [
        { text: "PASS", fill: "#7ee787", bold: false },
        { text: " found", fill: "#e6edf3", bold: false },
      ],
    );
  });

  it("maps yellow (33) to the warn color and red (31) to the fail color", () => {
    assert.deepEqual(ansiToSpans("[33mWARN[0m"), [{ text: "WARN", fill: "#e3b341", bold: false }]);
    assert.deepEqual(ansiToSpans("[31mFAIL[0m"), [{ text: "FAIL", fill: "#ff7b72", bold: false }]);
  });

  it("treats bold (1) as a weight flag that keeps the current fill", () => {
    assert.deepEqual(
      ansiToSpans("[36m[1mChecks[0m"),
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
```

#### Step 2: Run the tests to verify they fail

Run: `node --test scripts/demo-svg/sanitize.test.mjs scripts/demo-svg/render.test.mjs`
Expected: FAIL — `Cannot find module './sanitize.mjs'` / `'./render.mjs'`.

#### Step 3: Implement `sanitize.mjs`

Create `scripts/demo-svg/sanitize.mjs`:

```js
export function sanitizeHuman(human, repoDir) {
  let result = human.split(repoDir).join(".");
  result = result.replace(
    /\.scopelock\/reports\/drift-[0-9T:-]+\.\d+Z\.json/g,
    ".scopelock/reports/drift-demo.json",
  );
  return result;
}
```

#### Step 4: Implement `render.mjs`

Create `scripts/demo-svg/render.mjs`:

```js
const SGR_COLOR = {
  "31": "#ff7b72",
  "32": "#7ee787",
  "33": "#e3b341",
  "36": "#79c0ff",
  "2": "#8b949e",
};
const DEFAULT_FILL = "#e6edf3";

export function ansiToSpans(line) {
  const spans = [];
  let fill = DEFAULT_FILL;
  let bold = false;
  let last = 0;
  const re = /\[(\d+)m/g;
  let match;
  const push = (text) => {
    if (text.length > 0) spans.push({ text, fill, bold });
  };
  while ((match = re.exec(line)) !== null) {
    push(line.slice(last, match.index));
    const code = match[1];
    if (code === "0") {
      fill = DEFAULT_FILL;
      bold = false;
    } else if (code === "1") {
      bold = true;
    } else if (SGR_COLOR[code]) {
      fill = SGR_COLOR[code];
    }
    last = re.lastIndex;
  }
  push(line.slice(last));
  return spans;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CANVAS_WIDTH = 960;
const HEADER_HEIGHT = 48;
const TOP_PADDING = 34;
const LINE_HEIGHT = 20;
const PROMPT_HEIGHT = 34;
const BOTTOM_PADDING = 24;
const PENDING_HEIGHT = 34;

function sceneContentLineCount(scene) {
  return scene.human.split("\n").length;
}

function renderLine(x, y, line) {
  const spans = ansiToSpans(line);
  const tspans = spans
    .map((span) => `<tspan fill="${span.fill}"${span.bold ? ' font-weight="700"' : ""}>${escapeXml(span.text)}</tspan>`)
    .join("");
  return `<text class="mono" x="${x}" y="${y}" font-size="13" xml:space="preserve">${tspans}</text>`;
}

export function renderTerminalSvg({ title, description, promptPrefix, scenes }) {
  const totalContentLines = scenes.reduce((sum, scene) => sum + sceneContentLineCount(scene), 0);
  const height = TOP_PADDING + HEADER_HEIGHT
    + scenes.length * (PROMPT_HEIGHT + PENDING_HEIGHT)
    + totalContentLines * LINE_HEIGHT
    + BOTTOM_PADDING;

  const keyframeRules = [];
  const classRules = [];
  let cursorY = HEADER_HEIGHT + TOP_PADDING;
  const groups = [];
  const sceneCount = scenes.length;

  scenes.forEach((scene, index) => {
    const pendingStart = (index / sceneCount) * 100;
    const pendingEnd = pendingStart + 50 / sceneCount;
    const afterStart = pendingEnd;

    classRules.push(`.pending${index}{animation-name:pending${index}}`);
    classRules.push(`.after${index}{animation-name:after${index}}`);
    keyframeRules.push(
      `@keyframes pending${index}{0%,${pendingStart.toFixed(3)}%{opacity:0}${(pendingStart + 0.001).toFixed(3)}%,${pendingEnd.toFixed(3)}%{opacity:1}${(pendingEnd + 0.001).toFixed(3)}%,100%{opacity:0}}`,
    );
    keyframeRules.push(
      `@keyframes after${index}{0%,${(afterStart - 0.001).toFixed(3)}%{opacity:0}${afterStart.toFixed(3)}%,100%{opacity:1}}`,
    );

    const promptY = cursorY;
    groups.push(
      `<text class="mono blue" x="32" y="${promptY}" font-size="14">${escapeXml(promptPrefix)} ${escapeXml(scene.prompt)}</text>`,
    );
    cursorY += PROMPT_HEIGHT;

    const pendingY = cursorY;
    groups.push(
      `<g class="animated pending${index}"><text class="ui muted" x="32" y="${pendingY}" font-size="13">${escapeXml(scene.pendingLabel)}...</text></g>`,
    );

    const afterLines = scene.human.split("\n");
    let lineY = cursorY;
    const afterContent = afterLines.map((line) => {
      lineY += LINE_HEIGHT;
      return renderLine(32, lineY, line);
    }).join("");
    groups.push(`<g class="animated after${index} final">${afterContent}</g>`);

    cursorY = lineY + LINE_HEIGHT;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${height}" viewBox="0 0 ${CANVAS_WIDTH} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(description)}</desc>
  <style>
    .ui{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .mono{font-family:SFMono-Regular,Consolas,"Liberation Mono",monospace}
    .text{fill:${DEFAULT_FILL}}.muted{fill:#8b949e}.blue{fill:#79c0ff}
    .animated{opacity:0;animation-duration:8s;animation-timing-function:steps(1,end);animation-iteration-count:infinite}
    ${classRules.join("")}
    ${keyframeRules.join("")}
    @media (prefers-reduced-motion:reduce){.animated{animation:none;opacity:0}.final{opacity:1}}
  </style>
  <rect width="${CANVAS_WIDTH}" height="${height}" rx="12" fill="#0d1117"/>
  <rect width="${CANVAS_WIDTH}" height="${HEADER_HEIGHT}" rx="12" fill="#161b22"/>
  <circle cx="24" cy="24" r="6" fill="#ff5f56"/><circle cx="46" cy="24" r="6" fill="#ffbd2e"/><circle cx="68" cy="24" r="6" fill="#27c93f"/>
  <text class="ui text" x="92" y="30" font-size="15" font-weight="700">${escapeXml(title)}</text>
  ${groups.join("\n  ")}
</svg>`;
}
```

#### Step 5: Run the tests to verify they pass

Run: `node --test scripts/demo-svg/sanitize.test.mjs scripts/demo-svg/render.test.mjs`
Expected: PASS (3/3 + 6/6).

#### Step 6: Commit

```bash
git add scripts/demo-svg/sanitize.mjs scripts/demo-svg/sanitize.test.mjs scripts/demo-svg/render.mjs scripts/demo-svg/render.test.mjs
git commit -m "feat(demo-svg): add ANSI-to-SVG sanitize and render pipeline"
```

---

### Task 3: `generate.mjs` — the two real demo scenarios and `--check` mode

**Files:**
- Create: `scripts/demo-svg/generate.mjs`
- Test: `scripts/demo-svg/generate.test.mjs`

**Interfaces:**
- Consumes: everything from Task 1 (`capture.mjs`) and Task 2 (`sanitize.mjs`, `render.mjs`).
- Produces: a CLI script runnable as `node scripts/demo-svg/generate.mjs [--check]`. No exports needed by later tasks — Task 4 only invokes it via `pnpm` scripts and CI, never imports it.

#### Step 1: Write the failing test

Create `scripts/demo-svg/generate.test.mjs`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const generatePath = join(scriptDir, "generate.mjs");

function run(args) {
  return spawnSync(process.execPath, [generatePath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("generate", () => {
  it("writes both demo SVGs with real content", () => {
    const result = run([]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const guided = readFileSync(join(repoRoot, "docs/assets/scopelock-demo.svg"), "utf8");
    const standard = readFileSync(join(repoRoot, "docs/assets/scopelock-plan-demo.svg"), "utf8");
    assert.match(guided, /Cleared/);
    assert.match(standard, /ordered safely/);
  });

  it("produces byte-identical output across two runs", () => {
    run([]);
    const first = readFileSync(join(repoRoot, "docs/assets/scopelock-demo.svg"), "utf8");
    run([]);
    const second = readFileSync(join(repoRoot, "docs/assets/scopelock-demo.svg"), "utf8");
    assert.equal(first, second);
  });

  it("--check exits 0 right after a fresh generate, and 1 when a committed file is hand-edited", () => {
    run([]);
    const checkClean = run(["--check"]);
    assert.equal(checkClean.status, 0, checkClean.stderr || checkClean.stdout);

    const target = join(repoRoot, "docs/assets/scopelock-demo.svg");
    const original = readFileSync(target, "utf8");
    writeFileSync(target, `${original}<!-- hand edit -->`);
    const checkDirty = run(["--check"]);
    assert.equal(checkDirty.status, 1);
    assert.match(checkDirty.stdout + checkDirty.stderr, /scopelock-demo\.svg/);
    writeFileSync(target, original);
  });
});
```

#### Step 2: Run the test to verify it fails

Run: `pnpm build && node --test scripts/demo-svg/generate.test.mjs`
Expected: FAIL — `Cannot find module './generate.mjs'`.

#### Step 3: Implement `generate.mjs`

Create `scripts/demo-svg/generate.mjs`:

```js
#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeFileSync as writeFile } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

import {
  forceTtyColor,
  recordingReporter,
  initFixtureRepo,
  cleanupFixtureRepo,
  fakeCodexOnPath,
  approveContract,
  cliBinPath,
} from "./capture.mjs";

forceTtyColor();

const { taskStartCommand } = await import("@scopelock/cli/dist/commands/task-start.js");
const { taskFinishCommand } = await import("@scopelock/cli/dist/commands/task-finish.js");
const { planPrepareCommand } = await import("@scopelock/cli/dist/commands/plan-prepare.js");

const { sanitizeHuman } = await import("./sanitize.mjs");
const { renderTerminalSvg } = await import("./render.mjs");

function stepLabels(events) {
  return events
    .filter((event) => event.type === "step" || event.type === "phase")
    .map((event) => (event.type === "step" ? event.label : event.name))
    .join(" -> ");
}

async function buildGuidedDemo() {
  const dir = initFixtureRepo();
  try {
    const env = fakeCodexOnPath(dir);
    const previousPath = process.env.PATH;
    process.env.PATH = env.PATH;
    try {
      const startRecording = recordingReporter();
      const startResult = await taskStartCommand({
        description: "Add a dark mode toggle",
        agent: "codex",
        allow: ["src"],
        block: [],
        context: [],
        test: ["unit"],
        id: "demo-guided",
        yes: true,
        interactive: false,
        cwd: dir,
        reporter: startRecording.reporter,
      }, {
        setup: async () => ({
          data: { targets: [{ id: "codex", executable: join(dir, ".demo-fake-bin", "codex"), hook: { installed: false, capabilities: { confidence: "degraded" } } }] },
          human: "",
          exitCode: 0,
        }),
      });

      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "dark-mode.js"), "export const darkMode = true;\n");

      const finishRecording = recordingReporter();
      const finishResult = await taskFinishCommand({ cwd: dir, reporter: finishRecording.reporter });

      return {
        title: "ScopeLock Guided terminal demo",
        description: "A real, regenerated terminal replay of task start and task finish.",
        promptPrefix: "$ scopelock",
        scenes: [
          {
            prompt: 'task start "Add a dark mode toggle" --agent codex --allow src --yes',
            pendingLabel: stepLabels(startRecording.events),
            human: sanitizeHuman(startResult.human ?? "", dir),
          },
          {
            prompt: "task finish",
            pendingLabel: stepLabels(finishRecording.events),
            human: sanitizeHuman(finishResult.human ?? "", dir),
          },
        ],
      };
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    cleanupFixtureRepo(dir);
  }
}

async function buildStandardDemo() {
  const dir = initFixtureRepo();
  try {
    const env = fakeCodexOnPath(dir);
    approveContract(dir, cliBinPath, env, "writer", ["src/writer.js"]);
    approveContract(dir, cliBinPath, env, "reader", ["src/reader.js"], ["src/writer.js"]);
    writeFileSync(join(dir, "plan.json"), JSON.stringify({
      schemaVersion: 1,
      planId: "demo-standard",
      tasks: [
        { id: "writer", contract: ".scopelock/contracts/writer.json", expectsChanges: true },
        { id: "reader", contract: ".scopelock/contracts/reader.json", expectsChanges: true },
      ],
    }));

    const previousPath = process.env.PATH;
    process.env.PATH = env.PATH;
    try {
      const recording = recordingReporter();
      const result = await planPrepareCommand("plan.json", {
        target: "codex",
        out: "ready.json",
        validationCommand: [process.execPath, "-e", "process.exit(0)"],
        reporter: recording.reporter,
        cwd: dir,
      });

      return {
        title: "ScopeLock Standard multi-agent plan demo",
        description: "A real, regenerated terminal replay preparing a conflict-aware two-stage plan.",
        promptPrefix: "$ scopelock",
        scenes: [
          {
            prompt: "plan prepare plan.json --target codex --out ready.json",
            pendingLabel: stepLabels(recording.events),
            human: sanitizeHuman(result.human ?? "", dir),
          },
        ],
      };
    } finally {
      process.env.PATH = previousPath;
    }
  } finally {
    cleanupFixtureRepo(dir);
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const guided = await buildGuidedDemo();
  const standard = await buildStandardDemo();

  const targets = [
    { path: join(repoRoot, "docs/assets/scopelock-demo.svg"), svg: renderTerminalSvg(guided) },
    { path: join(repoRoot, "docs/assets/scopelock-plan-demo.svg"), svg: renderTerminalSvg(standard) },
  ];

  if (!check) {
    for (const target of targets) writeFile(target.path, target.svg);
    return;
  }

  const stale = targets.filter((target) => {
    try {
      return readFileSync(target.path, "utf8") !== target.svg;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) {
    console.error(`Stale demo SVG(s), run \`pnpm demo:svg\` to regenerate: ${stale.map((t) => t.path).join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
```

Note: `planPrepareCommand`'s current signature (confirmed in `packages/cli/src/commands/plan-prepare.ts`) reads `process.cwd()` internally rather than taking a `cwd` option — the implementer must check this against the built `dist/commands/plan-prepare.js` and, if there is no `cwd` option, wrap the call with `process.chdir(dir)` / restore afterward instead (the same technique `packages/cli/src/cli.test.ts`'s `plan prepare` describe block already uses for its in-process tests) rather than passing a nonexistent option silently.

#### Step 4: Run the test to verify it passes

Run: `pnpm build && node --test scripts/demo-svg/generate.test.mjs`
Expected: PASS (3/3).

#### Step 5: Commit

```bash
git add scripts/demo-svg/generate.mjs scripts/demo-svg/generate.test.mjs docs/assets/scopelock-demo.svg docs/assets/scopelock-plan-demo.svg
git commit -m "feat(demo-svg): generate both README hero SVGs from real CLI output"
```

---

### Task 4: `package.json`, CI job, and `README.md` wiring

**Files:**
- Modify: `package.json` (root)
- Modify: `.github/workflows/test.yml`
- Modify: `README.md:22,58,123`

**Interfaces:**
- Consumes: `scripts/demo-svg/generate.mjs` (Task 3), invoked only as a subprocess via `pnpm` scripts — no direct imports.
- Produces: nothing consumed by later tasks (this is the final task).

#### Step 1: Add the npm scripts and widen the test glob

In root `package.json`, find:

```json
    "test": "pnpm -r test && node --test benchmarks/coordination/*.test.mjs scripts/release/*.test.mjs",
```

Replace with:

```json
    "test": "pnpm -r test && node --test benchmarks/coordination/*.test.mjs scripts/release/*.test.mjs scripts/demo-svg/*.test.mjs",
```

Find:

```json
    "demo:wallet": "pnpm build && node benchmarks/coordination/run-wallet-demo.mjs",
```

Add right after it:

```json
    "demo:wallet": "pnpm build && node benchmarks/coordination/run-wallet-demo.mjs",
    "demo:svg": "pnpm build && node scripts/demo-svg/generate.mjs",
    "demo:svg:check": "pnpm build && node scripts/demo-svg/generate.mjs --check",
```

#### Step 2: Add the CI job

In `.github/workflows/test.yml`, find the end of the `production-audit` job (its last step is `- run: pnpm release:audit`). Add a new sibling job after it, at the same indentation level as `test:` and `production-audit:`:

```yaml
  demo-svg-check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm demo:svg:check
```

#### Step 3: Fix `README.md`

Find (`README.md:22`):

```md
  <img src="./docs/assets/scopelock-demo.svg" width="900" alt="Animated ScopeLock Guided terminal replay: setup, task start, and task finish">
```

Replace with:

```md
  <img src="./docs/assets/scopelock-demo.svg" width="900" alt="Animated ScopeLock Guided terminal replay: task start and task finish">
```

Find (`README.md:58`):

```md
The animation above replays the deterministic demo output. With reduced-motion
enabled it stays on the completed frame.
```

Replace with:

```md
The animation above is generated from real `scopelock` command output —
regenerate it with `pnpm demo:svg`. With reduced-motion enabled it stays on
the completed frame.
```

`README.md:123`'s alt text ("Standard terminal replay: prepare a conflict-aware two-stage plan") already accurately describes the Standard scenario and needs no change.

#### Step 4: Run full verification

```bash
cd "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
pnpm typecheck && pnpm build && pnpm test
pnpm demo:svg:check
node packages/cli/dist/index.js check-drift
git diff --check
```

Expected: all green; `demo:svg:check` passes because Task 3's commit already left freshly-generated SVGs in place; `check-drift` clean under this task's own ScopeLock contract.

#### Step 5: Commit

```bash
git add package.json .github/workflows/test.yml README.md
git commit -m "chore(demo-svg): wire pnpm scripts, CI staleness check, and README fixes"
```

---

## Final Verification (after Task 4)

- `pnpm typecheck && pnpm build && pnpm test` green, including the new `scripts/demo-svg/*.test.mjs` suite now covered by the root `test` script's glob.
- `pnpm demo:svg` regenerates both SVGs with no errors.
- `pnpm demo:svg:check` passes immediately afterward.
- Open both `docs/assets/scopelock-demo.svg` and `docs/assets/scopelock-plan-demo.svg` directly in a browser: confirm the animation plays, settles on real (not placeholder) status-table content matching what `task start`/`task finish`/`plan prepare` actually print today, and that `prefers-reduced-motion: reduce` (via OS/browser settings) collapses it to the final settled frame.
- `node packages/cli/dist/index.js check-drift` clean.
- `git diff --check` clean.
