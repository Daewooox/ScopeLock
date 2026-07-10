# WalletAssignment Demo Plan for ScopeLock

Date: 2026-07-10
Task: #0044 / Step 5b
Contract: `walletassignment-demo-plan`
Candidate repo: `Daewooox/WalletAssignment`

## Goal

Create a short, credible demo that proves ScopeLock is a local flight-control
layer for AI coding agents, not just another CLI.

The demo should answer one question:

> If several agents touch a real codebase, can ScopeLock prevent setup drift,
> unsafe writes, bad execution order, and leave an auditable receipt?

## Why WalletAssignment Fits

WalletAssignment is a good second demo after `pnpm demo:pilot`.

Reasons:

- It is small enough for viewers to understand in under one minute.
- It is a real repository, not a synthetic fixture.
- It has an explicit domain with real invariants: balance, nonce, replay,
  duplicate transaction, lock/unlock, signature verification.
- It already has a test suite: `swift test` currently passes with 15 tests.
- The README already names concurrency risks: lost updates, nonce races,
  duplicate application, nondeterministic balance mutation.
- Natural multi-agent boundaries exist:
  - `Sources/WalletCore/WalletStateMachine.swift` - core transition rules.
  - `Sources/WalletCore/WalletActor.swift` - concurrency boundary.
  - `Tests/WalletCoreTests/WalletCoreTests.swift` - acceptance evidence.
  - `README.md` / `Sources/WalletAssignment/WalletAssignmentDemo.swift` -
    docs/demo layer.

Use it to show ScopeLock on a real compact repo. Keep `pnpm demo:pilot` as the
deterministic fallback for recordings and CI.

## Demo Shape

There should be two demo tracks:

### Track A - Stable Product Story

Command:

```bash
pnpm demo:pilot
```

Purpose:

- always works without Swift, Codex auth, API keys, or network;
- proves the product storyline deterministically;
- is the safe backbone for a first video.

Story:

1. missing required skill blocks dispatch;
2. adding the skill fixes environment preflight;
3. safe waves run in the right order;
4. Codex-format hook denies an out-of-scope `apply_patch`;
5. receipt v3 records evidence.

### Track B - Real Repo Demo

Command target:

```bash
pnpm demo:wallet
```

This command does not exist yet. It should be implemented only after the plan is
accepted.

Purpose:

- show the same flight-control idea on a real Swift project;
- use `swift test` as visible acceptance evidence;
- make the demo feel relevant to real engineering, not a toy.

## Real Repo Demo Storyboard

Target length: 5-7 minutes.

### Scene 1 - Baseline

Show:

```bash
git clone https://github.com/Daewooox/WalletAssignment.git /tmp/scopelock-wallet-demo
cd /tmp/scopelock-wallet-demo
swift test
```

Expected evidence:

- 15 tests pass.
- Repo is small: `Package.swift`, `Sources/WalletCore`, `Tests`.

Narration:

> This is a small wallet domain package. It has real invariants: nonce order,
> replay protection, duplicate transaction handling, and actor serialization.
> This is exactly the kind of compact codebase where people let multiple agents
> work in parallel.

### Scene 2 - ScopeLock Setup

Install or invoke local ScopeLock from the product repo.

Expected setup:

```bash
scopelock init
```

Create contracts for three tasks:

1. `wallet-core-rules`
   - write: `Sources/WalletCore/WalletStateMachine.swift`
   - read: `Sources/WalletCore/WalletTypes.swift`,
     `Tests/WalletCoreTests/WalletCoreTests.swift`
   - required test: `swift test`

2. `wallet-concurrency-tests`
   - write: `Tests/WalletCoreTests/WalletCoreTests.swift`
   - read: `Sources/WalletCore/WalletActor.swift`,
     `Sources/WalletCore/WalletStateMachine.swift`
   - required test: `swift test`

3. `wallet-docs-demo`
   - write: `README.md`, `Sources/WalletAssignment/WalletAssignmentDemo.swift`
   - read: `Sources/WalletCore/**`
   - required test: `swift test`

