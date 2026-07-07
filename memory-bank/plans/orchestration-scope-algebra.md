# Creative: Scope-Algebra for Provably Parallel-Safe Agent Orchestration (Idea A)

- **Phase:** CREATIVE (design exploration, not build)
- **Task:** #0016 (creative), contract `creative-orchestration-scope-algebra-2026-07-07`
- **Owner:** cursor-agent
- **Status:** design proposal + falsifiable mini-experiment
- **Scope discipline:** docs only (`memory-bank/**`); no runtime code changed in this phase.

---

## 0. TL;DR

When several agents work on one complex task at once, they collide: two agents
edit the same file, one overwrites another's work, or a "small" change quietly
spreads into shared code. Today people handle this reactively (merge conflicts,
locks, retries).

**Idea A turns collision-avoidance into a math problem we can solve *before*
any agent runs.** A ScopeLock contract already declares *which paths an agent may
touch* as glob patterns. A set of globs is a **formal language** over file
paths. So the question "can agent X and agent Y run in parallel without
stepping on each other?" becomes:

> Are their **write-languages disjoint**? (i.e. is `L(X_write) ∩ L(Y_write) = ∅`?)

That is a **decidable, deterministic, LLM-free** check. From all pairwise
answers we build a **conflict graph** and use **graph coloring** to compute the
minimum number of sequential "waves". Within each wave, write-scopes are
pairwise disjoint, so **no two agents can touch the same file - by
construction**. The ScopeLock runtime hook stays as the backstop that enforces
each agent's lane.

Net: **scheduling makes conflicts impossible; the gate guarantees it.**

---

## 1. The problem, precisely

Symptoms of multi-agent chaos on a complex task:

1. **Write-write collision:** two agents edit `src/api/user.ts` → lost update /
   merge conflict.
2. **Scope creep into shared files:** agent A refactors `src/utils/index.ts`
   that agent B depends on → B's work breaks.
3. **Non-determinism:** the outcome depends on which agent finished first.
4. **No safety proof:** even if it "worked", you cannot state *why* it was safe.

We want an orchestration layer that is:

- **Deterministic** (same inputs → same schedule), consistent with ScopeLock's
  "determinism before LLM" principle.
- **Sound** (if it says "parallel-safe", it really is).
- **Local & cheap** (no cloud, no model call to decide scheduling).
- **Backstopped** (a runtime monitor catches any agent that escapes its lane).

---

## 2. Core formalization

### 2.1 Paths as a language

- Let `Σ*` be the universe of repo-relative file paths (strings over path
  characters, `/`-separated).
- A glob `g` denotes a set of paths `L(g) ⊆ Σ*` (its *language*). Example:
  `L("src/api/**") = { all paths under src/api }`.
- A **scope** is a pair of path-sets derived from a contract:
  - **Write-set** `W` = paths the agent is allowed to *modify* (planned
    writable globs minus forbidden globs).
  - **Read-set** `R` = paths the agent *depends on* but should not modify
    (optional; declared or inferred).

Formally, for a contract with planned globs `P` and forbidden globs `F`:

```
W = ( ⋃_{p∈P} L(p) )  \  ( ⋃_{f∈F} L(f) )
```

(ScopeLock's existing rule already encodes "forbidden beats planned"; this is
the set-algebra version of that precedence.)

### 2.2 The conflict relation

Two tasks `i, j` **conflict** if either:

- **Write-Write (hard):** `W_i ∩ W_j ≠ ∅` — they can edit the same file.
- **Write-Read (soft, optional):** `W_i ∩ R_j ≠ ∅` — one rewrites what the
  other reads; may break `j` semantically even without a merge conflict.

For v1 we treat **Write-Write as the hard, must-avoid conflict** and expose
Write-Read as an advisory warning (semantic hazards are only partially
capturable by paths — see §7).

### 2.3 The decision procedure: glob disjointness

We need to decide `L(g1) ∩ L(g2) = ∅` for globs. Options, in order of rigor:

