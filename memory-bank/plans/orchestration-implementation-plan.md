# Implementation Plan: Scope-Algebra Scheduler (Idea A)

- **Phase:** PLAN (implementation-ready; executable by a junior dev/agent)
- **Task:** #0017, contract `plan-orchestration-impl-2026-07-07`
- **Owner:** cursor-agent
- **Status:** PLAN done; build gated behind the Stage-0 checkpoint (this is R&D).
- **Depends on:** `memory-bank/plans/orchestration-scope-algebra.md` (the theory).
- **Scope discipline:** docs only; no runtime code changed in this task.

---

## 0. Decisions locked in this plan

1. **Disjointness engine = HYBRID (B + A + conservative fallback).**
   - Backbone: glob → path-regex → NFA → product-automaton emptiness (Variant B).
   - Fast-path: pure directory-prefix comparison for `dir/**` vs `dir2/**` (Variant A).
   - Fallback: anything outside the supported glob dialect → return `true`
     (conflict). **Uncertainty always means conflict.**
2. **Forbidden globs are ignored in the write-write test.** Since
   `W ⊆ union(planned)`, disjoint `planned` sets imply disjoint write-sets.
   No language complement is ever needed. (Proof in §2.1.)
3. **Core primitive = `globsIntersect(a, b)`.** Everything else is a thin,
   deterministic layer on top.
4. **Scheduler: F1 (coloring, write-write only) first, F2 (mixed-graph layered)
   later behind `--include-read-hazards`.**
