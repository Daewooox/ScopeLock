# Evidence Status Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "deliberately not exercised" evidence statuses visually and verbally distinct from real warnings in both the HTML Flight Report and the terminal run summary, with glosses, a run-mode summary, a pipeline stepper, and in-table row descriptions.

**Architecture:** A new pure module `packages/cli/src/evidence-display.ts` becomes the single display-classification source (`classifyEvidenceStatus` with `_`→`-` normalization, plus a fixed `EVIDENCE_GLOSSES` map). `report.ts` replaces its `statusClass` with helpers built on that module and gains a `.muted` class, glosses, a run-mode summary sentence, a six-node inline-SVG stepper, per-row `↳` descriptions, and a colors-only Legend. `run-plan.ts` re-implements `evidenceLabel` on the shared module, changing exactly two behaviors (`unverified` WARN→SKIP, `not-applicable` PASS→SKIP).

**Tech Stack:** TypeScript, Node's built-in test runner, no new dependencies. Rendering only.

## Global Constraints

- `packages/cli/src/receipt-evidence.ts`, the receipt v6 schema, exit codes, the `Configured gates cleared`/`Needs attention` headline rule, and every `data`/`--json` output are untouched.
- Machine status tokens are NOT renamed anywhere, including display - human language is layered around them. One display-label exception: `Candidate unchanged by validation` → `Validation left the candidate unchanged`.
- Classification table and gloss texts are exactly those in the spec (`docs/superpowers/specs/2026-07-21-evidence-status-transparency-design.md`); unknown statuses classify as `attention` (fail-visible, never fail-silent).
- Terminal changes are exactly two label fixes; the terminal gets no glosses, stepper, or legend.
- Zero new dependencies; the stepper is a hand-built SVG template string.

---

### Task 1: `evidence-display.ts` module + unit tests

**Files:**
- Create: `packages/cli/src/evidence-display.ts`
- Test: `packages/cli/src/evidence-display.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used verbatim by Tasks 2 and 3):
  - `export type EvidenceDisplayClass = "good" | "bad" | "attention" | "not-exercised"`
  - `export function normalizeEvidenceStatus(status: string): string`
  - `export function classifyEvidenceStatus(status: string): EvidenceDisplayClass`
  - `export const EVIDENCE_GLOSSES: Record<string, string>` (keys are normalized statuses)

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/evidence-display.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @scopelock/cli build 2>&1 | tail -3`
Expected: FAIL - `Cannot find module './evidence-display.js'` (build error, since the module does not exist).

- [ ] **Step 3: Implement the module**

Create `packages/cli/src/evidence-display.ts`:

```ts
/**
 * Single source of DISPLAY semantics for evidence status strings, shared by
 * the HTML Flight Report (report.ts) and the terminal run summary
 * (run-plan.ts). Data semantics stay in receipt-evidence.ts; this module
 * only decides how an already-derived status LOOKS.
 *
 * Three principles (see the 2026-07-21 evidence-status-transparency spec):
 * 1. Color carries only checked outcomes; "deliberately not exercised" is
 *    its own muted class, never amber.
 * 2. Producers disagree on underscore vs hyphen spelling; normalize here so
 *    spelling can never decide the color again.
 * 3. Unknown statuses classify as "attention": fail-visible, never silent.
 */

export type EvidenceDisplayClass = "good" | "bad" | "attention" | "not-exercised";

const GOOD = new Set([
  "passed", "pass", "ok", "completed", "clear", "verified", "applied", "no-changes", "yes",
]);
const BAD = new Set([
  "failed", "fail", "error", "violations", "blocked", "no",
]);
const NOT_EXERCISED = new Set([
  "not-applicable", "not-checked", "not-run", "unverified",
  "not-configured", "off", "skipped", "not-started",
]);

export function normalizeEvidenceStatus(status: string): string {
  return status.replaceAll("_", "-");
}

export function classifyEvidenceStatus(status: string): EvidenceDisplayClass {
  const normalized = normalizeEvidenceStatus(status);
  if (GOOD.has(normalized)) return "good";
  if (BAD.has(normalized)) return "bad";
  if (NOT_EXERCISED.has(normalized)) return "not-exercised";
  return "attention";
}

/** Why each not-exercised status occurred. Keys are normalized statuses. */
export const EVIDENCE_GLOSSES: Record<string, string> = {
  "not-applicable": "this step only runs with --isolate",
  "not-checked": "drift step skipped (--no-check-drift)",
  "not-run": "no validation checks configured for this run",
  "unverified": "no acceptance checks were declared",
  "not-configured": "no environment manifest supplied",
  "off": "isolation was not requested",
  "skipped": "an earlier required step failed or was interrupted",
  "not-started": "the run ended before this step",
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/evidence-display.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/evidence-display.ts packages/cli/src/evidence-display.test.ts
git commit -m "feat(cli): add shared evidence-status display classification"
```

