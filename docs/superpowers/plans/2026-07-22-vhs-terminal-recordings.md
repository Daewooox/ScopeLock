# VHS Terminal Recordings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 5 is the exception** - it requires installing `vhs` locally (a Homebrew package with `ttyd`/`ffmpeg` dependencies) and visually judging the output GIF; it cannot be executed blindly by a subagent and should be run by the controlling session, not dispatched.

**Goal:** Replace the hand-drawn hero SVGs (`docs/assets/scopelock-demo.svg`, `scopelock-plan-demo.svg`) with real VHS terminal recordings (GIF for the README, MP4 generated on demand for social sharing), per `docs/superpowers/specs/2026-07-22-vhs-terminal-recordings-design.md`.

**Architecture:** Two `.tape` scripts drive a real shell through the same two scenarios the SVG pipeline used (Guided: `task start`+`task finish`; Standard: `plan prepare` with a read-hazard pair), against a fixture repo built by a small reused module. CI never invokes `vhs` itself - a smoke script replays the tape files' literal typed commands against a fresh fixture and asserts they still exit `0`, catching "the demo would now be wrong" without a video diff.

**Tech Stack:** Node.js (`node:child_process`, `node:fs`, `node:test`), [VHS](https://github.com/charmbracelet/vhs) (local/manual only, never invoked in CI), existing ScopeLock CLI (`packages/cli/dist/index.js`).

## Global Constraints

- No byte/pixel-identical CI staleness check on the rendered GIF/MP4 - CI only replays the tape files' extracted commands natively and asserts exit `0`. Regenerating and eyeballing the video after a CLI-output change is a manual step, not automated.
- No WebM output. MP4 (uncommitted, generated on demand) covers external sharing; GIF (committed) covers the README embed.
- MP4 is never committed to the repository. Its output path is `.demo-vhs-out/`, which must be gitignored.
- Same two demo scenarios and content as the existing SVG pipeline - no redesign of what the demos show, only how they're rendered.
- GIF file basenames stay exactly what the SVGs were: `docs/assets/scopelock-demo.gif`, `docs/assets/scopelock-plan-demo.gif`.
- The plan scenario's validation placeholder stays `node -e "process.exit(0)"` - never `process.execPath`, which would bake a machine-specific absolute path into anything that ends up visible.
- `scripts/demo-svg/` and the two `.svg` files are deleted only after the VHS replacement is built, tested, and the real GIFs are committed (Task 6), so the branch never has a broken README mid-flight.

---

## Task 1: Fixture module

**Files:**
- Create: `scripts/demo-vhs/fixture.mjs`
- Create: `scripts/demo-vhs/fixture.test.mjs`
- Modify: `package.json` (root) - add `scripts/demo-vhs/*.test.mjs` to the `test` script's `node --test` glob list

**Interfaces:**
- Produces (used by Tasks 2 and 4): `cliBinPath` (string, absolute path to `packages/cli/dist/index.js`), `initFixtureRepo(): string` (returns a fresh git-initialized temp dir), `cleanupFixtureRepo(dir: string): void`, `fakeCodexOnPath(dir: string): NodeJS.ProcessEnv` (writes a fake `codex` executable into `<dir>/.demo-fake-bin` and returns `process.env` with that dir prepended to `PATH`), `writeScopelockShim(dir: string): void` (writes a `scopelock` executable into the same `<dir>/.demo-fake-bin` that execs the real built CLI), `approveContract(dir, cliPath, env, id, planned, read = []): void`, `buildScenarioFixture(name: "guided" | "plan"): { dir: string, env: NodeJS.ProcessEnv }`.

- [ ] **Step 1: Write the fixture module**

```js
// scripts/demo-vhs/fixture.mjs
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
export const cliBinPath = join(repoRoot, "packages/cli/dist/index.js");

export function initFixtureRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "scopelock-demo-vhs-")));
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

export function writeScopelockShim(dir) {
  const bin = join(dir, ".demo-fake-bin");
  mkdirSync(bin, { recursive: true });
  const executable = join(bin, "scopelock");
  writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${cliBinPath}" "$@"\n`);
  chmodSync(executable, 0o755);
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