1. **Structural normalization + canonical automaton (sound & complete for our
   glob dialect).** Compile each glob to a finite automaton over path segments
   (`*` = "any run within a segment", `**` = "any number of segments"). Glob
   intersection-emptiness = product automaton with no accepting path. Globs are
   a restricted, well-behaved subclass of regular languages, so this is
   efficient in practice (segment-wise, not char-by-char).
2. **Trie/prefix reasoning for the common case.** Most real scopes are
   directory prefixes (`src/api/**`, `packages/core/**`). Disjointness of two
   `dir/**` scopes reduces to "is neither directory a prefix of the other?" —
   an O(path length) check. Fall back to (1) for patterns with `*`, `{a,b}`,
   `?`.

### 2.4 The soundness invariant (the crux)

> **A false "conflict" is safe; a false "disjoint" is a data race.**

- If we wrongly say two disjoint scopes conflict → we lose some parallelism.
  Annoying, not dangerous.
- If we wrongly say two overlapping scopes are disjoint → two agents write the
  same file → the exact chaos we set out to prevent.

**Therefore the decision procedure MUST be conservative: whenever disjointness
is uncertain (ambiguous glob, unsupported operator, dynamic pattern), report
CONFLICT.** Soundness is non-negotiable; completeness (maximum parallelism) is
best-effort. This asymmetry is what makes the guarantee real.

### 2.5 From pairwise conflicts to a schedule

- Build an undirected **conflict graph** `G = (V, E)`: vertices = tasks, edge
  `(i,j)` iff `i` and `j` conflict.
- A set of tasks that can run **simultaneously** = an **independent set** in `G`
  (no edges between them → pairwise-disjoint write-scopes).
- We want to partition all tasks into the **fewest** groups of independent sets
  = **graph coloring**. Each color = one **wave**; waves run sequentially,
  tasks within a wave run in parallel.
- Minimum number of waves = **chromatic number** `χ(G)`. Optimal coloring is
  NP-hard in general, but our graphs are tiny (a handful of tasks), so exact or
  greedy (Welsh–Powell) coloring is instant and good enough.

**Guarantee:** within any wave, write-scopes are pairwise disjoint ⇒ no two
agents can modify the same path ⇒ the parallel result is a deterministic,
conflict-free union of per-agent changes.

### 2.6 Runtime backstop (why this composes with existing ScopeLock)

Static scheduling assumes agents obey their declared scope. Agents drift — that
is the whole reason ScopeLock exists. So each agent in a wave runs **under its
own ScopeLock contract**, and the existing `hook gate` blocks any write outside
its lane at runtime.

- Scheduler = *makes collisions impossible by construction* (design-time proof).
- Hook gate = *enforces the lane* (run-time monitor / backstop).

An agent that tries to escape its wave is denied deterministically, and the
attempt is now observable (`hook-errors.ndjson` / `audit.ndjson`). The two
layers together give an end-to-end safety property, not just a heuristic.

---

## 3. Why this is novel

- File locking, "last writer wins", and post-hoc merge are all **reactive**.
- Build systems (Bazel, Nx) compute dependency DAGs from *declared build
  targets*, but for **compile/test ordering**, not for **who-may-write-what
  agent lanes with a soundness guarantee**.
- Nobody (as of mid-2026) derives a **provably parallel-safe agent schedule**
  from **glob-algebra disjointness** and ties it to a **runtime monitor** that
  enforces the derived lanes. That combination — declarative scope → formal
  disjointness → coloring → enforced execution — is the differentiator.

It is also *explainable*: for any pair we can print *why* they conflict (the
overlapping path witness), which is exactly what a skeptical senior dev wants.

---

## 4. Design artifacts (proposed, NOT built in this phase)

These are the data shapes and one command needed to build the experiment later.
Written here as a contract for future implementation.

### 4.1 Scope model extension

Split scope into read vs write (backward compatible; today's `plannedPathPatterns`
maps to `write`):

```jsonc
"scope": {
  "writePathPatterns":    ["src/api/**"],     // was plannedPathPatterns
  "readPathPatterns":     ["src/types/**"],   // new, optional, advisory
  "forbiddenPathPatterns":["src/auth/**"]
}
```

### 4.2 Plan object

