# Карта компонентов проекта

> **Назначение.** Маршрутизатор «файл → назначение по доменам». Главная экономия токенов: агент идёт сюда **до** любого `Glob`/`Grep`/`Read` по коду и часто находит нужный файл сразу.

> **Дополняется в `/reflect`.** После каждой задачи, где появились новые ключевые файлы — точечно дописывай нужный раздел. Не переписывай карту целиком.

> **Формат записи.** Таблица «Файл → Назначение, 5-12 слов на запись». Не сочинения, а сухие маршруты.

---

<!-- TODO: заполни вручную или запусти /mb-bootstrap. Шаблон ниже — пример, удали или замени. -->

## Пример: компоненты UI (`src/components/`)

| Файл | Назначение |
|------|-----------|
| `Button.jsx` | Базовая кнопка с вариантами primary/secondary/ghost |
| `Modal.jsx` | Модальное окно с backdrop, ESC-close, focus trap |

## Пример: страницы (`src/pages/` или `src/app/`)

| Файл | Назначение |
|------|-----------|
| `HomePage.jsx` | Лендинг с hero-секцией и CTA |

---

## ScopeLock packages

| Файл | Назначение |
|------|-----------|
| `packages/core/src/schemas/contract.ts` | Approved contract: baseline, scope (incl. `readPathPatterns`), nodes (type enum), risks, tests |
| `packages/core/src/schemas/drift.ts` | Drift report, changed file, violation types |
| `packages/core/src/schemas/repo-manifest.ts` | Repo manifest схема, projectType enum |
| `packages/core/src/schemas/config.ts` | `.scopelock/config.json` схема, mode warn/strict |
| `packages/core/src/manifest/build.ts` | Build repo manifest from tracked git files |
| `packages/core/src/storage/paths.ts` | Layout `.scopelock/` (единственный источник путей) |
| `packages/core/src/storage/atomic.ts` | writeJsonAtomic (temp + rename) |
| `packages/core/src/storage/contracts.ts` | save/load contract, active-pointer |
| `packages/core/src/git/exec.ts` | runGit sync-обёртка |
| `packages/core/src/git/repo.ts` | findRepoRoot, headSha, currentBranch, gitVersion, commitExists |
| `packages/core/src/git/status.ts` | Parser git status porcelain v2 -z |
| `packages/core/src/git/diff.ts` | Committed changes since approved baseline |
| `packages/core/src/drift/collect.ts` | Merge worktree and baseline changes |
| `packages/core/src/drift/engine.ts` | Build drift report and violations |
| `packages/core/src/rules/path-rules.ts` | Planned/forbidden/outside path classification |
| `packages/core/src/rules/risk-rules.ts` | High-risk file pattern violations |
| `packages/core/src/rules/test-heuristics.ts` | Required-test drift heuristic |
| `packages/core/src/harness/registry.ts` | Agent adapters, docFile, hook support |
| `packages/core/src/harness/claude-hooks.ts` | Claude Code ScopeLock hook entry |
| `packages/core/src/harness/cursor-hooks.ts` | Cursor ScopeLock audit hook entry |
| `packages/core/src/harness/hooks-merge.ts` | Idempotent install/uninstall hook configs |
| `packages/core/src/hook/gate.ts` | Fast hook gate/audit decision engine |
| `packages/core/src/render/prompt.ts` | Render contract into agent instructions |
| `packages/core/src/render/agents-md.ts` | Inject marked ScopeLock doc section |
| `packages/core/src/schedule/glob-intersect.ts` | Glob intersection witness for scheduler disjointness |
| `packages/core/src/schedule/scope-algebra.ts` | Task scopes and conflict witness API |
| `packages/core/src/schedule/conflict-graph.ts` | Deterministic write/read conflict graph builder |
| `packages/core/src/schedule/scheduler.ts` | F1 write-write coloring; F2 Kahn layered scheduling + cycle detection when readEdges present |
| `packages/core/src/schedule/plan.ts` | Zod schema for plan-parallel input |
| `packages/core/src/index.ts` | Public exports core package |
| `packages/core/src/schema.test.ts` | Schema + storage тесты (node:test) |
| `packages/core/src/drift.test.ts` | Drift parser/rules/integration tests |
| `packages/core/src/prompt.test.ts` | Harness prompt and injection tests |
| `packages/core/src/hook.test.ts` | Hook gate and config merge tests |
| `packages/core/src/schedule.test.ts` | Glob intersection property/consistency tests |
| `packages/core/src/manifest.test.ts` | Repo manifest builder tests |
| `packages/cli/src/index.ts` | Commander wiring, --json на подкомандах |
| `packages/cli/src/run.ts` | CommandResult, CliError, exit-code контракт 0/1/2 |
| `packages/cli/src/commands/init.ts` | init: mkdir, config, .scopelock/.gitignore, идемпотентен |
| `packages/cli/src/commands/doctor.ts` | Проверки severity/detail/fix |
| `packages/cli/src/commands/approve.ts` | Approve contract, stamp git baseline, activate |
| `packages/cli/src/commands/rebaseline.ts` | Re-anchor existing contract's baseline to current HEAD (repair stale baseline) |
| `packages/cli/src/commands/check-drift.ts` | Collect drift, write report, return violations |
| `packages/cli/src/commands/export-prompt.ts` | Print active contract as agent prompt |
| `packages/cli/src/commands/inject-contract.ts` | Inject contract into AGENTS/CLAUDE doc |
| `packages/cli/src/commands/hook.ts` | Quiet hook gate/audit CLI entrypoints |
| `packages/cli/src/commands/hooks.ts` | Install/uninstall agent hook configs |
| `packages/cli/src/commands/contract-new.ts` | Deterministic contract scaffolder (planned/forbidden/read globs, agents, tests) |
| `packages/cli/src/commands/plan-parallel.ts` | Load plan+contracts, build schedule, print waves/conflicts + cycles; `--include-read-hazards` enables F2, exit 1 on cycles |
| `packages/cli/src/commands/run-plan.ts` | Thin plan dispatcher: waves, commands, drift, receipt |
| `packages/cli/src/commands/manifest.ts` | Print deterministic tracked-file repo manifest |
| `packages/mcp/src/index.ts` | Stdio bootstrap for the narrow ScopeLock MCP server |
| `packages/mcp/src/tools.ts` | MCP adapters for plan_parallel, scopes_conflict, check_drift |
| `packages/mcp/src/tools.test.ts` | MCP tool unit tests over scheduler and drift behavior |
| `.github/workflows/test.yml` | CI: pnpm install, typecheck, build, test |
| `docs/parallel-workflow.md` | Guide: running N agents in parallel via plan-parallel (real commands/output) |
| `examples/parallel/` | Reproducible 4-task plan-parallel example (draft contracts, one-command repro) |
| `benchmarks/coordination/run-benchmark.mjs` | Deterministic multi-agent coordination benchmark harness |
| `benchmarks/coordination/run-codex-real-agent-benchmark.mjs` | Real Codex K-run benchmark incl. thin dispatcher dogfood |
| `benchmarks/coordination/run-codex-real-agent-benchmark.test.mjs` | Zero-run smoke test for real-agent harness |
| `benchmarks/coordination/analyze-receipt.mjs` | Measure receipt byte composition and Codex usage |
| `benchmarks/coordination/run-flight-control-demo.mjs` | One-command deterministic Flight Control demo |
| `memory-bank/plans/scopelock-run-dogfood.md` | K=3 dispatcher dogfood evidence and SA decision |
| `memory-bank/plans/flight-control-demo-receipt-baseline.md` | Demo and full-receipt K=3 baseline evidence |

---

## Когда дополнять карту

- В задаче появился **новый ключевой файл** (компонент, хук, утилита, страница).
- Существующий файл получил **существенное изменение поведения**, которое влияет на будущие задачи.
- НЕ дополняй: для каждой строки кода, для тривиальных изменений, для one-shot правок.

## Когда заводить новый раздел

- Появился **новый домен** (новая папка в `src/`, новая область проекта).
- Раздел не должен быть размером с роман — если разрастается, дроби на под-разделы.
