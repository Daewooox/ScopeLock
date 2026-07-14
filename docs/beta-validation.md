# Beta validation and pilot protocol

ScopeLock's progressive CLI is implemented and exercised in cross-platform CI.
That is engineering evidence, not proof that the interface is beta-stable. This
protocol records the remaining product evidence without replacing real users or
repositories with synthetic walkthroughs.

## Rehearse the flow

Run the deterministic demo before a session or pilot:

```bash
pnpm demo:progressive
```

It uses a temporary repository, runs `setup`, `task start`, and `task finish`,
then compiles a conflict-aware ready plan. It does not call a model, use an API
key, or execute an agent. The output directory contains the drift JSON, Flight
Report, input plan, ready plan, and summary.

## Five moderated sessions

Recruit five participants who use coding agents. Include at least two people
who already coordinate multiple agents. Do not count maintainers, synthetic
personas, or repeated sessions by the same participant.

Give each participant a clean fixture and only this goal:

> Protect one agent task, make one allowed and one blocked-path decision, then
> verify the result. Next, prepare a two-task plan and explain why its tasks run
> together or in separate stages.

Record only non-sensitive product evidence:

| Field | Record |
|---|---|
| Session id | Random local id; no name or email |
| Experience | Single-agent / multi-agent |
| Completed unassisted | Yes / no |
| Time to protected task | Seconds |
| Commands used | Count and command names, no prompt contents |
| Boundary explanation | Correct / incorrect |
| Protection limits | Correct / incorrect |
| Ready-plan location found | Yes / no |
| Terminology questions | Count and terms |
| Unexpected mutation | Yes / no, describe without repository data |

Pass the usability gate only when at least 4/5 complete unassisted, at least
4/5 explain allowed versus blocked changes and the lack of OS containment, the
median first protected task is under three minutes, and there are zero silent
approvals or unexpected config mutations.

## Three real-repository pilots

Run on three repositories owned or explicitly approved by their maintainers.
Use a clean branch and back up uncommitted work first. At least one pilot must
exercise two or more agents; include Claude, Codex, and Cursor across the set
when those harnesses are available.

For every pilot retain:

1. ScopeLock version and commit SHA.
2. OS, Node version, harness, and hook confidence.
3. Redacted contract shapes and plan task count.
4. `plan prepare` stages and conflict witnesses.
5. Receipt and Flight Report with repository secrets removed before sharing.
6. Scope violations, rejected promotions, failed tests, and manual interventions.
7. Wall-clock time and whether the maintainer accepted the final result.

Stop a pilot on any unexpected write outside the repository, loss of user work,
silent approval, foreign hook/config corruption, or a mismatch between the
reviewed ready plan and dispatched commands. These are product blockers, not
warnings to average away.

## Decision

Call the interface beta-stable only after both gates pass. A green demo or CI
run proves reproducibility and regression coverage; it does not satisfy the
human usability or real-repository pilot gates.