```jsonc
{
  "planId": "checkout-refactor-2026-07-07",
  "tasks": [
    { "id": "t1", "contract": ".scopelock/contracts/t1.json" },
    { "id": "t2", "contract": ".scopelock/contracts/t2.json" }
  ]
}
```

### 4.3 New command (experiment surface)

```
scopelock plan-parallel <plan.json> [--json] [--include-read-hazards]
```

Deterministic output:

- **conflict matrix** (n×n) with the witness path for each conflict,
- **waves**: ordered list of parallel batches,
- **stats**: task count, edge count, χ (waves), theoretical max parallelism.

Pure function in core: `schedule(tasks): { waves, conflicts }`. No git, no LLM,
fully unit-testable — same discipline as the drift engine.

---

## 5. Mini-experiment: `plan-parallel`

Goal: **falsify or confirm** that scope-algebra scheduling produces
conflict-free parallel agent runs with real speedup.

### 5.1 Worked example (dry run, by hand)

Task: "add checkout flow". Split into 4 subtasks with write-scopes:

| Task | Write-scope | Reads |
|---|---|---|
| t1 UI | `src/ui/checkout/**` | `src/types/**` |
| t2 API | `src/api/checkout/**` | `src/types/**` |
| t3 types | `src/types/checkout.ts` | — |
| t4 tests | `test/checkout/**` | `src/**` |

Write-write conflicts:
- t1 ∩ t2 = ∅, t1 ∩ t3 = ∅, t2 ∩ t3 = ∅, t4 ∩ others = ∅ → **no hard edges**.

Conflict graph `G` has **no edges** → χ = 1 → **all 4 run in one wave**.

Now add read-hazards (`--include-read-hazards`): t3 *writes* `src/types/checkout.ts`
which t1, t2, t4 *read*. Soft edges t3–t1, t3–t2, t3–t4. Coloring →
**wave 1: {t3}**, **wave 2: {t1, t2, t4}**. This is the intuitively correct
order: define shared types first, then build on them in parallel. The algebra
*derived* the ordering that a senior dev would impose manually.

### 5.2 Protocol

1. Pick a real medium task in a scratch repo; author 3–5 subtask contracts with
   `scopelock contract new`.
2. Run `scopelock plan-parallel plan.json` → record waves + conflict matrix.
3. Execute agents wave-by-wave (each under its contract + strict hook gate).
4. Measure the metrics below. Repeat with and without `--include-read-hazards`.

### 5.3 Falsifiable hypotheses & metrics

| Hypothesis | Metric | Success criterion |
|---|---|---|
| H1 Safety | write-collisions within a wave | **exactly 0** |
| H2 Enforcement | `hook gate` denials during a wave | ~0 (if scopes are right); every escape is caught, none slips |
| H3 Speedup | wall-clock vs sequential | wave plan is faster on ≥2-task waves |
| H4 Soundness | any file written by two agents in same wave | **never** (a single occurrence falsifies the approach) |
| H5 Determinism | re-running scheduler on same plan | byte-identical schedule |

**Kill criterion:** if H4 ever fails (two agents write one file in a wave that
the scheduler called safe), the disjointness procedure is unsound and must be
fixed or made more conservative before anything ships.

### 5.4 What "done" for the experiment looks like

A short report in `memory-bank/reflection/` with the conflict matrix, the wave
plan, the measured metrics, and a go/no-go on building `plan-parallel` for real.

---

## 6. Ideas B and C in plain language, and mixing

The user asked what B and C actually buy us. Straight answer:

### Idea B — Contract as a "living rulebook" checked over time (temporal monitor)

- **Plain version:** Today ScopeLock checks *"did you touch a forbidden file?"*
  — a snapshot question. Idea B lets the contract express **rules about
  sequences of actions over time**, e.g. *"you may edit `schema.ts` only if you
  also update a migration before you finish"* or *"never edit prod config after
  you've started editing tests"*. A small monitor watches the stream of agent
  actions and flags when the *order/combination* breaks a rule.
- **Real benefit?** **Medium, and it grows with Idea A.** For a single snapshot
  drift check it is overkill. But once you have **waves and dependencies**
  (Idea A), temporal rules become the natural way to state cross-task
  obligations ("types must land before UI"). It is the honest way to encode
  "this before that" instead of hard-coding it.
