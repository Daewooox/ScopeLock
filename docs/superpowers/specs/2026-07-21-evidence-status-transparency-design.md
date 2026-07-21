# Evidence status transparency: a third class for "not exercised"

## Problem

ScopeLock's evidence surfaces (the HTML Flight Report and `run`'s terminal
summary) collapse three semantically different status classes into two
visual ones:

1. **Checked and good** - `completed`, `passed`, `applied`, `ok`, `clear`,
   `verified`, `no-changes`.
2. **Checked and bad / needs attention** - `failed`, `violations`,
   `blocked`, `attention`, `warning`.
3. **Deliberately not exercised in this run** - `not-checked` (drift step
   skipped via `--no-check-drift`), `not-run` (no validation configured),
   `unverified` (no acceptance checks declared - the code's own comment in
   `report.ts` says this is "informational, not a blocker"),
   `not-applicable` (promotion/cleanup without `--isolate`),
   `not_configured` (no environment manifest), `off` (isolation off).

Class 3 currently renders amber ("warn") in the HTML report, so a
perfectly good direct-mode run shows a wall of alarming orange - the
maintainer hit exactly this reviewing a real wallet-demo receipt. For a
product whose core value is honest evidence, honesty that *looks like
malfunction* is the worst kind of opacity.

Aggravating factors, all confirmed in code:

- **Spelling drift decides the color.** `statusClass`
  (`packages/cli/src/commands/report.ts:204`) lists `"not-applicable"`
  (hyphen) as good, but the Safety Checks rows feed it `"not_applicable"`
  (underscore), which falls through to amber. Same meaning, two colors,
  reads as a bug.
- **The terminal renderer disagrees with the HTML renderer.**
  `evidenceLabel` (`packages/cli/src/commands/run-plan.ts:1267`) already
  treats `not-run`/`not-checked` as a dim SKIP - partially correct - but
  maps `unverified` to WARN (contradicting the informational-only
  semantics) and `not-applicable` to a green PASS (nothing passed; the
  step never ran).
- **No glosses, no legend.** `Promotion`, `Acceptance`, `Candidate
  unchanged by validation` are system-internal nouns with no explanation
  anywhere in the report, and nothing tells the reader whether `not-run`
  is expected or a defect.

## Goals

- Color carries only *checked outcomes*: green = checked and good, red =
  checked and failed, amber = checked and needs attention, and a new
  muted/grey class = deliberately not exercised. Same failure-first
  philosophy already shipped in the terminal status tables (bright
  failures, dim passes).
- One shared display-classification map used by BOTH renderers, so the
  HTML report and the terminal summary can never again disagree about the
  same status string.
- Every not-exercised status in the HTML report carries a short gloss
  explaining *why* it did not run.
- A legend/glossary section in the HTML report.
- `deriveEvidenceSummary` (`packages/cli/src/receipt-evidence.ts`), the
  receipt JSON schema, and every `data`/`--json` output remain completely
  untouched - this is pure rendering work.

## Non-goals

- No changes to `receipt-evidence.ts`, receipt v6 schema, exit codes, or
  the `Configured gates cleared`/`Needs attention` headline rule (already
  computed separately and correctly).
- No glosses or legend in the terminal summary - it is a compact overview
  and already points at the receipt and `scopelock report --open`; the
  HTML report is the deep-read surface. The terminal gets only the two
  classification fixes listed below.
- No dynamic/receipt-derived gloss text. Each not-exercised status has
  exactly one cause in the current model, so a fixed gloss map suffices;
  revisit only if a status ever gains a second cause.
- No changes to the drift-report renderer's finding rows
  (`renderDriftHtml`) beyond whatever it shares through `statusClass` -
  its Violations table semantics are already correct.

## Design

### New module: `packages/cli/src/evidence-display.ts`

A small pure module, the single source of display semantics for evidence
statuses, consumed by both `report.ts` and `run-plan.ts`:

```ts
export type EvidenceDisplayClass = "good" | "bad" | "attention" | "not-exercised";

/** Normalizes underscores to hyphens, then classifies. Unknown statuses
 *  classify as "attention" (fail-visible, never fail-silent). */
export function classifyEvidenceStatus(status: string): EvidenceDisplayClass;

/** Fixed gloss text for not-exercised statuses, keyed by normalized
 *  status. Statuses sharing one cause share one gloss. */
export const EVIDENCE_GLOSSES: Record<string, string>;
```

Classification table (after `_` → `-` normalization, case preserved as
produced today - all producers emit lowercase):

| Class | Statuses |
|---|---|
| `good` | `passed`, `pass`, `ok`, `completed`, `clear`, `verified`, `applied`, `no-changes`, `yes` |
| `bad` | `failed`, `fail`, `error`, `violations`, `blocked`, `no` |
| `attention` | `attention`, `warning`, `warn`, plus any unknown string |
| `not-exercised` | `not-applicable`, `not-checked`, `not-run`, `unverified`, `not-configured`, `off`, `skipped`, `not-started` |

Gloss map (exact text):

| Status (normalized) | Gloss |
|---|---|
| `not-applicable` | `this step only runs with --isolate` |
| `not-checked` | `drift step skipped (--no-check-drift)` |
| `not-run` | `no validation checks configured for this run` |
| `unverified` | `no acceptance checks were declared` |
| `not-configured` | `no environment manifest supplied` |
| `off` | `isolation was not requested` |
| `skipped` | `an earlier required step failed or was interrupted` |
| `not-started` | `the run ended before this step` |