Active run-level contract should allow only:

- `.scopelock/**`
- `Sources/WalletCore/**`
- `Sources/WalletAssignment/**`
- `Tests/WalletCoreTests/**`
- `README.md`

Forbidden:

- `Package.swift`
- `.gitignore`
- `.github/**`
- `Secrets/**`
- `.env*`

### Scene 3 - Environment Preflight Block

Create `.scopelock/agents.json` that requires a demo skill, for example:

```json
{
  "schemaVersion": 1,
  "targets": ["codex"],
  "skills": [
    {
      "name": "wallet-domain-review",
      "path": ".agents/skills/wallet-domain-review",
      "required": true
    }
  ],
  "policy": {
    "requirePhysicalCopies": true,
    "requireRuleParity": true,
    "requireSkillParity": true
  }
}
```

Run:

```bash
scopelock run --plan plan.json --receipt .scopelock/reports/wallet-demo-blocked.json
```

Expected evidence:

- strict mode blocks before task commands;
- receipt says `blockedByEnvironment: true`;
- violation says missing required skill;
- no Swift files changed.

Narration:

> ScopeLock catches a broken agent environment before agents run. This is the
> quiet failure mode people hit in real projects: one agent has the instruction,
> another does not.

### Scene 4 - Fix Environment

Add the required physical skill:

```bash
mkdir -p .agents/skills/wallet-domain-review
cat > .agents/skills/wallet-domain-review/SKILL.md <<'EOF'
# Wallet Domain Review

Check wallet invariants before accepting changes:
- nonce must be strictly sequential;
- replay must fail deterministically;
- duplicate transaction ids must be rejected;
- actor mutation must stay serialized;
- `swift test` must pass.
EOF
```

Then run:

```bash
scopelock agents preflight --manifest .scopelock/agents.json
```

Expected evidence:

- status pass or warn;
- Codex hook may be `degraded` unless live verification is run;
- the missing-skill violation is gone.

### Scene 5 - Safe Waves

Run:

```bash
scopelock plan-parallel plan.json --include-read-hazards --json
```

Expected schedule:

- `wallet-core-rules` before `wallet-concurrency-tests`, because tests read
  core behavior.
- `wallet-docs-demo` can run with either a later or parallel wave depending on
  declared reads/writes.

The exact schedule can be:

```text
wave 1: wallet-core-rules
wave 2: wallet-concurrency-tests, wallet-docs-demo
```

Narration:

> The value is not "parallelize everything". The value is knowing which work can
> safely overlap, and which work must wait.

### Scene 6 - Hook Deny

Install hook:

```bash
scopelock hooks install --target codex --mode strict --local
```

Optional live verification:

```bash
scopelock hooks verify --target codex
```

Demonstrate a forbidden path attempt via synthetic Codex-format event:

```bash
printf '%s' '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: Package.swift\n@@\n-// swift-tools-version: 6.2\n+// swift-tools-version: 6.1\n*** End Patch"}}' \
  | scopelock hook gate --format codex
```

Expected evidence:

- permission decision is deny;
- `Package.swift` is unchanged;
- this proves ScopeLock can block pre-write when the harness hook is active.

Narration:

> We do not rely on the model promising to behave. If the tool call leaves the
> approved scope, the hook denies it.

### Scene 7 - Run and Receipt

Run:

```bash
scopelock run --plan plan.json --receipt .scopelock/reports/wallet-demo-final.json
swift test
scopelock check-drift
```

Expected evidence:

- task commands run by safe waves;
- `swift test` passes;
- `check-drift` has no violations;
- receipt v3 has:
  - `environment`;
  - `waves`;
  - `taskRuns`;
  - bounded command output previews;
  - local artifacts for raw output if needed.

Narration:

> At the end we do not just say "the agents probably did the right thing".
> ScopeLock leaves a receipt of environment, order, scope, tests, and results.

## Plan JSON Sketch

The demo plan should use deterministic commands first, not live agents. Live
Codex can be a second pass.

Example shape:

```json
{
  "schemaVersion": 1,
  "planId": "wallet-demo",
  "tasks": [
    {
      "id": "wallet-core-rules",
      "contract": ".scopelock/contracts/wallet-core-rules.json",
      "command": [
        "sh",
        "-lc",
        "swift test"
      ]
    },
    {
      "id": "wallet-concurrency-tests",
      "contract": ".scopelock/contracts/wallet-concurrency-tests.json",
      "command": [
        "sh",
        "-lc",
        "swift test"
      ]
    },
    {
      "id": "wallet-docs-demo",
      "contract": ".scopelock/contracts/wallet-docs-demo.json",
      "command": [
        "sh",
        "-lc",
        "swift test"
      ]
    }
  ]
}
```

The deterministic v1 can avoid actual source edits and still prove preflight,
scheduling, hook deny, tests, and receipt. A stronger v2 can add scripted edits
to tests/docs, but only if it remains stable.

## Implementation Plan for `pnpm demo:wallet`

Do this as a narrow demo harness, not product infrastructure.

1. Add `benchmarks/coordination/run-wallet-demo.mjs`.
2. Add root script:

```json
"demo:wallet": "pnpm build && node benchmarks/coordination/run-wallet-demo.mjs"
```

3. The script should:
   - clone or copy `Daewooox/WalletAssignment` into a temp dir;
   - run `swift test` and mark blocked if Swift is unavailable;
   - run `scopelock init`;
   - create three contracts;
   - create `.scopelock/agents.json` with a missing required skill;
   - run `scopelock run --plan` and assert blocked;
   - create the skill;
   - run `agents preflight`;
   - run `plan-parallel --include-read-hazards`;
   - install Codex hook config locally;
   - run synthetic `hook gate --format codex` deny against `Package.swift`;
   - run final `scopelock run --plan`;
   - run `swift test`;
   - write `summary.json` and `receipt.json` under
     `.scopelock/reports/wallet-demo`.

4. Add a smoke test:

```bash
node --test benchmarks/coordination/run-wallet-demo.test.mjs
```

The test should skip gracefully when `swift` is unavailable.

## What Not To Do Yet

- Do not require real Codex/Claude/Cursor for the first WalletAssignment demo.
- Do not implement a generic repo importer.
- Do not add a UI.
- Do not add a new runner abstraction.
- Do not mutate the original GitHub repo.
- Do not depend on network for the recorded demo if avoidable; cache/copy the
  fixture when making the final video.

## Success Criteria

The demo is successful if a viewer can repeat back:

- ScopeLock checks agent environment before dispatch.
- ScopeLock separates safe parallel work from hazardous order-dependent work.
- ScopeLock can block out-of-scope tool writes where hooks are active.
- ScopeLock writes a receipt with evidence instead of asking users to trust the
  agent transcript.

Operational DoD:

- `pnpm demo:pilot` remains the stable fallback.
- `pnpm demo:wallet` runs on the developer machine.
- If Swift is absent, wallet demo exits with a clear blocked message, not a
  stack trace.
- The final receipt path is printed.
- `swift test` passes at start and end.
- `check-drift` is clean for the intended scope.

## Recommended Recording Script

1. Start with one sentence:

   > This is ScopeLock: flight control for AI coding agents.

2. Show WalletAssignment README and tests:

   > The repo is small, but the invariants are real: nonce, replay, duplicate
   > transactions, and actor serialization.

3. Run the blocked demo:

   > Before any agent command runs, ScopeLock sees the environment is missing a
   > required skill and stops.

4. Add the skill:

   > Now every agent target has the same domain rules.

5. Show safe waves:

   > Core rules run before tests that read those rules; docs can be separated.

6. Show hook deny:

   > A tool call tries to touch `Package.swift`, which is outside the approved
   > scope. It is denied before mutation.

7. Show receipt:

   > The output is not vibes. It is a bounded receipt: environment, waves,
   > tasks, tests, and drift.

8. Close with design-partner ask:

   > I want to try this on one repo where you already use more than one coding
   > agent and see whether it catches a real mismatch.