5. **Matcher-consistency is a release gate:** our regex translation MUST agree
   with `picomatch` (the runtime gate's matcher) on fuzzed inputs, else the
   guarantee is unsound at the seam.
6. All new code is **pure, in `packages/core`, git/LLM-free**, tested like the
   drift engine.

---

## 1. Module layout (target)

```
packages/core/src/schedule/
  glob-intersect.ts     # L1: globsIntersect(a,b) + helpers
  scope-algebra.ts      # L2: scopesConflict(a,b) -> { conflict, witness }
  conflict-graph.ts     # L3: buildConflictGraph(tasks)
  scheduler.ts          # L4: schedule(graph) -> { waves, cycles }
  plan.ts               # Plan zod schema + loader
packages/core/src/schedule.test.ts   # unit + property tests
packages/cli/src/commands/plan-parallel.ts   # L5 CLI
```

Exports added to `packages/core/src/index.ts`. CLI wired in
`packages/cli/src/index.ts` under a `plan-parallel` command.

---

## 2. L1 - `globsIntersect` (Milestone M1, the crux)

### 2.1 Soundness note (why no complement)

For tasks `i, j`: write-set `W_i ⊆ P_i` where `P_i = ⋃ L(planned_i)`.
If `P_i ∩ P_j = ∅` then `W_i ∩ W_j ⊆ P_i ∩ P_j = ∅`. So testing the
*planned unions* for disjointness is sound. We therefore only ever need:
union membership + pairwise positive-glob intersection. No negation/complement.

### 2.2 Public API

```ts
/** Sound, conservative: false only when a and b provably share no path. */
export function globsIntersect(a: string, b: string): boolean;

/** Any pair across the two glob sets intersects. */
export function globSetsIntersect(as: string[], bs: string[]): boolean;

/** A concrete path matched by both, for explainable conflict reports. */
export function intersectionWitness(a: string, b: string): string | null;
```

### 2.3 Algorithm (in order of attempt)

**Step 1 - normalize.** Lowercase-preserving; convert `\` to `/`; collapse
duplicate `/`; strip leading `./`. Reject empty → treat as conflict.

**Step 2 - directory fast-path (Variant A).** If both globs are of the exact
shape `PREFIX/**` or a plain literal path or `PREFIX/**/*`, decide by prefix:
- `A/**` vs `B/**` intersect iff `A` is a prefix of `B` or vice versa (segment-
  aligned, not substring).
- literal `p` vs `A/**` intersect iff `p` is under `A`.
- literal vs literal intersect iff equal.
This handles the overwhelmingly common case in O(path length).

**Step 3 - general path via automata (Variant B).** For anything with
`*`, `?`, `{}`, `[]` inside segments:
1. `globToRegexSource(g)` → a path-anchored regex string.
2. `buildNfa(regexSource)` → Thompson NFA (states, ε-moves, labeled edges;
   edges carry a *character predicate*, not a literal, so `[^/]`, classes, and
   `.` are represented as predicates).
3. `intersectNfa(nfaA, nfaB)` → product BFS from `(startA, startB)`; a state
   `(x, y)` is reachable by consuming a common character iff there exist edges
   `x -p1-> x'` and `y -p2-> y'` with `p1 ∧ p2` satisfiable (predicate
   conjunction non-empty). Reaching any `(acceptA, acceptB)` ⇒ intersect.
4. Emptiness (no accepting product state reachable) ⇒ disjoint.

**Step 4 - conservative fallback.** If the glob uses an unsupported construct
(extglob `!(...)`, `@(...)`, `+(...)`, negation `!`, brace ranges `{1..9}`),
`globToRegexSource` throws `UnsupportedGlob`; `globsIntersect` catches it and
returns `true` (conflict). Log which construct forced the fallback (for later
dialect expansion).

### 2.4 glob → regex translation table (path-anchored, `dot:true`)

| glob | regex fragment | note |
|---|---|---|
| `**` (whole segment) or leading `**/` | `.*` | crosses `/` |
| `*` | `[^/]*` | within a segment |
| `?` | `[^/]` | single non-`/` |
| `{a,b,c}` | `(?:a\|b\|c)` | recurse each alt |
| `[abc]`, `[a-z]`, `[!x]` | char class (`[!` → `[^`) | pass predicates |
| `.` `+` `(` `)` `^` `$` `\|` `\` | escaped literal | regex metachars |
| any other char | literal | |

Anchor whole pattern with `^...$`. `**/` at start also matches zero dirs
(so `**/x` matches `x`): emit `(?:.*/)?` for a leading `**/`.

**Character predicates (not full regex engine):** to keep the intersection
tractable, represent each edge label as a predicate over a char: `Literal(c)`,
`AnyExceptSlash`, `AnyChar`, `Class(ranges, negated)`. `p1 ∧ p2` = predicate
intersection (e.g. `Literal('a') ∧ AnyExceptSlash = Literal('a')`;
`Literal('a') ∧ Class([b-z]) = ∅`). This is small, total, and exact.

### 2.5 M1 tests (the release gate)

- **Known pairs (unit):**
  - `*.ts` vs `*.tsx` → disjoint
  - `src/**` vs `src/api/x.ts` → intersect (witness `src/api/x.ts`)
  - `**/*.ts` vs `src/**` → intersect
  - `a/*/b` vs `a/b/c` → disjoint; `a/*/b` vs `a/x/b` → intersect
  - `src/ui/**` vs `src/api/**` → disjoint
  - `pkg/{a,b}/**` vs `pkg/b/**` → intersect
- **Property - soundness:** for random glob pairs, if `globsIntersect===false`
  then a path fuzzer (generate strings from glob A) must find NO string that
  also matches B via picomatch. A single hit fails the build (kill criterion).
- **Property - matcher-consistency:** for random `(glob, path)`,
  `picomatch(glob,{dot:true})(path) === globRegex(glob).test(path)`.
- **Fallback:** `!(x)` etc. → `globsIntersect` returns `true` and records the
  unsupported construct.

**DoD M1:** all unit + property tests green over ≥10k generated cases;
`globsIntersect` has zero external deps; typecheck clean.

---

## 3. L2 - scope-algebra (Milestone M2)

```ts
export interface TaskScope { id: string; planned: string[]; forbidden: string[]; read?: string[]; }
export interface ScopeConflict { a: string; b: string; kind: "write-write" | "read-write"; witness: string | null; }

export function scopesConflict(a: TaskScope, b: TaskScope): ScopeConflict | null;
```

- write-write: `globSetsIntersect(a.planned, b.planned)`; witness via
  `intersectionWitness` on the first intersecting pair.
- read-write (only when read scopes provided): `globSetsIntersect(a.planned, b.read)`
  → directed `a → b`.

Tests: two disjoint scopes → null; overlapping planned → write-write + witness;
read hazard → read-write with correct direction.

---

## 4. L3/L4 - conflict graph + scheduler (Milestone M2/M5)

### 4.1 Graph

```ts
export interface ConflictGraph {
  nodes: string[];
  writeEdges: Array<[string, string]>;   // undirected (mutual exclusion)
  readEdges: Array<[string, string]>;    // directed a->b (ordering)
  conflicts: ScopeConflict[];            // for the matrix/report
}
export function buildConflictGraph(scopes: TaskScope[], opts?: { readHazards?: boolean }): ConflictGraph;
```

### 4.2 F1 scheduler (write-write only, coloring)

```ts
export interface Schedule { waves: string[][]; cycles: string[][]; }
export function schedule(graph: ConflictGraph): Schedule;
```

- Greedy Welsh-Powell coloring on `writeEdges`: order nodes by degree desc,
  assign each the lowest color with no conflicting neighbor. Each color = wave.
- Deterministic tie-break by node id (so schedules are reproducible - property H5).
- `cycles` empty in F1.

### 4.3 F2 scheduler (mixed graph, layered - M5)

- Topological layering on `readEdges` (Kahn's algorithm). Within each ready set,
  split by write-write coloring (reuse F1). Concatenate → ordered waves.
- **Cycle detection:** if Kahn cannot drain all nodes, the remaining nodes form
  read-write cycles → return them in `cycles`; caller reports "not
  parallelizable, serialize or redesign contracts". Never loop.

Tests: worked example from creative doc §5.1 must reproduce
`{t1,t2,t3,t4}` in one wave (F1) and `{t3}` then `{t1,t2,t4}` (F2 with hazards).

---

## 5. L5 - `plan-parallel` CLI (Milestone M3)

`plan.json` schema (`plan.ts`):

```jsonc
{ "planId": "string", "tasks": [ { "id": "t1", "contract": ".scopelock/contracts/t1.json" } ] }
```

Command:

```
scopelock plan-parallel <plan.json> [--json] [--include-read-hazards]
```

Behavior:
1. Load plan, load each referenced contract, derive `TaskScope` (planned =
   contract write globs, forbidden, optional read).
2. `buildConflictGraph` + `schedule`.
3. Human output: conflict matrix (n×n, `.`=safe, `x`=write-write, `>`=dep) with
   a witness line per conflict; ordered waves; stats (tasks, edges, waves,
   max theoretical parallelism); cycles (if any) as an error section.
4. Exit codes: `0` schedulable; `1` cycles/unschedulable; `2` bad input.
   (Reuses the existing `run.ts` exit-code contract.)

Tests (integration, like `cli.test.ts`): a plan with disjoint tasks → 1 wave,
exit 0; a plan with overlapping tasks → serialized waves; a read-write cycle →
exit 1 with cycle listed.

---

## 6. Milestones & gates (recap)

| M | Deliverable | Gate / kill criterion |
|---|---|---|
| **M1** | `glob-intersect.ts` + property/consistency tests | soundness + picomatch-consistency proven on ≥10k cases; else STOP |
| **M2** | scope-algebra + conflict graph + F1 coloring + plan schema | unit tests green |
| **M3** | `plan-parallel` CLI (matrix + waves + witness) | self-dogfood run |
| **M4** | run creative §5 mini-experiment; reflection report | H1-H5 measured; go/no-go on M5 |
| **M5** | read-hazard edges + F2 layered + cycle detection | worked example + cycle tests |

**Sequencing rule:** M1 is a standalone spike. Do not start M2+ until M1's
soundness gate is green - the entire guarantee rests on `globsIntersect`.

---

## 7. Risks & mitigations (implementation-level)

1. **Regex/picomatch drift** → property test §2.5; derive both from one
   translation where feasible; on any mismatch, treat as build failure.
2. **`**` semantics edge cases** (`**/x` matching `x`, trailing `/**`) →
   explicit unit cases; leading `**/` emits `(?:.*/)?`.
3. **Performance** → n ≤ ~20 tasks, O(n²) cheap intersections; automata only
   for patterns that skip the fast-path. Non-issue; add a bench like the hook
   gate if paranoid.
4. **Unsupported globs silently narrowing parallelism** → fallback logs the
   construct; expand the dialect only with new tests.
5. **Dynamic scope (agent needs a file outside its lane mid-run)** → out of
   scope for the scheduler; handled by gate-deny → scope amendment → reschedule
   loop (product decision, not M1-M5).

---

## 8. Contract shape for the build phase (when M1 starts)

```jsonc
{
  "id": "schedule-m1-glob-intersect",
  "task": "M1 spike: sound globsIntersect + property/consistency tests",
  "scope": {
    "plannedPathPatterns": ["packages/core/src/schedule/**", "packages/core/src/schedule.test.ts", "packages/core/src/index.ts"],
    "forbiddenPathPatterns": ["packages/core/src/git/**", "packages/core/src/hook/**", "packages/core/src/drift/**", "packages/cli/**"]
  },
  "tests": [{ "type": "unit", "command": "node --test packages/core/dist/schedule.test.js", "required": true }]
}
```

(Note: `index.ts` in planned scope only to add the re-export line.)

---

## 9. Links

- Theory: `memory-bank/plans/orchestration-scope-algebra.md`
- Main phased plan: `memory-bank/plans/scopelock-implementation-plan.md`
- Differentiation: `memory-bank/plans/strategy-review-round2-market-corrections.md`
