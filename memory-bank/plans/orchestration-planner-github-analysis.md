# Run-Orchestrators, LLM Planners, and ScopeLock Direction

Date: 2026-07-10

## Question

Do public GitHub run-orchestrators or LLM planners show genuinely proven effectiveness that ScopeLock should reuse? Should ScopeLock build one, avoid it, or choose a different product angle for people using multiple coding agents?

## Sources Scanned

- Run/session/worktree orchestration:
  - `nwiizo/ccswarm`: https://github.com/nwiizo/ccswarm
  - `smtg-ai/claude-squad`: https://github.com/smtg-ai/claude-squad
  - `AgentWrapper/agent-orchestrator`: https://github.com/AgentWrapper/agent-orchestrator
  - GitHub Agent HQ announcements: https://github.blog/news-insights/company-news/welcome-home-agents/
- Planning/spec/task tools:
  - `github/spec-kit`: https://github.com/github/spec-kit
  - `eyaltoledano/claude-task-master`: https://github.com/eyaltoledano/claude-task-master
  - `bmad-code-org/BMAD-METHOD`: https://github.com/bmad-code-org/BMAD-METHOD
- Benchmark/evidence anchors:
  - SWE-bench Verified leaderboard and agent reports: https://www.swebench.com/
  - `mini-swe-agent`: https://github.com/SWE-agent/mini-swe-agent
  - `OpenHands`: https://github.com/All-Hands-AI/OpenHands
  - MAST / multi-agent failure research: https://github.com/multi-agent-systems-failure-taxonomy/MAST and https://arxiv.org/abs/2503.13657
  - Anthropic multi-agent research system writeup: https://www.anthropic.com/engineering/multi-agent-research-system
  - MAGIS multi-agent GitHub issue resolution paper: https://arxiv.org/abs/2403.17927

## Findings

### 1. Run-orchestrators exist, but proof is weak

The category is real and crowded. There are tools for spawning many agents, managing sessions, worktrees, dashboards, adapters, and delegation graphs. Examples include `claude-squad`, `ccswarm`, `agent-orchestrator`, Copilot Agent CLI wrappers, and many subagent collections.

What they usually prove:
- The UX is useful: launch agents, see status, isolate with worktrees, resume sessions.
- The category has user pull: people want to run several coding agents.
- Worktree isolation is a common default.

What they usually do **not** prove:
- N agents produce better merged code than one strong agent with the same compute budget.
- Conflict rate goes down in shared repos.
- Human review/intervention time goes down.
- End-to-end cycle time improves after merge/review/test overhead is included.

SA read: run orchestration is becoming infrastructure plumbing. It is valuable, but it is not a defensible wedge for ScopeLock unless we bring a new correctness/evidence primitive.

### 2. LLM planners/spec tools are heavily commoditized

Spec/task planners are now everywhere: GitHub Spec Kit, Kiro-style spec-driven development, Task Master, BMAD, and many prompt-template systems. They help produce tasks/specs, but the hard part is not "write a plan"; the hard part is "prove the agents stayed inside it and can merge safely".

What is useful to copy:
- Plan/spec artifacts should be file-based, diffable, reviewable.
- Planner output must remain draft until approved.
- Specs should link to tests and acceptance criteria.
- MCP integration is useful as an agent-loop surface.

What not to copy:
- A generic LLM planner as the core product.
- A framework where correctness depends on agent self-reporting.
- Big prompt libraries as the moat.

SA read: use planning only as a contract compiler interface over deterministic repo facts. The LLM can suggest, but ScopeLock must verify.

### 3. Proven coding effectiveness belongs mostly to single-agent harnesses

The strongest public evidence in coding agents is not from multi-agent run orchestration. It is from single-agent coding harnesses and repair loops on SWE-bench-style benchmarks: SWE-agent, mini-SWE-agent, OpenHands, and similar systems.

Implication:
- Good context selection, tight execution loop, patch/test feedback, and reproducible evaluation matter more than many-agent theatricality.
- ScopeLock should learn from these loops: keep tools small, deterministic, test-first, and benchmarkable.
- Do not assume multi-agent equals speedup. Our own H3 result already showed only ~1.5-2.0x median on a 3-task wave, with dispatch overhead dominating.

### 4. Multi-agent research supports a narrow, not broad, thesis

Recent research and Anthropic's writeups support a nuanced view:
- Multi-agent systems can help with broad, decomposable, information-gathering work.
- They are expensive and coordination-heavy.
- They can fail from miscommunication, duplicated work, bad handoffs, and inconsistent state.
- Hybrid approaches can outperform pure single-agent or pure multi-agent setups when routing/cascading is explicit.

This maps well to ScopeLock:
- Do not sell "more agents = better".
- Sell "when you do use multiple agents, here is how you keep them from colliding and how you prove readiness".

## Product Recommendation

