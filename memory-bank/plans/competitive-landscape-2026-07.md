# Competitive landscape scan (2026-07) — read before building the MCP server

Web scan run 2026-07-09 to answer: do orchestrators / scope-enforcers with
proven effectiveness already exist that we'd be cloning or could reuse?
**Short answer: yes, the category is crowded and low-traction, and our planned
"MCP scope-enforcement server" is a near-clone of an existing tool.** This
doc exists so a delegated agent does NOT build blind.

## Finding 1 — Multi-agent effectiveness is academically unproven

2025-2026 research consensus: multi-agent advantages are **not universal** and
often vanish under equal compute — single agents match or beat multi-agent on
reasoning benchmarks when thinking-token budgets are controlled. Implication:
the premise "parallel agents are worth orchestrating" is shaky. Do not build
as if parallelism is self-evidently valuable; our own #0033 already showed
realized speedup (~1.5-1.8x) is well below the theoretical 3x and bounded by
the executor, not the schedule.

## Finding 2 — The orchestrator space is a red ocean (worktree isolation)

Dozens of parallel-agent orchestrators exist: **Conductor** (Melty Labs),
**Claude Squad**, Crystal, Vibe Kanban, amux, Emdash, Baton, Composio, +60
more (see `andyrewlee/awesome-agent-orchestrators`). Almost all solve
collision-safety by **git-worktree isolation** (each agent in its own
branch/worktree, then merge) — they prevent conflicts by isolation, not by
proving disjointness. Plus the **platform itself** (Claude Code proactive
loops / dynamic workflows) now does parallel-worktree dispatch natively.
Building `scopelock run` = entering this red ocean against the platform.

## Finding 3 — Even our "deterministic disjointness" differentiator exists

Two tools prove parallel safety *before* execution (not just isolate):
- **wit** — locks specific *functions* (not files) via Tree-sitter AST
  parsing; agents declare intents, acquire symbol-level locks, get conflict
  warnings before writing. Finer-grained than our path-glob approach (but
  language-specific; ours is language-agnostic).
- **swarm-protocol** — MCP server to claim work, detect file conflicts,
  heartbeat, hand off across sessions.

So our disjointness scheduler (plan-parallel) is differentiated vs the
worktree crowd but NOT unique.

## Finding 4 — Our planned MCP scope-enforcer is a near-clone (the big one)

**`logi-cmd/agent-guardrails`** (~8★, active to Apr 2026) does almost exactly
what ScopeLock's contract/drift/enforcement does, with MORE integration:
- Task contracts with declared `intended-files` / `allow-paths` via a `plan`
  command, enforced via `check` — maps 1:1 to our approved contract + scope.
- Five deterministic (non-LLM) checks: **Scope** (out-of-boundary changes),
  **Validation** (evidence/commands exist), **Consistency** (change spread),
  **Risk** (protected paths, config, secret patterns), **Reviewer output**
  (scores/verdicts). ≈ our outside_scope/forbidden + missing_tests +
  high_risk + drift report.
- Integrations: **MCP stdio server**, helper files (CLAUDE.md, .cursor/rules),
  CLI (`plan`/`check`/`enforce`), background daemon.
- Harnesses: Claude Code, Codex, Cursor, Gemini CLI, OpenCode.
- No parallel scheduling/planning.

Other enforcement players: **Prismor**, **Prempti** (Falco), **Cerbos**,
`roboticforce/agent-guardrails` (destructive-command blocking) — mostly
tool-call-level, some commercial.

**Critical signal:** agent-guardrails is feature-complete and MORE integrated
than us, yet has ~8 stars. The whole scope-enforcement category has weak PMF —
people aren't adopting these, likely because worktree-isolation is "good
enough" + the platform is absorbing it. Building a general MCP scope-enforcer
= re-implementing a zero-traction competitor. This is the exact "don't build
the commoditized thing" lesson the project already learned killing the LLM
planner (#0002, #0016).

## Where ScopeLock is still genuinely differentiated

Two narrow, real distinctions survive the scan — build ONLY around these:

1. **Real-time, pre-execution enforcement (not a merge-gate).** Our hook gate
   denies an out-of-scope edit at `PreToolUse` — *before* the write happens —
   already dogfooded live in real Claude Code/Cursor (#0014, #0029 H2).
   agent-guardrails is a *pre-merge* check (after the diff exists). For
   **autonomous / auto-mode loops** (Claude Code's proactive loops run without
   per-step human approval), real-time pre-block is the materially better fit:
   no human is there to catch a bad edit at merge time.
2. **Language-agnostic path-glob disjointness with picomatch-verified
   witnesses tied to the SAME matcher as the runtime gate** (M1 seam-closing).
   wit needs per-language AST; the worktree crowd does no proof at all;
   agent-guardrails has no scheduling. Our plan-parallel is the one
   deterministic, language-agnostic wave scheduler with a witness that the
   enforcement layer will match identically.

## Implication for the roadmap

- **Do NOT** build a general MCP scope-enforcer (clones agent-guardrails) or a
  standalone `scopelock run` (red ocean + platform) or an LLM planner
  (commoditized 3x).
- **Gate the MCP build behind a buy-vs-build spike** (below): actually use
  agent-guardrails + wit on real work; only build what we feel the lack of.
- **If we build**, scope the MCP server tightly to the two differentiators
  above, positioned for the platform's auto-mode/proactive loops — riding the
  platform, not fighting it.

## Sources

- [Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets](https://arxiv.org/html/2604.02460v1)
- [Beyond the Strongest LLM: Multi-Turn Multi-Agent Orchestration vs. Single LLMs](https://arxiv.org/pdf/2509.23537)
- [Single-Agent vs Multi-Agent Systems: When Coordination Helps, Hurts, and Pays Off](https://medium.com/@mjgmario/single-agent-vs-multi-agent-systems-when-coordination-helps-hurts-and-pays-off-57735ee7916d)
- [9 Open-Source Agent Orchestrators for AI Coding (2026) — Augment Code](https://www.augmentcode.com/tools/open-source-agent-orchestrators)
- [awesome-agent-orchestrators (andyrewlee)](https://github.com/andyrewlee/awesome-agent-orchestrators)
- [Conductor by Melty Labs](https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/)
- [Claude Squad](https://dev.to/stevengonsalvez/claude-squad-run-multiple-ai-agents-in-parallel-without-the-mess-1hfl)
- [logi-cmd/agent-guardrails](https://github.com/logi-cmd/agent-guardrails)
- [roboticforce/agent-guardrails](https://github.com/roboticforce/agent-guardrails)
- [Agentic Coding Hooks: Deterministic AI Guardrails](https://ranthebuilder.cloud/blog/agentic-coding-hooks-deterministic-ai-guardrails/)
- [Your AI Coding Agents Need Guardrails. Not the Kind You Think — Cerbos](https://www.cerbos.dev/blog/your-ai-coding-agents-need-guardrails-not-the-kind-you-think)
- [Introducing Prempti: Falco meets AI coding agents](https://falco.org/blog/introducing-prempti/)