export function buildScenarioFixture(name) {
  const dir = initFixtureRepo();
  const env = fakeCodexOnPath(dir);
  writeScopelockShim(dir);

  if (name === "guided") {
    // Both shims must be committed as part of the baseline `task start`
    // captures, or `task finish` reports them as out-of-scope drift (they
    // live outside the --allow src scope).
    spawnSync("git", ["add", "-A"], { cwd: dir });
    spawnSync("git", ["commit", "-qm", "fixture: shims"], { cwd: dir });
  } else if (name === "plan") {
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
  } else {
    throw new Error(`unknown scenario: ${name}`);
  }

  return { dir, env };
}
```

- [ ] **Step 2: Write the test file**

```js
// scripts/demo-vhs/fixture.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cliBinPath,
  initFixtureRepo,
  cleanupFixtureRepo,
  fakeCodexOnPath,
  writeScopelockShim,
  approveContract,
  buildScenarioFixture,
} from "./fixture.mjs";

// The fixture toolchain writes `#!/bin/sh` shims - POSIX-only by design,
// matching the demo-svg capture toolchain it replaces. CI runs this check
// on ubuntu-latest only.
const posixOnly = process.platform === "win32"
  ? { skip: "demo-vhs fixture toolchain is POSIX-only" }
  : {};