### Naming policy (explicit decision)

The machine status tokens (`unverified`, `not-run`, `not-applicable`,
`not-checked`, ...) are deliberately NOT renamed, not even at the display
layer: they are the receipt-JSON vocabulary, and a user comparing the
HTML report against the receipt or `--json` output (the product's core
verifiability scenario) must find the same words in both. Human language
is added as a layer *around* the tokens (glosses, row descriptions, the
run-mode summary), never instead of them. One display-label exception:
the cryptic row title `Candidate unchanged by validation` is re-worded to
`Validation left the candidate unchanged` (same meaning, readable
actively; the underlying receipt field is unchanged).

### HTML report (`packages/cli/src/commands/report.ts`)

- `statusClass` is replaced by `classifyEvidenceStatus` from the new
  module, mapped to CSS classes: `good` → `.good`, `bad` → `.bad`,
  `attention` → `.warn`, `not-exercised` → new `.muted` class
  (grey, matching the existing `--muted: #637083` custom property already
  defined in the drift report's stylesheet; the receipt report's
  stylesheet gains the same).
- **Run-mode summary sentence** directly under the report header: one
  line assembled from the same fixed causes as the gloss map, naming
  which evidence steps do not apply to this run and why, e.g. `Direct
  run without isolation: validation, promotion and cleanup do not apply;
  the drift step was skipped by --no-check-drift.` Only clauses whose
  condition holds are included; a fully-exercised isolated run renders no
  summary sentence at all.
- **Pipeline stepper diagram** between the header and the Evidence
  Summary: a horizontal six-node inline SVG (Execution → Scope →
  Validation → Acceptance → Promotion → Cleanup), no external
  dependencies, each node colored by its `classifyEvidenceStatus` class;
  `not-exercised` nodes render grey with a dashed outline. Node label =
  row name, sub-label = status token. This is a static generated SVG
  string in the same template literal style as the rest of the renderer,
  not a charting library.
- **In-table row descriptions:** every Evidence Summary row carries a
  permanent muted description sub-line (the `↳` visual idiom already
  used by the terminal failure-first tables): Execution ↳ did every task
  run finish; Scope ↳ final drift check against every task contract;
  Validation ↳ the configured repository checks; Acceptance ↳ the checks
  you declared as required evidence; Promotion ↳ applying accepted
  patches to your branch; Cleanup ↳ removing temporary worktrees.
- Every cell whose status classifies as `not-exercised` renders the gloss
  inline as small muted text after the status value, e.g.
  `not-run <span class="gloss">- no validation checks configured for this run</span>`.
- A new `Legend` section at the bottom of the receipt Flight Report
  (before the raw-JSON details block), now colors-only (the six-row
  glossary lives in the table itself): three lines explaining that
  green/red/amber are *outcomes of checks that ran*, and grey means
  *this step was deliberately not exercised in this run* - not a
  warning.
- The `Validation left the candidate unchanged` row's displayed
  `yes`/`no` values classify directly through the shared map (`yes` →
  good, `no` → bad, per the table above), replacing today's indirection
  through `statusClass(clean ? "ok" : "failed")`.

### Terminal (`packages/cli/src/commands/run-plan.ts`)

`evidenceLabel` is re-implemented on top of `classifyEvidenceStatus`:
`good` → `"pass"`, `bad` → `"fail"`, `attention` → `"warn"`,
`not-exercised` → `"skip"`. Net behavior change is exactly two fixes:

- `unverified`: WARN → dim SKIP (matches its informational-only
  semantics).
- `not-applicable`: green PASS → dim SKIP (nothing passed; the step
  never ran).

Everything else renders identically to today. The `Safety` table's raw
string values are unchanged (they are uncolored today and stay so).

## Testing

- New unit test file `packages/cli/src/evidence-display.test.ts`: every
  status in the classification table, in BOTH spellings (hyphen and
  underscore), maps to its expected class; unknown strings map to
  `attention`; every not-exercised status has a non-empty gloss.
- `cli.test.ts` HTML assertions: existing tests asserting
  `<td class="good">`/`class="bad"` cells keep passing (except any that
  assert the old `Candidate unchanged by validation` label text, which
  update to the new wording); new assertions that a direct-mode receipt
  (no isolation, no drift) renders its Evidence Summary with zero
  `class="warn"` cells and at least one `class="muted"` cell with a
  gloss, that the run-mode summary sentence appears for a direct-mode
  receipt and is absent for a fully-exercised isolated one, that the
  stepper SVG contains six nodes with the expected classes, that every
  Evidence row renders its `↳` description sub-line, and that the
  colors-only Legend section is present.
- Terminal assertions: a direct-mode run's human output contains
  `SKIP` + `unverified` and `SKIP` + `not-applicable` (not `WARN
  unverified`, not `PASS not-applicable`).
- Existing tests that assert the headline (`Configured gates cleared`)
  and `--json` output shapes must pass unmodified - regression guard that
  this stayed rendering-only.

## Verification

- `pnpm typecheck && pnpm build && pnpm test` green.
- Regenerate the wallet-demo receipt (`pnpm demo:wallet`) and visually
  open its Flight Report: the Evidence Summary of that successful run
  shows green and grey only - no amber - and the legend renders.
- `pnpm demo:svg:check` still passes (the hero SVGs do not render any of
  the six evidence statuses; if the check disagrees, regenerate and
  inspect the diff before committing).
- `node packages/cli/dist/index.js check-drift` clean under this task's
  ScopeLock contract.