- **Honest cost:** writing temporal rules is harder for users than globs. Ship
  it only behind a couple of canned rules, not a raw logic language.

### Idea C — Rank drift by "surprise" (information theory)

- **Plain version:** Not every out-of-scope edit is equally alarming. Idea C
  scores each change by how **surprising / unexpected** it is given the task and
  the repo's normal patterns (touching `src/ui/Button.tsx` in a UI task = low
  surprise; touching `.github/workflows/deploy.yml` = high surprise). It ranks
  violations so a human reviews the scary ones first.
- **Real benefit?** **Genuine but secondary — it's a UX/prioritization layer,
  not a safety layer.** It does not *prevent* anything; it makes big diffs
  triage-able. Most valuable later, when reports get large. Note ScopeLock
  already has a crude version of this: `high_risk_file` flags. Idea C is the
  principled, tunable generalization of that flag.

### Can they be mixed? Yes — they stack cleanly because they answer different questions

| Idea | Question it answers | Layer | Prevents or informs? |
|---|---|---|---|
| **A** | *Who may run together safely?* | scheduling (design-time) | **prevents** collisions |
| **B** | *Is the order/combination of actions allowed?* | monitoring (over time) | **prevents** bad sequences |
| **C** | *Which violations matter most?* | ranking (post-hoc) | **informs** the human |

A natural combined pipeline:

```
A: split task → disjoint write-lanes → waves        (make it safe)
     ↓
B: run each wave under temporal rules (deps, obligations)   (keep it ordered)
     ↓
gate: enforce lanes at runtime (existing ScopeLock)         (backstop)
     ↓
C: rank whatever drift/violations remain for human review   (focus attention)
```

**Recommendation:** build **A** now (it is the safety core and the true
differentiator), keep **B** as the ordering layer that A makes necessary, and
treat **C** as a later reporting upgrade to the existing `high_risk_file`
signal. A is the foundation; B and C are multipliers, not prerequisites.

---

## 7. Risks & limits (intellectual honesty)

1. **Paths ≠ semantics.** Disjoint files can still be semantically coupled (t1
   imports a symbol whose meaning t2 changes). Path-algebra cannot see this.
   Mitigation: read-hazard edges (§2.2) + tests per wave; long-term, optional
   import-graph edges.
2. **Dynamic scope.** An agent may discover mid-task it needs a file outside its
   lane. Mitigation: the gate denies it → the agent must request a scope
   amendment → re-schedule. This is a feature (explicit), but adds a loop.
3. **Glob over-approximation.** Conservative disjointness may serialize things
   that were actually safe → less speedup. Acceptable per §2.4.
4. **Merge of parallel results.** Disjoint writes union cleanly at the file
   level, but the *build* must still pass. Wave boundaries are the integration
   checkpoints (run tests between waves).

---

## 8. Creative-phase decision (output of this phase)

- **Adopt Idea A** as the orchestration foundation for complex multi-agent
  tasks. It is deterministic, sound-by-design, local, and composes with the
  existing hook gate.
- **Build order (post-checkpoint, do not jump the interview gate for product,
  but this is R&D):**
  1. Pure `schedule()` core: glob disjointness (prefix fast-path + conservative
     fallback), conflict graph, greedy coloring. Unit-tested like the drift
     engine.
  2. `scopelock plan-parallel` command over a `plan.json`.
  3. Run the §5 mini-experiment; write the reflection report; go/no-go on
     read-hazard edges and Idea B.
- **Keep B and C on the roadmap** as the ordering and prioritization layers
  respectively; do not build them until A's experiment confirms value.
- **Invariant to carry into implementation:** the disjointness procedure is
  **conservative** — never report "disjoint" under uncertainty (§2.4).

---

## 9. Links

- `memory-bank/plans/scopelock-implementation-plan.md` — main phased plan (this
  is a Phase 4+ R&D branch, gated behind the checkpoint like the rest).
- `memory-bank/plans/strategy-review-round2-market-corrections.md` —
  differentiation (deterministic guardrails); scope-algebra deepens the moat.