describe("fixture", posixOnly, () => {
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
      assert.equal(paths.some((p) => existsSync(join(p, "codex"))), true);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("writeScopelockShim puts a resolvable scopelock executable in .demo-fake-bin", () => {
    const dir = initFixtureRepo();
    try {
      writeScopelockShim(dir);
      const executable = join(dir, ".demo-fake-bin", "scopelock");
      assert.equal(existsSync(executable), true);
      assert.match(readFileSync(executable, "utf8"), /exec/);
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

  it("buildScenarioFixture('guided') leaves a clean working tree (shims are committed)", () => {
    const { dir } = buildScenarioFixture("guided");
    try {
      const status = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
      assert.equal(status.stdout.trim(), "");
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("buildScenarioFixture('plan') approves writer and reader contracts and writes plan.json", () => {
    const { dir } = buildScenarioFixture("plan");
    try {
      assert.equal(existsSync(join(dir, ".scopelock/contracts/writer.json")), true);
      assert.equal(existsSync(join(dir, ".scopelock/contracts/reader.json")), true);
      const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
      assert.equal(plan.tasks.length, 2);
    } finally {
      cleanupFixtureRepo(dir);
    }
  });

  it("buildScenarioFixture throws for an unknown scenario", () => {
    assert.throws(() => buildScenarioFixture("nope"), /unknown scenario/);
  });
});
```

- [ ] **Step 3: Wire the test glob into the root `test` script**

In root `package.json`, the `"test"` script currently reads:

```json
"test": "pnpm -r test && node --test benchmarks/coordination/*.test.mjs scripts/release/*.test.mjs scripts/demo-svg/*.test.mjs",
```

Add the new glob (keep `scripts/demo-svg/*.test.mjs` for now - it's removed in Task 6):

```json
"test": "pnpm -r test && node --test benchmarks/coordination/*.test.mjs scripts/release/*.test.mjs scripts/demo-svg/*.test.mjs scripts/demo-vhs/*.test.mjs",
```

- [ ] **Step 4: Build the CLI, then run the new tests**

Run: `pnpm --filter @scopelock/cli build`
Run: `node --test scripts/demo-vhs/*.test.mjs`
Expected: all tests pass (7 tests: initFixtureRepo, fakeCodexOnPath, writeScopelockShim, approveContract, buildScenarioFixture guided, buildScenarioFixture plan, buildScenarioFixture unknown-scenario throw).

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-vhs/fixture.mjs scripts/demo-vhs/fixture.test.mjs package.json
git commit -m "feat(demo-vhs): add reusable fixture-repo module"
```

---

## Task 2: Setup CLI + guided source-file writer

**Files:**
- Create: `scripts/demo-vhs/setup-fixture.mjs`
- Create: `scripts/demo-vhs/setup-fixture.test.mjs`
- Create: `scripts/demo-vhs/write-guided-source.mjs`
- Create: `scripts/demo-vhs/write-guided-source.test.mjs`

**Interfaces:**
- Consumes: `buildScenarioFixture` from `./fixture.mjs` (Task 1).
- Produces (used by the `.tape` scripts in Task 3, and indirectly documented for Task 4's smoke script, which uses `buildScenarioFixture` directly rather than shelling out to this CLI): `setup-fixture.mjs <guided|plan>` - a CLI that builds the named fixture and prints its absolute directory path (no trailing newline) to stdout, exit `0`; exits `2` with a usage message on stderr for any other argument. `write-guided-source.mjs` - a CLI with no arguments that writes `src/dark-mode.js` and `src/dark-mode.test.js` into the current working directory, exit `0`.

- [ ] **Step 1: Write `setup-fixture.mjs`**

```js
#!/usr/bin/env node
// scripts/demo-vhs/setup-fixture.mjs
import { buildScenarioFixture } from "./fixture.mjs";

const scenario = process.argv[2];
if (scenario !== "guided" && scenario !== "plan") {
  console.error("usage: setup-fixture.mjs <guided|plan>");
  process.exitCode = 2;
} else {
  const { dir } = buildScenarioFixture(scenario);
  process.stdout.write(dir);
}
```

- [ ] **Step 2: Write `setup-fixture.test.mjs`**

```js
// scripts/demo-vhs/setup-fixture.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const setupPath = join(scriptDir, "setup-fixture.mjs");

const posixOnly = process.platform === "win32"
  ? { skip: "demo-vhs fixture toolchain is POSIX-only" }
  : {};

describe("setup-fixture", posixOnly, () => {
  it("prints a fixture directory with both shims committed for 'guided'", () => {
    const result = spawnSync(process.execPath, [setupPath, "guided"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const dir = result.stdout;
    try {
      assert.equal(existsSync(join(dir, ".demo-fake-bin", "scopelock")), true);
      assert.equal(existsSync(join(dir, ".demo-fake-bin", "codex")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a fixture directory with plan.json and approved contracts for 'plan'", () => {
    const result = spawnSync(process.execPath, [setupPath, "plan"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const dir = result.stdout;
    try {
      assert.equal(existsSync(join(dir, "plan.json")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with a usage message on an unknown scenario", () => {
    const result = spawnSync(process.execPath, [setupPath, "nope"], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage/);
  });
});
```

- [ ] **Step 3: Write `write-guided-source.mjs`**

```js
#!/usr/bin/env node
// scripts/demo-vhs/write-guided-source.mjs
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("src", { recursive: true });
writeFileSync("src/dark-mode.js", "export const darkMode = true;\n");
writeFileSync(
  "src/dark-mode.test.js",
  [
    "import { test } from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { darkMode } from \"./dark-mode.js\";",
    "",
    "test(\"dark mode is enabled\", () => {",
    "  assert.equal(darkMode, true);",
    "});",
    "",
  ].join("\n"),
);
```

- [ ] **Step 4: Write `write-guided-source.test.mjs`**

```js
// scripts/demo-vhs/write-guided-source.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(scriptDir, "write-guided-source.mjs");

describe("write-guided-source", () => {
  it("writes a source file and a matching test file into cwd/src", () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-vhs-write-"));
    try {
      const result = spawnSync(process.execPath, [scriptPath], { cwd: dir, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(readFileSync(join(dir, "src/dark-mode.js"), "utf8"), /darkMode = true/);
      assert.match(readFileSync(join(dir, "src/dark-mode.test.js"), "utf8"), /dark mode is enabled/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run the new tests**

Run: `node --test scripts/demo-vhs/*.test.mjs`
Expected: all tests pass (10 tests total: Task 1's 7 plus these 3).

- [ ] **Step 6: Commit**

```bash
git add scripts/demo-vhs/setup-fixture.mjs scripts/demo-vhs/setup-fixture.test.mjs \
  scripts/demo-vhs/write-guided-source.mjs scripts/demo-vhs/write-guided-source.test.mjs
git commit -m "feat(demo-vhs): add setup-fixture CLI and guided source-file writer"
```

---

## Task 3: `.tape` scripts and the `demo:vhs` script

**Files:**
- Create: `scripts/demo-vhs/guided.tape`
- Create: `scripts/demo-vhs/plan.tape`
- Modify: `package.json` (root) - add `demo:vhs` script

**Interfaces:**
- Consumes: `scopelock` and (for guided) `codex` resolvable via `PATH` once the tape's setup line runs (Task 1/2's shims); `node scripts/demo-vhs/setup-fixture.mjs <guided|plan>` and `node $REPO/scripts/demo-vhs/write-guided-source.mjs` as literal shell invocations.
- Produces (consumed by Task 4's smoke script, which parses these files' `Type` lines, and by the manual regeneration in Task 5): `scripts/demo-vhs/guided.tape` outputs `docs/assets/scopelock-demo.gif` + `.demo-vhs-out/scopelock-demo.mp4`; `scripts/demo-vhs/plan.tape` outputs `docs/assets/scopelock-plan-demo.gif` + `.demo-vhs-out/scopelock-plan-demo.mp4`.

There is no automated test for this task in isolation - `vhs` itself is not installed in this environment (confirmed: `vhs` is not on `PATH`), and the file's correctness as a *tape* is exercised by Task 4's smoke script (which parses the same `Type` lines) and ultimately by the manual run in Task 5. Do not attempt to install `vhs` for this task.

- [ ] **Step 1: Write `guided.tape`**

```
Output docs/assets/scopelock-demo.gif
Output .demo-vhs-out/scopelock-demo.mp4

Set FontSize 14
Set Width 960
Set Height 400
Set Theme "Dracula"
Set Padding 20

Hidden
Type "REPO=$(pwd); cd $(node $REPO/scripts/demo-vhs/setup-fixture.mjs guided); export PATH=\"$(pwd)/.demo-fake-bin:$PATH\"; clear"
Enter
Show

Type `scopelock task start "Add a dark mode toggle" --agent codex --allow src --yes`
Enter
Sleep 1.5s

Hidden
Type "node $REPO/scripts/demo-vhs/write-guided-source.mjs; clear"
Enter
Show

Type "scopelock task finish"
Enter
Sleep 2s
```

- [ ] **Step 2: Write `plan.tape`**

```
Output docs/assets/scopelock-plan-demo.gif
Output .demo-vhs-out/scopelock-plan-demo.mp4

Set FontSize 14
Set Width 960
Set Height 300
Set Theme "Dracula"
Set Padding 20

Hidden
Type "REPO=$(pwd); cd $(node $REPO/scripts/demo-vhs/setup-fixture.mjs plan); export PATH=\"$(pwd)/.demo-fake-bin:$PATH\"; clear"
Enter
Show

Type `scopelock plan prepare plan.json --target codex --out ready.json --validation-command node -e "process.exit(0)"`
Enter
Sleep 2s
```

- [ ] **Step 3: Add the `demo:vhs` script**

In root `package.json`, alongside the existing `"demo:svg"` entry, add:

```json
"demo:vhs": "pnpm build && vhs scripts/demo-vhs/guided.tape && vhs scripts/demo-vhs/plan.tape",
```

- [ ] **Step 4: Sanity-check both tape files parse as valid text (no `vhs` needed)**

Run: `node -e "console.log(require('node:fs').readFileSync('scripts/demo-vhs/guided.tape','utf8').includes('task finish'))"`
Expected: `true`
Run: `node -e "console.log(require('node:fs').readFileSync('scripts/demo-vhs/plan.tape','utf8').includes('plan prepare'))"`
Expected: `true`

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-vhs/guided.tape scripts/demo-vhs/plan.tape package.json
git commit -m "feat(demo-vhs): add guided and plan VHS tape scripts"
```

---

## Task 4: Smoke check + CI wiring

**Files:**
- Create: `scripts/demo-vhs/smoke.mjs`
- Create: `scripts/demo-vhs/smoke.test.mjs`
- Modify: `package.json` (root) - add `demo:vhs:check` script
- Modify: `.github/workflows/test.yml` - add `demo-vhs-check` job (does not remove `demo-svg-check`; that happens in Task 6)

**Interfaces:**
- Consumes: `buildScenarioFixture`, `cliBinPath`, `cleanupFixtureRepo` from `./fixture.mjs` (Task 1); reads `scripts/demo-vhs/guided.tape` and `scripts/demo-vhs/plan.tape` (Task 3).
- Produces: `extractCommands(tapeText: string): string[]` and `stripTrailingClear(command: string): string` (both exported for `smoke.test.mjs`); running the file directly (`node scripts/demo-vhs/smoke.mjs`) checks both scenarios and sets `process.exitCode` to `0` or `1`.

- [ ] **Step 1: Write `smoke.mjs`**

```js
#!/usr/bin/env node
// scripts/demo-vhs/smoke.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScenarioFixture, cleanupFixtureRepo } from "./fixture.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");

export function extractCommands(tapeText) {
  const commands = [];
  for (const line of tapeText.split("\n")) {
    const doubleQuoted = line.match(/^Type\s+"(.*)"$/);
    const backtickQuoted = line.match(/^Type\s+`(.*)`$/);
    if (doubleQuoted) {
      commands.push(doubleQuoted[1].replace(/\\"/g, "\""));
    } else if (backtickQuoted) {
      commands.push(backtickQuoted[1]);
    }
  }
  // The first Type line is always the fixture cd/export setup, performed
  // natively by buildScenarioFixture below instead of replayed as a shell
  // command.
  return commands.slice(1);
}

export function stripTrailingClear(command) {
  return command.replace(/[;&]+\s*clear\s*$/, "").trim();
}

function checkScenario(name) {
  const tapeText = readFileSync(join(scriptDir, `${name}.tape`), "utf8");
  const commands = extractCommands(tapeText);

  const { dir, env } = buildScenarioFixture(name);
  try {
    for (const raw of commands) {
      const command = stripTrailingClear(raw);
      const result = spawnSync("sh", ["-c", command], {
        cwd: dir,
        env: { ...env, REPO: repoRoot },
        encoding: "utf8",
      });
      if (result.status !== 0) {
        throw new Error(
          `[${name}] command failed (exit ${result.status}): ${command}\n${result.stderr || result.stdout}`,
        );
      }
    }
  } finally {
    cleanupFixtureRepo(dir);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = false;
  for (const name of ["guided", "plan"]) {
    try {
      checkScenario(name);
      console.log(`ok - ${name}`);
    } catch (error) {
      failed = true;
      console.error(error.message);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
```

- [ ] **Step 2: Write `smoke.test.mjs`**

```js
// scripts/demo-vhs/smoke.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCommands, stripTrailingClear } from "./smoke.mjs";

describe("smoke", () => {
  it("extractCommands skips the first Type line and unescapes double-quoted strings", () => {
    const tape = [
      'Type "REPO=$(pwd); cd fixture; export PATH=\\"x:$PATH\\"; clear"',
      "Enter",
      'Type `scopelock task start "Add a dark mode toggle" --agent codex --allow src --yes`',
      "Enter",
      'Type "node $REPO/scripts/demo-vhs/write-guided-source.mjs; clear"',
      "Enter",
      'Type "scopelock task finish"',
      "Enter",
    ].join("\n");

    const commands = extractCommands(tape);
    assert.deepEqual(commands, [
      'scopelock task start "Add a dark mode toggle" --agent codex --allow src --yes',
      "node $REPO/scripts/demo-vhs/write-guided-source.mjs; clear",
      "scopelock task finish",
    ]);
  });

  it("stripTrailingClear removes a trailing '; clear' or '&& clear'", () => {
    assert.equal(stripTrailingClear("echo hi; clear"), "echo hi");
    assert.equal(stripTrailingClear("echo hi && clear"), "echo hi");
    assert.equal(stripTrailingClear("scopelock task finish"), "scopelock task finish");
  });
});
```

- [ ] **Step 3: Add the `demo:vhs:check` script**

In root `package.json`, alongside `"demo:svg:check"`, add:

```json
"demo:vhs:check": "pnpm build && node scripts/demo-vhs/smoke.mjs",
```

- [ ] **Step 4: Run it for real**

Run: `pnpm demo:vhs:check`
Expected: exits `0`, printing `ok - guided` then `ok - plan`. This is the real, full check - it builds the CLI, drives real `scopelock task start`/`task finish`/`plan prepare` subprocesses against fresh fixtures, exactly like CI will.

- [ ] **Step 5: Run the unit test**

Run: `node --test scripts/demo-vhs/smoke.test.mjs`
Expected: both tests pass.

- [ ] **Step 6: Add the `demo-vhs-check` CI job**

In `.github/workflows/test.yml`, add a new job after `demo-svg-check` (leave `demo-svg-check` untouched - it is removed in Task 6):

```yaml
  demo-vhs-check:
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
      - run: pnpm demo:vhs:check
```

- [ ] **Step 7: Commit**

```bash
git add scripts/demo-vhs/smoke.mjs scripts/demo-vhs/smoke.test.mjs package.json .github/workflows/test.yml
git commit -m "feat(demo-vhs): add smoke check and wire demo-vhs-check CI job"
```

---

## Task 5: Regenerate the real GIFs (manual - controller runs this, not a subagent)

**Files:**
- Create (committed): `docs/assets/scopelock-demo.gif`, `docs/assets/scopelock-plan-demo.gif`

This task cannot be executed blindly: it requires installing `vhs` (and its `ttyd`/`ffmpeg` dependencies) locally and visually judging the recorded output. If working with the user live, confirm before installing new local tooling.

- [ ] **Step 1: Install VHS locally**

Run: `brew install vhs`
Expected: installs `vhs`, pulling in `ttyd` and `ffmpeg` as dependencies.

- [ ] **Step 2: Generate both recordings**

Run: `pnpm demo:vhs`
Expected: creates `docs/assets/scopelock-demo.gif`, `docs/assets/scopelock-plan-demo.gif`, `.demo-vhs-out/scopelock-demo.mp4`, `.demo-vhs-out/scopelock-plan-demo.mp4`.

- [ ] **Step 3: Visually verify both GIFs**

Open both `docs/assets/*.gif` files (e.g. via the `Read` tool, which can render images, or any image viewer). Confirm:
- The guided GIF shows a real terminal running `scopelock task start "Add a dark mode toggle" --agent codex --allow src --yes` followed by `scopelock task finish`, ending on a "Cleared" result.
- The plan GIF shows a real terminal running `scopelock plan prepare plan.json --target codex --out ready.json --validation-command node -e "process.exit(0)"`, ending on a successful ready-plan result.
- Neither recording flashes any machine-specific absolute path (e.g. `/Users/...`, `/private/...`) on screen.

If anything looks wrong, fix the `.tape` file (font, theme, timing, window size) and re-run Step 2 before proceeding - do not commit a recording that doesn't hold up.

- [ ] **Step 4: Commit the GIFs**

```bash
git add docs/assets/scopelock-demo.gif docs/assets/scopelock-plan-demo.gif
git commit -m "feat(demo-vhs): commit real VHS-recorded hero GIFs"
```

(`.demo-vhs-out/*.mp4` is not committed - see Task 6 for the `.gitignore` entry, added there so it lands in the same review pass as the rest of the cleanup. If a clean pass is preferred, the `.gitignore` addition can be pulled forward before this step - order doesn't matter functionally, only that it lands before anyone runs `git status` and wonders about the untracked `.demo-vhs-out/`.)

---

## Task 6: Remove the SVG pipeline, update README and `.gitignore`

**Files:**
- Delete: `scripts/demo-svg/capture.mjs`, `scripts/demo-svg/capture.test.mjs`, `scripts/demo-svg/sanitize.mjs`, `scripts/demo-svg/sanitize.test.mjs`, `scripts/demo-svg/render.mjs`, `scripts/demo-svg/render.test.mjs`, `scripts/demo-svg/generate.mjs`, `scripts/demo-svg/generate.test.mjs`
- Delete: `docs/assets/scopelock-demo.svg`, `docs/assets/scopelock-plan-demo.svg`
- Modify: `package.json` (root) - remove `demo:svg`/`demo:svg:check` scripts and the `scripts/demo-svg/*.test.mjs` glob entry from `test`
- Modify: `.github/workflows/test.yml` - remove the `demo-svg-check` job
- Modify: `.gitignore` - add `.demo-vhs-out/`
- Modify: `README.md` - swap image extensions, update the regenerate-with line, remove the reduced-motion sentence

**Interfaces:** None - this task only removes dead code and updates references. It must run after Task 5 so the real GIFs already exist before the SVGs and their generator disappear.

- [ ] **Step 1: Delete the old pipeline and SVGs**

```bash
git rm scripts/demo-svg/capture.mjs scripts/demo-svg/capture.test.mjs \
  scripts/demo-svg/sanitize.mjs scripts/demo-svg/sanitize.test.mjs \
  scripts/demo-svg/render.mjs scripts/demo-svg/render.test.mjs \
  scripts/demo-svg/generate.mjs scripts/demo-svg/generate.test.mjs \
  docs/assets/scopelock-demo.svg docs/assets/scopelock-plan-demo.svg
rmdir scripts/demo-svg 2>/dev/null || true
```

- [ ] **Step 2: Update root `package.json`**

Remove these two lines entirely:

```json
"demo:svg": "pnpm build && node scripts/demo-svg/generate.mjs",
"demo:svg:check": "pnpm build && node scripts/demo-svg/generate.mjs --check",
```

Change the `"test"` script from:

```json
"test": "pnpm -r test && node --test benchmarks/coordination/*.test.mjs scripts/release/*.test.mjs scripts/demo-svg/*.test.mjs scripts/demo-vhs/*.test.mjs",
```

to:

```json
"test": "pnpm -r test && node --test benchmarks/coordination/*.test.mjs scripts/release/*.test.mjs scripts/demo-vhs/*.test.mjs",
```

- [ ] **Step 3: Remove the `demo-svg-check` CI job**

In `.github/workflows/test.yml`, delete the entire `demo-svg-check:` job block (the one ending in `- run: pnpm demo:svg:check`), leaving `demo-vhs-check` as the only demo-related job.

- [ ] **Step 4: Update `.gitignore`**

Add, after the `.release-artifacts/` entry:

```
# VHS-rendered MP4s (for external/social sharing); GIFs are committed.
.demo-vhs-out/
```

- [ ] **Step 5: Update `README.md`**

Change (line ~22):

```html
<img src="./docs/assets/scopelock-demo.svg" width="900" alt="Animated ScopeLock Guided terminal replay: task start and task finish">
```

to:

```html
<img src="./docs/assets/scopelock-demo.gif" width="900" alt="Animated ScopeLock Guided terminal replay: task start and task finish">
```

Change (lines ~58-60):

```
The animation above is generated from real `scopelock` command output -
regenerate it with `pnpm demo:svg`. With reduced-motion enabled it stays on
the completed frame.
```

to:

```
The animation above is a real recorded terminal session, regenerated with
`pnpm demo:vhs`.
```

Change (line ~124):

```html
<img src="./docs/assets/scopelock-plan-demo.svg" width="900" alt="Animated ScopeLock Standard terminal replay: prepare a conflict-aware two-stage plan">
```

to:

```html
<img src="./docs/assets/scopelock-plan-demo.gif" width="900" alt="Animated ScopeLock Standard terminal replay: prepare a conflict-aware two-stage plan">
```

- [ ] **Step 6: Full verification**

Run: `pnpm typecheck`
Expected: passes.
Run: `pnpm build`
Expected: passes.
Run: `pnpm test`
Expected: passes (demo-svg tests gone, demo-vhs tests present and green).
Run: `node packages/cli/dist/index.js check-drift`
Expected: `Cleared` (this task only touches docs/scripts/CI/config, all within the branch's approved scope - see the note on contract scope below).
Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(demo): remove the SVG demo pipeline, wire README to the VHS GIFs"
```

---

## Contract scope note (for whoever runs `contract new` on this branch)

Before Task 1, create and approve a ScopeLock contract covering this branch's full touch surface:

```bash
node packages/cli/dist/index.js contract new \
  --task "Replace hero SVG demos with real VHS terminal recordings" \
  --id vhs-terminal-recordings \
  --planned "scripts/demo-vhs/**" \
  --planned "scripts/demo-svg/**" \
  --planned "docs/assets/**" \
  --planned "package.json" \
  --planned ".github/workflows/test.yml" \
  --planned ".gitignore" \
  --planned "README.md" \
  --out /tmp/contract-draft.json
node packages/cli/dist/index.js contract approve /tmp/contract-draft.json
```

Run this once, before Task 1's first commit - every later task's `check-drift` depends on it.