### Do not build a generic run-orchestrator

Do not compete head-on with:
- GitHub Agent HQ / Copilot agent sessions
- Claude Code / Cursor native agent loops
- worktree dashboards
- generic agent process managers

They will keep improving, and users will already have opinions about which runner they like.

ScopeLock should integrate with them via CLI/MCP/hooks instead of replacing them.

### Do not build a generic LLM planner

A planner can be added later, but not as the main promise. The market already has many planning/spec tools, and plan generation is cheap to copy.

If built, ScopeLock planner should be:
- optional,
- draft-only,
- repo-manifest based,
- path-validated,
- contract-producing,
- never trusted until approved.

### Build a coordination proof layer

The promising product angle:

> ScopeLock is a multi-agent flight-control layer for coding agents: it does not launch the agents; it assigns safe lanes, prevents collisions, and proves which changes are ready to merge.

Core primitives:

1. **Contracts**
   - planned/write globs,
   - read globs,
   - forbidden globs,
   - tests and acceptance criteria,
   - baseline provenance.

2. **Conflict graph**
   - deterministic schedule,
   - write-write conflicts,
   - read-write hazards,
   - concrete witnesses.

3. **Leases**
   - a running agent gets a temporary write lease over contract scope,
   - hooks deny forbidden/outside edits,
   - MCP exposes conflict checks to the loop.

4. **Evidence receipts**
   - final drift report,
   - test evidence,
   - touched files,
   - unplanned changes,
   - merge readiness status.

5. **Telemetry**
   - time per wave,
   - collision attempts blocked,
   - violations per agent,
   - human intervention count,
   - merge conflict count.

This is more defensible than run orchestration because it remains useful across Claude Code, Cursor, Codex, GitHub Agent HQ, worktree dashboards, and future runners.

## New Product Concept

Working name: **ScopeLock Flight Control**.

It is not "another agent runner". It is an air-traffic-control layer for coding agents.

### UX

1. User defines or imports a set of tasks.
2. ScopeLock compiles each task into a contract.
3. ScopeLock computes a safe schedule: waves, conflicts, hazards.
4. User runs agents anywhere: Claude Code, Codex, Cursor, GitHub, worktrees.
5. Each agent receives the contract via prompt/MCP.
6. Hooks/MCP enforce lanes while the agent works.
7. ScopeLock emits a merge-readiness receipt per task/wave.

### Why this could "shoot"

Because it solves the ugly part people discover after the initial multi-agent excitement:
- "Which agents can run at the same time?"
- "Who is allowed to touch this file?"
- "Why did two agents both edit shared types?"
- "Can I trust this PR/patch?"
- "What did the agent do outside the plan?"
- "Did parallelism save time after review and merge?"

Most orchestrators stop at "run more agents". ScopeLock can own "run more agents without chaos".

## What To Borrow

From run-orchestrators:
- worktree/session mental model,
- process status UX,
- per-agent logs,
- resume/stop semantics,
- adapters for multiple agent CLIs.

From SWE-agent/OpenHands:
- reproducible harness,
- test/patch feedback loop,
- benchmark discipline,
- simple loops over elaborate agent theater.

From planners/spec tools:
- spec/task file artifacts,
- acceptance criteria,
- draft -> approve workflow,
- user-reviewable planning.

From Anthropic/research:
- multi-agent only when decomposition is real,
- explicit coordination costs,
- route/cascade work instead of blindly spawning agents.

## What To Avoid

- Generic "spawn N agents" CLI as the primary product.
- Generic prompt planner as the primary product.
- Claims of 3x/5x productivity without measuring review/merge overhead.
- Relying on LLM self-report for compliance.
- Building a desktop orchestration UI before proving coordination value.

## Proposed Next Experiment

Build a **Multi-Agent Coordination Benchmark** for ScopeLock, not a runner.

Minimal fixture:
- 6 realistic tasks over one repo.
- Some disjoint, some write-write conflicts, some read-write hazards.
- Run with:
  1. no ScopeLock,
  2. ScopeLock contracts + hooks,
  3. ScopeLock contracts + plan_parallel waves.

Metrics:
- elapsed wall-clock time,
- merge conflicts,
- scope violations,
- duplicate edits,
- failed tests,
- human interventions,
- final accepted tasks.

Success criteria:
- not "agents are faster",
- but "same or better wall-clock with fewer collisions/interventions and auditable merge readiness".

## Verdict

There is no strong public evidence that generic GitHub run-orchestrators or generic LLM planners are the thing ScopeLock should become.

There is strong evidence of a real multi-agent pain: coordination, collisions, untrusted changes, and merge readiness. ScopeLock already has unusually relevant pieces for that: contracts, drift check, hook gate, plan_parallel, MCP.

Recommendation: continue toward **coordination proof layer**, not runner/planner. Planner should remain a contract compiler helper; runner should remain someone else's surface.