---

### Task 2: HTML Flight Report rework

**Files:**
- Modify: `packages/cli/src/commands/report.ts` (the `statusClass` function at ~line 204, the CSS block inside `renderHtml` at ~line 271, and the `renderHtml` body at ~lines 249-379)
- Test: `packages/cli/src/cli.test.ts` (the `describe("run", ...)` block's report tests at ~lines 5437-5490)

**Interfaces:**
- Consumes from Task 1: `classifyEvidenceStatus(status: string): "good" | "bad" | "attention" | "not-exercised"`, `EVIDENCE_GLOSSES: Record<string, string>`, `normalizeEvidenceStatus(status: string): string` from `../evidence-display.js`.
- Produces: nothing consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/src/cli.test.ts`, inside `describe("run", ...)`, find the test `"renders receipt v6 evidence and ordered validation checks without using the legacy singular field"`. Make these exact changes to it:

1. In its receipt fixture, add a `drift` field right after `taskRuns: [...]`:

```ts
        taskRuns: [{ id: "a", status: "passed", durationMs: 12, stderr: "" }],
        drift: { status: "ok" },
```

2. Replace the two row assertions:

```ts
      assert.match(html, /<th>Execution<\/th><td class="good">completed<\/td>/);
      assert.match(html, /<th>Acceptance<\/th><td class="good">verified<\/td>/);
```

with:

```ts
      assert.match(html, /<th>Execution<div class="rowdesc">↳ did every task run finish<\/div><\/th><td class="good">completed<\/td>/);
      assert.match(html, /<th>Acceptance<div class="rowdesc">↳ the checks you declared as required evidence<\/div><\/th><td class="good">verified<\/td>/);
      assert.doesNotMatch(html, /class="runmode"/);
      assert.match(html, /Validation left the candidate unchanged/);
      assert.doesNotMatch(html, /Candidate unchanged by validation/);
```

Then add one NEW test immediately after that test:

```ts
  it("renders not-exercised evidence as muted with glosses, a run-mode summary, a stepper, and a legend", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelock-report-muted-"));
    try {
      const receiptPath = join(dir, "receipt.json");
      const reportPath = join(dir, "report.html");
      await writeFile(receiptPath, JSON.stringify({
        schemaVersion: 6,
        planId: "direct-report",
        startedAt: "2026-07-21T00:00:00.000Z",
        finishedAt: "2026-07-21T00:00:01.000Z",
        waves: [["a"]],
        conflicts: [],
        deferredTasks: [],
        handoffSummary: { passedTasks: ["a"], failedTasks: [], skippedTasks: [], blockedTasks: [], driftStatus: "not_checked" },
        taskRuns: [{ id: "a", status: "passed", durationMs: 12, stderr: "" }],
        evidenceSummary: {
          execution: "completed",
          scope: "not-checked",
          validation: "not-run",
          acceptance: "unverified",
          promotion: "not-applicable",
          cleanup: "not-applicable",
        },
      }));

      const result = runCli(dir, ["--json", "report", receiptPath, "--out", reportPath]);
      assert.equal(result.status, 0, result.stdout || result.stderr);
      const html = await readFile(reportPath, "utf8");
      // Not-exercised statuses are muted, never amber.
      assert.doesNotMatch(html, /<td class="warn">(not-run|not-checked|unverified|not-applicable)/);
      assert.match(html, /<td class="muted">not-run <span class="gloss">- no validation checks configured for this run<\/span><\/td>/);
      assert.match(html, /<td class="muted">unverified <span class="gloss">- no acceptance checks were declared<\/span><\/td>/);
      // Run-mode summary names why the muted steps did not run.
      assert.match(html, /class="runmode"/);
      assert.match(html, /do not apply/);
      assert.match(html, /--no-check-drift/);
      // Six-node stepper and colors-only legend.
      assert.equal((html.match(/data-node=/g) ?? []).length, 6);
      assert.match(html, /class="stepper"/);
      assert.match(html, /<h2>Legend<\/h2>/);
      assert.match(html, /not a warning/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "renders receipt v6 evidence|renders not-exercised evidence"`
Expected: both FAIL (old markup has no `rowdesc`, no `muted` class, no runmode/stepper/legend).

- [ ] **Step 3: Implement the report changes**

In `packages/cli/src/commands/report.ts`:

**3a. Import the shared module.** After the existing `import { renderSections } from "../ui.js";` line add:

```ts
import {
  EVIDENCE_GLOSSES,
  classifyEvidenceStatus,
  normalizeEvidenceStatus,
  type EvidenceDisplayClass,
} from "../evidence-display.js";
```

**3b. Replace `statusClass` entirely.** Delete the whole `function statusClass(status: string): string { ... }` block and put in its place:

```ts
const DISPLAY_CSS: Record<EvidenceDisplayClass, string> = {
  good: "good",
  bad: "bad",
  attention: "warn",
  "not-exercised": "muted",
};

function statusCss(status: string): string {
  return DISPLAY_CSS[classifyEvidenceStatus(status)];
}

/** One <td> for a status value: class from the shared map, plus an inline
 *  gloss explaining WHY when the status was deliberately not exercised. */
function statusCell(status: string): string {
  const css = statusCss(status);
  const gloss = EVIDENCE_GLOSSES[normalizeEvidenceStatus(status)];
  const glossHtml = css === "muted" && gloss !== undefined
    ? ` <span class="gloss">- ${escapeHtml(gloss)}</span>`
    : "";
  return `<td class="${css}">${escapeHtml(status)}${glossHtml}</td>`;
}

const EVIDENCE_ROWS = [
  { key: "execution", label: "Execution", description: "did every task run finish" },
  { key: "scope", label: "Scope", description: "final drift check against every task contract" },
  { key: "validation", label: "Validation", description: "the configured repository checks" },
  { key: "acceptance", label: "Acceptance", description: "the checks you declared as required evidence" },
  { key: "promotion", label: "Promotion", description: "applying accepted patches to your branch" },
  { key: "cleanup", label: "Cleanup", description: "removing temporary worktrees" },
] as const;

const STEPPER_FILL: Record<EvidenceDisplayClass, string> = {
  good: "#127a52",
  bad: "#b42318",
  attention: "#a86200",
  "not-exercised": "#637083",
};

function renderStepper(evidence: NonNullable<Receipt["evidenceSummary"]>): string {
  const nodeWidth = 176;
  const nodes = EVIDENCE_ROWS.map((row, index) => {
    const status = String(evidence[row.key] ?? "unknown");
    const cls = classifyEvidenceStatus(status);
    const cx = index * nodeWidth + 88;
    const dashed = cls === "not-exercised" ? ' stroke-dasharray="4 3" fill="none"' : ` fill="${STEPPER_FILL[cls]}"`;
    const connector = index === 0 ? "" : `<line x1="${cx - nodeWidth + 12}" y1="28" x2="${cx - 12}" y2="28" stroke="#d9e1ea" stroke-width="2"/>`;
    return `${connector}<circle data-node="${escapeHtml(row.label)}" cx="${cx}" cy="28" r="10" stroke="${STEPPER_FILL[cls]}" stroke-width="2"${dashed}/><text x="${cx}" y="58" text-anchor="middle" font-size="13" fill="#18202a">${escapeHtml(row.label)}</text><text x="${cx}" y="76" text-anchor="middle" font-size="11" fill="#637083">${escapeHtml(status)}</text>`;
  }).join("");
  const width = EVIDENCE_ROWS.length * nodeWidth;
  return `<div class="stepper"><svg width="${width}" height="88" viewBox="0 0 ${width} 88" role="img" aria-label="Evidence pipeline">${nodes}</svg></div>`;
}

function runModeSummary(
  receipt: Receipt,
  summary: NonNullable<Receipt["handoffSummary"]>,
  evidence: Receipt["evidenceSummary"],
): string {
  const clauses: string[] = [];
  if (receipt.isolation === undefined || receipt.isolation === null) {
    clauses.push("direct run without isolation - validation, promotion and cleanup do not apply");
  }
  const drift = normalizeEvidenceStatus(String(summary.driftStatus ?? receipt.drift?.status ?? "not_checked"));
  if (drift === "not-checked") {
    clauses.push("the drift step was skipped by --no-check-drift");
  }
  if (evidence !== undefined && evidence.acceptance === "unverified") {
    clauses.push("no acceptance checks were declared");
  }
  if (clauses.length === 0) return "";
  const sentence = clauses.join("; ");
  return `<p class="runmode">${escapeHtml(sentence.charAt(0).toUpperCase() + sentence.slice(1))}.</p>`;
}
```

`report.ts`'s `Receipt` type (near the top of the file) declares
`evidenceSummary?: { execution?: unknown; scope?: unknown; validation?:
unknown; acceptance?: unknown; promotion?: unknown; cleanup?: unknown }` -
`EVIDENCE_ROWS`'s `key` values (`as const`-typed to that same literal
union) index it directly with no cast needed: `evidence[row.key]`.

**3c. CSS additions.** In `renderHtml`'s `<style>` block, extend the line `.good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }` to:

```
.good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); } .muted { color: var(--muted); }
.gloss { color: var(--muted); font-weight: 400; font-size: 12px; }
.rowdesc { color: var(--muted); font-weight: 400; font-size: 12px; text-transform: none; letter-spacing: 0; margin-top: 2px; }
.runmode { margin: 0; color: var(--muted); }
.stepper { margin: 22px 0 0; overflow-x: auto; }
.legend p { margin: 4px 0; color: var(--muted); font-size: 13px; }
```

**3d. Header: run-mode summary.** In `renderHtml`, inside the `<header class="hero">` block, right after the `<div class="meta">...</div>` element, add:

```
    ${runModeSummary(receipt, summary, evidence)}
```

**3e. Stepper.** Replace the Evidence Summary section opener:

```
  ${evidence === undefined ? "" : `<section>
    <h2>Evidence Summary</h2>
    <table>
```

with:

```
  ${evidence === undefined ? "" : `<section>
    <h2>Evidence Summary</h2>
    ${renderStepper(evidence)}
    <table>
```

**3f. Evidence rows.** Replace the six hand-written `<tr>` rows of the Evidence Summary table with a single generated expression:

```
      <tbody>
        ${EVIDENCE_ROWS.map((row) => `<tr><th>${row.label}<div class="rowdesc">↳ ${row.description}</div></th>${statusCell(String(evidence[row.key] ?? "unknown"))}</tr>`).join("\n        ")}
      </tbody>
```

**3g. Safety/Validation/Tasks cells.** Replace every remaining `statusClass(...)` call site mechanically:

- `<td class="${statusClass(X)}">${escapeHtml(X)}</td>` shapes (Environment, Drift, Validation setup, Repository validation, Cleanup, Validation Checks status cells, Tasks status cells) become `${statusCell(X)}` with the same `X` expression.
- The `Candidate unchanged by validation` row becomes:

```
        <tr><th>Validation left the candidate unchanged</th>${statusCell(receipt.isolation?.validationWorkspaceClean === false ? "no" : "yes")}</tr>
```

- The `Final promotion` row simplifies (applied/no-changes are directly good in the shared map; the old `"ok"` remap disappears):

```
        <tr><th>Final promotion</th>${statusCell(String(receipt.isolation?.finalPromotion ?? "not_applicable"))}</tr>
```

- The uncolored `Isolation` and `Deferred tasks` rows stay exactly as they are.

**3h. Legend.** Immediately before the `Technical receipt JSON` details section, add:

```
  <section class="legend">
    <h2>Legend</h2>
    <p>Green means a check ran and passed. Red means a check ran and failed.</p>
    <p>Amber means a check ran and needs your attention.</p>
    <p>Grey means the step was deliberately not exercised in this run - it is not a warning.</p>
  </section>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "renders receipt v6 evidence|renders not-exercised evidence"`
Expected: PASS.

- [ ] **Step 5: Run the full CLI suite**

Run: `node --test 'packages/cli/dist/**/*.test.js'`
Expected: PASS, no regressions (in particular the escaped-HTML/XSS report tests keep passing - `statusCell` escapes both status and gloss).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/report.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): muted not-exercised statuses, glosses, stepper, and legend in Flight Report"
```

---

### Task 3: Terminal `evidenceLabel` + CHANGELOG + final verification

**Files:**
- Modify: `packages/cli/src/commands/run-plan.ts:1267-1283` (the `evidenceLabel` function)
- Modify: `CHANGELOG.md` (one new bullet in the Unreleased section)
- Test: `packages/cli/src/cli.test.ts` (one new test in `describe("run", ...)`)

**Interfaces:**
- Consumes from Task 1: `classifyEvidenceStatus` from `../evidence-display.js`.
- Produces: nothing (final task).

- [ ] **Step 1: Write the failing test**

In `packages/cli/src/cli.test.ts`, inside `describe("run", ...)`, immediately after the test `"runs command tasks by waves and writes a receipt"`, add:

```ts
  it("renders not-exercised evidence as dim SKIP in the terminal summary", async (t) => {
    const dir = await makeRepo();
    if (dir === null) {
      t.skip("git init failed");
      return;
    }
    try {
      await writeContract(dir, join(dir, "a.json"), "a", ["a.txt"]);
      await writeFile(join(dir, "plan.json"), JSON.stringify({
        schemaVersion: 1,
        planId: "skip-labels",
        tasks: [{
          id: "a",
          contract: "a.json",
          command: [process.execPath, "-e", "require('node:fs').writeFileSync('a.txt', 'a')"],
        }],
      }));
      const res = runCli(dir, [
        "run", "--yes", "--plan", "plan.json",
        "--receipt", join(dir, "receipt.json"),
        "--no-check-drift",
      ]);
      assert.equal(res.status, 0, res.stdout || res.stderr);
      assert.match(res.stdout, /Configured gates cleared/);
      // Informational statuses are dim SKIP, not WARN and not PASS.
      assert.match(res.stdout, /SKIP unverified/);
      assert.match(res.stdout, /SKIP not-applicable/);
      assert.match(res.stdout, /SKIP not-checked/);
      assert.doesNotMatch(res.stdout, /WARN unverified/);
      assert.doesNotMatch(res.stdout, /PASS not-applicable/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "renders not-exercised evidence as dim SKIP"`
Expected: FAIL - today's output contains `WARN unverified` and `PASS not-applicable`.

- [ ] **Step 3: Re-implement `evidenceLabel`**

In `packages/cli/src/commands/run-plan.ts`, add to the import block (near the other `../` imports):

```ts
import { classifyEvidenceStatus } from "../evidence-display.js";
```

Then replace the whole `evidenceLabel` function with:

```ts
function evidenceLabel(status: string): "pass" | "warn" | "fail" | "skip" {
  const cls = classifyEvidenceStatus(status);
  if (cls === "good") return "pass";
  if (cls === "bad") return "fail";
  if (cls === "attention") return "warn";
  return "skip"; // deliberately not exercised: dim, informational
}
```

- [ ] **Step 4: Run the test to verify it passes, then the full suite**

Run: `pnpm --filter @scopelock/cli build && node --test packages/cli/dist/cli.test.js --test-name-pattern "renders not-exercised evidence as dim SKIP"`
Expected: PASS.

Then: `node --test 'packages/cli/dist/**/*.test.js'`
Expected: PASS - no other terminal test asserts `WARN unverified` or `PASS not-applicable` (verified while writing this plan), and the headline rule is untouched.

- [ ] **Step 5: CHANGELOG entry**

In `CHANGELOG.md`, after the bullet describing the multi-contract `check-drift` change, add:

```md
- Flight Report and terminal summaries now distinguish "deliberately not
  exercised" statuses (not-run, not-checked, unverified, not-applicable) from
  real warnings: muted rendering with an inline reason, a run-mode summary,
  a pipeline stepper diagram, per-row descriptions, and a legend in the HTML
  report; dim SKIP labels in the terminal.
```

- [ ] **Step 6: Full verification**

```bash
cd "/Users/alexander/Documents/Visual Pre-flight Review for AI Coding Agents"
pnpm typecheck && pnpm build && pnpm test
pnpm demo:svg:check
node packages/cli/dist/index.js check-drift
git diff --check
```

Expected: all green. `demo:svg:check` must pass untouched (the hero SVGs render `plan prepare`/`task start`/`task finish` output, none of the six evidence statuses); if it disagrees, STOP and investigate rather than regenerating - that would mean this change leaked outside its intended surface.

Then regenerate the wallet-demo receipt and visually confirm:

```bash
pnpm demo:wallet
node packages/cli/dist/index.js report --open ".scopelock/reports/wallet-demo/receipt.json"
```

Expected in the browser: the successful run's Evidence Summary shows green and grey only (no amber), each grey status carries its gloss, the run-mode summary sentence and six-node stepper render, and the Legend section is present.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/run-plan.ts packages/cli/src/cli.test.ts CHANGELOG.md
git commit -m "feat(cli): dim SKIP for not-exercised evidence in terminal summary"
```

---

## Final Verification (after Task 3)

Covered by Task 3 Step 6. Summary: repo-wide gate green, `demo:svg:check` untouched-green, `check-drift` clean under this branch's contract, `git diff --check` clean, and a visual pass over the regenerated wallet-demo Flight Report confirming green-and-grey-only rendering with glosses, stepper, run-mode summary, and legend.
