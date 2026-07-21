# Real terminal-capture pipeline for the README hero SVGs

## Problem

`README.md` embeds two animated SVG "terminal replays": `docs/assets/
scopelock-demo.svg` (Guided flow: task start, task finish) and `docs/
assets/scopelock-plan-demo.svg` (Standard flow: `plan prepare`). Both are
hand-authored `<text>`/`<rect>` markup with CSS keyframe animation,
manually kept "in sync" by a human eyeballing real CLI output and
retyping it (confirmed via `git log`/commit messages for PRs #12, #32,
#33 — no generator, no capture tool, no `.svg`-writing script anywhere in
the repo). `README.md:58` additionally claims "The animation above
replays the deterministic demo output," which has never been literally
true.

Both SVGs were last touched 2026-07-14, before the entire terminal UX
initiative (live progress events, failure-first colored PASS/WARN/FAIL
status tables — PRs #57/#58/#60/#61/#62) and the multi-contract
`check-drift` fix (#63). They are now visually and substantively stale,
and — because there is no automated pipeline — nothing prevents this from
recurring the next time the CLI's output changes.

The four existing `benchmarks/coordination/run-*-demo.mjs` scripts do
spawn the real built CLI, but always with `--json`, which (per `docs/
reference.md`) disables all progress output entirely — they cannot
demonstrate the terminal UX even in principle, as written.

## Goals

- Generate both hero SVGs from **real** CLI execution: real command
  functions, real `ProgressEvent` sequences, real rendered status tables
  — not hand-typed approximations of what the output might look like.
- Zero new runtime dependencies. No external tool (asciinema, svg-term,
  terminalizer, node-pty) — the whole approach is built from primitives
  already in this repo (`createReporter`'s `stream.isTTY` check,
  `renderStatusTable`/`ui.ts`'s fixed 7-color ANSI palette, the same
  in-process command-invocation pattern `cli.test.ts` already uses).
- A `pnpm demo:svg` script that regenerates both files on demand.
- A CI check that fails when the committed SVGs no longer match what the
  current CLI would produce, so this cannot go stale silently again.
- Visual continuity with the existing SVGs: same 960×360 canvas, same
  dark terminal chrome, same `prefers-reduced-motion` handling collapsing
  to a static final frame.

## Non-goals

- No general-purpose ANSI/terminal emulator or cursor-redraw parser. The
  `LivePanelReporter`'s live spinner/redraw behavior is not replayed
  frame-by-frame; the reveal animation is authored from the real
  `ProgressEvent` sequence's labels/order, and the settled final frame is
  the real final rendered status table. This is a deliberate scope cut,
  not an oversight — a full ANSI emulator is unnecessary complexity for a
  two-scene, always-lands-on-success hero animation.
- No change to `benchmarks/coordination/run-*-demo.mjs` — those exist for
  a different purpose (`--json`-mode deterministic evidence generation)
  and are out of scope here.
- No redesign of the SVGs' visual language (colors, chrome, layout) —
  this pipeline reproduces the existing look with real content, it does
  not redesign it.
- `scopelock setup` is not part of the Guided demo scenario (confirmed
  with maintainer): it predates and is untouched by the terminal UX work,
  so it adds length without adding anything new to show.

## Design

### Component 1: `scripts/demo-svg/capture.mjs`

Drives real CLI command functions in-process, in a throwaway git fixture
repo, following the exact pattern `packages/cli/src/cli.test.ts` already
uses for the same functions (`taskStartCommand`, `taskFinishCommand`,
`planPrepareCommand`, imported as `@scopelock/cli/dist/commands/*.js` —
resolved through the pnpm workspace symlink, the same subpath access
`cli.test.ts` has from inside the package; `@scopelock/cli` has no
`exports` field restricting this).

Before importing anything from `@scopelock/cli`, the script sets
`Object.defineProperty(process.stdout, "isTTY", { value: true,
configurable: true })`. `packages/cli/src/ui.ts`'s `supportsColor` is
computed once at module load from `process.stdout.isTTY === true &&
NO_COLOR === undefined && CI !== "true"` — forcing `isTTY` true before
that module loads means every `CommandResult.human` string captured
afterward contains real ANSI SGR codes (`[32m` green, `[33m`
yellow, `[31m` red, `[36m` cyan, `[2m` dim,
`[1m` bold, `[0m` reset — the complete, fixed set in `ui.ts`'s
`codes` map), exactly as a real interactive terminal would render them.
This is the mechanism that makes the captured colors real rather than
guessed, with zero new dependencies.

Each scenario capture returns `{ events: ProgressEvent[], human: string
}[]` — one entry per command in the scenario (e.g. two entries for the
Guided scenario: task start, then task finish) — where `events` comes
from an event-recording `ProgressReporter` (the same `recordingReporter()`
shape already used in `cli.test.ts`: `{ emit(event) { events.push(event);
liveReporter.emit(event); }, dispose() { liveReporter.dispose(); } }`,
wrapping the real `createReporter(process.stdout, { json: false })` so
the true reporter still runs and still produces the colored `human`
output through the normal code path) and `human` is the command's
`CommandResult.human`.

### Component 2: `scripts/demo-svg/sanitize.mjs`

Fixture repos live under a real OS temp directory
(`mkdtemp(join(tmpdir(), ...))`), so captured text contains absolute
paths that are both ugly and non-deterministic across machines/CI
runners (e.g. `/private/tmp/.../ready.json` locally vs. `/home/
runner/.../ready.json` in CI). Before rendering, every captured `human`
string is passed through a small deterministic replace pass: the
fixture repo's own absolute root path is replaced with `.`, and the
`.scopelock/reports/<timestamped-file>` pattern is replaced with a fixed
placeholder (`.scopelock/reports/drift-<demo>.json`) so re-running the
generator twice in a row (different `checkedAt` timestamps) produces
byte-identical SVG output — required for the CI staleness check (see
below) to be stable.

### Component 3: `scripts/demo-svg/render.mjs`

Turns each scenario's captured data into an ordered list of animated
"scenes" — **one scene per real CLI command invoked in the scenario**
(Guided: 2 scenes, for task start and task finish; Standard: 1 scene, for
the single `plan prepare` call). This is a deliberate scope cut from an
earlier draft of this section, made explicitly with the maintainer during
planning: a fully generic per-phase reveal (one frame per `step`/`phase`
event, splitting the settled command's `human` text at its `renderSections`
boundaries and revealing one section at a time) was considered and
rejected as unnecessary implementation complexity for a two-scene hero
animation — it would require coupling the renderer to `renderSections`'
internal block-separator convention for no benefit proportional to the
added code and test surface.

Each scene has two sub-frames:

- A **pending** sub-frame: the real `step`/`phase` event labels captured
  for that command, joined in emission order (e.g. "scheduling ->
  preflight -> composing" for `plan prepare`), shown once as a single
  static in-progress line — not a literal multi-stage reveal.
- A **settled** sub-frame: that command's full sanitized `human` text,
  rendered line by line, with ANSI-colored spans mapped 1:1 from the 7
  known SGR codes to fixed SVG hex colors (reusing the current SVGs'
  existing palette — green/pass, amber/warn — plus one new red for
  fail, which the all-happy-path hand-authored originals never needed).

Scenes accumulate visually in the same way the original hand-authored
SVGs did: once a scene settles, its content stays visible while the next
scene's prompt and pending line appear below it, so the final frame shows
every scene's real settled output stacked in order.

`renderSvg(frames, { title, description }): string` emits the SVG
markup: fixed 960×360 canvas, dark terminal chrome (reusing the existing
markup structure/rect layout), one `<g class="frame frameN">` per frame
with a CSS keyframe animation cross-fading between frames on a fixed
timer (mirroring the existing `.animated`/`.pendingN`/`.afterN` class
approach), and the same `@media (prefers-reduced-motion: reduce)` rule
collapsing to `opacity:0` on all `.animated` elements and `opacity:1` on
the final `.final` frame.

### Component 4: `scripts/demo-svg/generate.mjs`

Orchestrator. Builds two fixture scenarios:

- **Guided** (`docs/assets/scopelock-demo.svg`): a fresh git repo;
  `taskStartCommand` with a fixed description/agent/`--allow` pattern and
  an injected `{ confirm: async () => true, setup: <a fixed fake-agent
  setup matching cli.test.ts's readySetup shape> }` so it runs
  non-interactively and approves; a real file write matching the
  approved scope; `taskFinishCommand`. The scenario is deliberately a
  clean pass (matches the existing SVG's "Boundary approved" / "Cleared"
  success narrative) — no contrived warnings.
- **Standard** (`docs/assets/scopelock-plan-demo.svg`): two contracts with
  disjoint planned scopes and a read dependency between them (the same
  writer/reader shape already used in `cli.test.ts`'s `run` describe
  block and in this session's own manual HTML demo), `planPrepareCommand`
  targeting `codex`. This scenario naturally produces one real `WARN`
  ("Scope overlaps... ordered safely") alongside passing rows — a
  genuine, non-contrived demonstration of the failure-first table's
  warning treatment, not a fabricated failure.

Each scenario's captures go through `sanitize.mjs` → `render.mjs` →
written to the corresponding `docs/assets/*.svg` path. Cleans up its
temp fixture directories on exit (success or failure).

Wired as a new root `package.json` script:
`"demo:svg": "pnpm build && node scripts/demo-svg/generate.mjs"`,
following the exact shape of the existing `demo:flight-control`/
`demo:progressive`/`demo:pilot`/`demo:wallet` scripts.

### CI staleness check

`generate.mjs` accepts a `--check` flag: instead of writing to `docs/
assets/`, it writes to a temp directory and diffs each generated file
against the committed one, printing which file(s) differ and exiting `1`
if any do (exit `0` if both match) — the same exit-code-driven check
shape as `scripts/release/audit-packed.mjs`.

New root script: `"demo:svg:check": "pnpm build && node scripts/
demo-svg/generate.mjs --check"`.

New CI job in `.github/workflows/test.yml`, a single `ubuntu-latest` run
(not part of the 6-way OS/Node matrix — this is a deterministic content
check, not a platform-compatibility one, and doesn't need 6x runtime),
following the existing `production-audit` job's shape:

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

(Exact pinned action SHAs copied from the existing jobs in the same
file — this is not a placeholder, it is the literal content already
present in `.github/workflows/test.yml` today.)

### README changes

`README.md:58`'s claim is corrected from "The animation above replays
the deterministic demo output" to something literally true, e.g. "The
animation above is generated from real `scopelock` command output —
regenerate it with `pnpm demo:svg`." Alt text on both `<img>` tags
(`README.md:22,123`) is updated to drop the "setup" mention from the
Guided one (scenario no longer includes it, per the scope decision
above) and stays accurate for the Standard one.

## Testing

- `scripts/demo-svg/generate.test.mjs` (new, following the existing
  `benchmarks/coordination/run-wallet-demo.test.mjs` /
  `scripts/release/*.test.mjs` pattern already wired into the root
  `test` script's `node --test benchmarks/coordination/*.test.mjs
  scripts/release/*.test.mjs` glob — this glob needs to widen to include
  `scripts/demo-svg/*.test.mjs`, see below):
  - Running `generate.mjs` twice in a row produces byte-identical SVG
    output (proves `sanitize.mjs` actually removes non-determinism —
    this is the load-bearing test for the CI check to be trustworthy).
  - The Guided scenario's captured `human` output, before sanitization,
    contains real ANSI SGR codes (proves the `isTTY` forcing actually
    works, not silently falling back to plain text).
  - The Standard scenario's rendered SVG contains the literal text
    fragment "ordered safely" (proves the WARN row is genuinely present,
    not a placeholder/fabricated string).
  - `generate.mjs --check` exits `0` immediately after a fresh
    `generate.mjs` run, and exits `1` (with both differing filenames
    named in its output) when a committed SVG is hand-edited afterward.
- Root `package.json`'s `test` script's glob
  (`node --test benchmarks/coordination/*.test.mjs scripts/release/*.test.mjs`)
  is extended to `scripts/demo-svg/*.test.mjs` so this suite runs under
  plain `pnpm test`, not only under the dedicated CI job.

## Verification

- `pnpm demo:svg` regenerates both files with no errors; `git diff`
  shows real, readable SVG content differences (not path/timestamp
  noise) versus the current hand-authored files.
- `pnpm demo:svg:check` passes immediately after `pnpm demo:svg`.
- `pnpm typecheck && pnpm build && pnpm test` all green, including the
  new `scripts/demo-svg/*.test.mjs` suite.
- Visual check: open both regenerated SVGs directly in a browser and
  confirm the animation plays, settles on a real status table matching
  what `plan prepare`/`task start`/`task finish` actually print today,
  and that the reduced-motion media query collapses correctly.
- `node packages/cli/dist/index.js check-drift` clean under this task's
  own ScopeLock contract.
