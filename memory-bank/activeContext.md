# Активный контекст

<!-- TASK #0044 BEGIN
     Owner: codex
     Started: 2026-07-10T16:23Z
     Status: build
-->
## Текущий следующий шаг - Agent Environment Preflight Step 5

Agent Environment Preflight Steps 0-4 завершены. Решение Step 0 сохранилось:
**NO-GO** для собственного `scopelock agents apply` сейчас, **GO** для
read-only environment attestation. ScopeLock не копирует Ruler/skills CLI, а
проверяет, что нужные rules/skills/hook capability реально присутствуют перед
dispatch, и пишет hashes/provenance в bounded receipt.

**Step 5a ЗАВЕРШЁН** под контрактом `pilot-demo-codex-hook-verify`.
Добавлен one-command pilot demo `pnpm demo:pilot`, который без LLM/API создаёт
temp fixture и показывает весь end-to-end сценарий:
missing required skill → strict preflight block → skill fix → `scopelock run
--plan` с safe waves (`pilot-writer` затем `pilot-reader`) → Codex-format
`apply_patch` hook deny → receipt v3. Демо пишет `summary.json` и `receipt.json`
в `.scopelock/reports/pilot-demo/`.

Codex trust gap закрыт практическим live-подтверждением, а не статическим
угадыванием: добавлена команда `scopelock hooks verify --target codex`
(`--codex-bin`, `--timeout-ms`). Она запускает harmless `codex exec` probe,
проверяет, что forbidden `apply_patch` не мутировал файл и дал ScopeLock-deny,
затем сохраняет результат в `.scopelock/hook-verifications.json` с SHA-256
текущего `.codex/hooks.json`. `agents preflight` апгрейдит Codex hook confidence
до `live-verified` только при совпадающем passed record; иначе честно остаётся
`degraded`.

**Step 1 (production) ЗАВЕРШЁН** под контрактом `agent-env-preflight-core-step1`.
Добавлен read-only preflight core (pure, без commander/console/exit/network/мутаций):
`agents/paths.ts` (repo-relative safety), `schemas/agent-workspace.ts` (manifest v1 +
Zod report schema, duplicate/traversal reject, hookConfidence-заготовка под Step 3),
`agents/locations.ts` (единственный дом target-путей, shared `.agents/skills` first-class),
`agents/hash.ts` (SHA-256 raw bytes + детерминированный skill-dir digest), `agents/preflight.ts`
(`runAgentPreflight` → typed report: presence/symlink/parity, required=violation/optional=warn).
15 тестов зелёные; core 70/70, cli 19/19, mcp 3/3, typecheck чист; `check-drift` под контрактом = 0.
CLI/MCP не тронуты.

**Step 2 (production) ЗАВЕРШЁН** под контрактом `agent-env-preflight-cli-step2`.
Добавлена `scopelock agents preflight --manifest <path> [--target <id>] [--json]` -
тонкая обёртка над core: читает + Zod-валидирует манифест, опциональный
`--target` фильтрует с проверкой (`UNKNOWN_TARGET`), вызывает `runAgentPreflight`,
Zod-валидирует итоговый отчёт перед выводом. Human-вывод даёт per-target
status/rules/skills и per-violation `severity`/`detail`/`fix` (конкретная
`ruler`/`skills --copy` команда - ничего не выполняется). Exit `1` при
violations, `2` при операционных ошибках. +8 тестов (all-pass, missing-required,
missing-optional=warn, `--target`-фильтр, unknown-target, missing-manifest,
invalid-schema). core 70/70 (не менялся), cli **26/26 (+8)**, mcp 3/3, typecheck
чист, `check-drift`=0.

**Step 3a (production) ЗАВЕРШЁН** под контрактом `agent-env-hook-capabilities-step3`
— **сужен** после доп. проверки официальных доков Codex: JSON-схема
`.codex/hooks.json` НЕ задокументирована, `apply_patch` PreToolUse-событие
НЕ поймано вживую (Step 0 пробовал только `Bash`), project-trust негде
читаемо проверить статически. Строить hook-адаптер на угадывании = риск
тихо-неработающего enforcement. Поэтому реализовано ТОЛЬКО подтверждённое:
`harness/capabilities.ts` (номинальная `HookCapabilities` таблица, `confidence`
всегда `"documented"`, никогда `"live-verified"` автоматически; cursor
`canDeny: false` навсегда - Step 0 не смог его живо проверить), `agents/hook-probe.ts`
(чтение конфиг-файлов, без process exec; codex **всегда** `degraded`),
`TargetPreflightReport.hook` (аддитивное поле в Step 1/2 схеме), CLI human-вывод
получил hook-строку. +6 core + 1 CLI тест. core **76/76 (+21 итого)**, cli **27/27**,
mcp 3/3, typecheck чист, `check-drift`=0. Codex hook file adapter (install/uninstall,
парсинг реального события) **сознательно отложен** до отдельного live-суб-спайка
с настоящим Codex CLI. Побочная находка: `hooks install`
пишет файл, но всё равно репортит `NOT_INITIALIZED` без `scopelock init` первым.

**Step 3b + Step 4 ЗАВЕРШЕНЫ** под контрактом
`agent-env-codex-step3b-run-step4-v3`. Live Codex fixture поймал реальное
`apply_patch` PreToolUse event; trusted/bypassed Codex hook заблокировал 3/3
forbidden patch до записи, negative untrusted run подтвердил trust gap. В коде:
`codexScopeLockEntry`, `.codex/hooks.json` merge с сохранением foreign entries,
`hook gate --format codex`, extraction всех путей из native apply_patch payload,
`hooks install` больше не пишет partial hook до `NOT_INITIALIZED`. `scopelock run
--plan` теперь при наличии `.scopelock/agents.json` запускает preflight перед
dispatch; strict блокирует task commands и пишет receipt, warn продолжает, но
receipt получает `environment`. Receipt schema поднята до v3. Проверки:
`pnpm typecheck`, `pnpm build && pnpm -r test` (core 78/78, cli 30/30, mcp 3/3),
benchmark tests 7/7, live Codex-format hook smoke, `check-drift`=0,
`pnpm demo:flight-control` зелёный.

Основной отчёт: `memory-bank/plans/agent-environment-preflight-step3b-step4.md`.

**Следующий шаг:** записать короткое видео/demo script поверх `pnpm demo:pilot`
и провести design-partner pilot. Показывать не “ещё одну CLI”, а
end-to-end flight-control: missing skill blocks in strict, fix → preflight
pass/warn, safe waves, Codex apply_patch deny/live-verify, receipt v3 с
environment provenance.

**WalletAssignment demo Track B РЕАЛИЗОВАН**: добавлен `pnpm demo:wallet`.
Команда пробует клонировать `Daewooox/WalletAssignment`, а для тестов/записи без
сети имеет `--offline-fixture`. Сценарий: baseline `swift test` → missing skill
strict block → skill fix + `agents preflight` → safe waves
`[wallet-core-rules] -> [wallet-concurrency-tests, wallet-docs-demo]` → Codex
`Package.swift` hook deny → final `swift test` → final `check-drift` → receipt v3.
Проверено на real GitHub clone: все шаги PASS. Решение сохраняется: не строить
generic importer/runner/UI; это узкий demo harness для design-partner показа.

**WalletAssignment demo UX polish:** `pnpm demo:wallet -- --keep-fixture` теперь
пишет путь к сохранённому fixture и точные manual replay команды через локальный
`node packages/cli/dist/index.js`, чтобы ручной флоу не зависел от глобально
установленного `scopelock`. Summary JSON также содержит `manualCommands`.
<!-- TASK #0044 END -->

## Текущий фокус
Задача #0043 - bounded receipt spike ЗАВЕРШЕНА. `scopelock run --plan` теперь пишет receipt v2: в основном JSON остаются bounded previews command/stdout/stderr по 400 bytes, а полные raw command/stdout/stderr сохраняются локально рядом с receipt в `<receipt-name>-artifacts/` с bytes/sha256/previewBytes/truncated. Добавлен `handoffSummary`, `limits`, `artifactsDir`; analyzer теперь считает artifact bytes отдельно и извлекает Codex usage из raw stdout artifact. Измерения: deterministic demo receipt 6,657 bytes; real Codex K=1 `scopelock_run` receipt 15,191 bytes против baseline #0042 avg 30,306 bytes. Raw evidence сохранён вне receipt: commands 4,271 bytes, stdout 16,068 bytes, stderr 6,225 bytes. Decision: GO для bounded receipt v2; НЕ строить LLM summary/SQLite/FTS/command proxy до пользовательского сигнала. Отчёт: `memory-bank/plans/bounded-receipt-spike.md`.

Задача #0042 - one-command Flight Control demo + receipt baseline ЗАВЕРШЕНА. Добавлена команда `pnpm demo:flight-control`: без API/model она создаёт два temp fixture и сравнивает naive parallel execution с настоящим `scopelock run --plan`. Стабильный результат: without ScopeLock - 2 scope violations, 2 unresolved conflicts, 2 failed tests, 4/6 accepted; Flight Control - 0 violations, 0 unresolved conflicts, 2 prevented hazards, 0 failed tests, 5/6 accepted, `t4-tax-9` deferred. Новый stdlib-only analyzer считает UTF-8 bytes receipt по категориям и извлекает реальный Codex usage. Real Codex K=3 baseline: 0 violations/conflicts/failed tests, 5/6 accepted, avg wall-clock 48.2s, parallel factor 2.39x, avg receipt 30,306 bytes. Состав: stdout 58%, stderr 19%, command/prompt 13%, drift 6%, coordination 1%. Вывод: следующий spike - bounded receipt с raw stdout/stderr в локальных artifacts; без LLM-summary/SQLite/RTK clone. Отчёт: `memory-bank/plans/flight-control-demo-receipt-baseline.md`.

Задача #0041 - real-agent dogfood `scopelock run --plan` ЗАВЕРШЕНА. Existing Codex benchmark расширен режимом `scopelock_run`: task contracts + active run-level union contract, dry-run через `plan-parallel`, реальные `codex exec` commands, dispatcher receipt и K=3 metrics. Dogfood нашёл production bug: `runCommand` оставлял child stdin открытым, из-за чего Codex-процессы ждали EOF и зависали; оба spawn path исправлены на `stdio: ["ignore", "pipe", "pipe"]`, добавлен regression test (до фикса `ETIMEDOUT`, после pass). K=3 стабилен: 0 scope violations, 0 unresolved conflicts, 0 failed tests, 2 prevented hazards, 5/6 accepted, `driftStatus=ok`, одинаковые schedules/deferred `t4-tax-9`; avg wall-clock 58.1s, parallel factor 2.12x, receipt ~30.1 KB. Решение: GO для thin dispatcher/receipt, Codex preset пока не строить. Следующий продуктовый шаг - one-command demo + 5 Stage 0 интервью. Отчёт: `memory-bank/plans/scopelock-run-dogfood.md`.

Задача #0040 — Windows CI manifest root assertion ИСПРАВЛЕНА. Root cause: `repo manifest builder` test сравнивал сырой путь из Git for Windows (`D:/...`) с `fs.realpath` (`D:\\...`) через strict equality, хотя оба пути обозначают один каталог. Production-код не менялся; в `packages/core/src/manifest.test.ts` обе стороны нормализуются через `path.resolve`. Проверки: core 55/55, CLI 17/17, MCP 3/3, `pnpm -r build`, `pnpm typecheck`, `check-drift` = 0 violations. Контракт: `fix-windows-manifest-root-assertion`.

Задача #0039 — thin `scopelock run --plan` dispatcher prototype ЗАВЕРШЕНА. Реализован минимальный CLI-only слой `packages/cli/src/commands/run-plan.ts`: читает существующий `plan.json`, валидирует contracts, строит waves через существующий scheduler, по умолчанию учитывает read hazards, defer-ит одну сторону write-write conflict, запускает `command` из task по волнам, выполняет финальный `check-drift` (если не `--no-check-drift`) и пишет receipt JSON в `.scopelock/reports/run-*.json` или `--receipt`. Это НЕ generic runner: нет daemon, retry policy, agent registry, cloud/session management, leases, template language. Формат task расширен обратно-совместимо: `command` может быть shell string или argv array; старый `plan-parallel` это игнорирует. CLI tests: 17/17 pass. Следующий шаг: dogfood на ScopeLock/benchmark fixture и решить, нужен ли `--agent codex|claude|cursor` preset поверх raw `command`.

Задача #0038 — real-agent повтор benchmark-а на Codex CLI K=3 ЗАВЕРШЕНА. Добавлен `benchmarks/coordination/run-codex-real-agent-benchmark.mjs`, который создает temp fixture repos и запускает реальные `codex exec` subprocesses по 6 задачам в 3 режимах. Claude/Cursor CLI в PATH не найдены, поэтому они честно отмечены как blocked/unavailable. Результат K=3: `without_scopelock` — 2 applied scope violations avg, 2 unresolved conflicts avg, 1 failed test avg, 5/6 accepted, ~51.5s; `contracts_hooks` — 0 applied violations, но 2 unresolved conflicts avg и 1 failed test avg, 5/6 accepted, ~57.3s; `contracts_hooks_plan_parallel` — 0 violations, 0 unresolved conflicts, 2 detected/prevented conflicts, 0 failed tests, 5/6 accepted, ~74.3s, deferred `t4-tax-9`. Важное ограничение: для Codex это contract prompt + post-run metrics, НЕ true pre-write hook; hard hook story пока есть только для Claude/Cursor-style flows. Отчёт: `memory-bank/plans/real-agent-coordination-benchmark.md`.

Задача #0037 — Multi-Agent Coordination Benchmark ЗАВЕРШЕНА и закоммичена. Добавлен reproducible deterministic harness `benchmarks/coordination/run-benchmark.mjs`, который создает temp fixture repo с 6 scripted-agent задачами: 2 independent, 2 write-write conflict, 2 read-write hazard. Прогнаны 3 режима: `without_scopelock`, `contracts_hooks`, `contracts_hooks_plan_parallel`. Результат: без ScopeLock — 2 applied scope violations, 2 unresolved conflicts, 1 failed test, 4/6 accepted; contracts+hooks — 0 applied violations/2 blocked, но 2 unresolved conflicts и 1 failed test, 4/6 accepted; hooks+plan_parallel — 0 applied violations, 0 unresolved conflicts, 2 detected/prevented conflicts, 0 failed tests, 5/6 accepted, но wall-clock выше (260ms vs 91ms) из-за coordination/deferral. Вывод: Flight Control thesis получает первый механический proof: ScopeLock не обязательно быстрее на микро-fixture, но убирает хаос и дает clean merge-readiness. Отчёт: `memory-bank/plans/multi-agent-coordination-benchmark.md`.

Задача #0036 — SA research по run-оркестраторам и LLM-планировщикам ЗАВЕРШЕНА и закоммичена. Вывод: generic run-orchestrator и generic LLM planner строить НЕ надо. Run-оркестраторы на GitHub есть и решают session/worktree UX, но публичная доказательная база эффективности слабая; сильнее доказаны single-agent harnesses на SWE-bench, а multi-agent research поддерживает только узкую thesis для декомпозируемых задач с явной координацией. Рекомендация: ScopeLock должен стать **multi-agent flight-control / coordination proof layer** поверх любых runners: contracts, conflict graph, leases, live hooks/MCP, drift/test receipts, telemetry. Основной документ: `memory-bank/plans/orchestration-planner-github-analysis.md`.

Задача #0035 / Phase 4 M1 — deterministic repo manifest builder BUILD завершён и закоммичен; push только по явной просьбе. Реализован core builder `buildRepoManifest()` на `git ls-files` без чтения содержимого файлов: tracked files, packageManagers, projectTypes, testPaths, riskyPaths. Добавлена CLI-команда `scopelock manifest`, README-строка и component-map. Проверки: `pnpm -r build`, `pnpm -r test` (core 55/55, cli 15/15, mcp 3/3), `pnpm typecheck`, `check-drift` = 0 violations. LLM planner/API слой НЕ трогали.

Задача #0034 / Step 5.2 — live Codex MCP client validation завершена и закоммичена, push только по явной просьбе. Глобальный Codex MCP server `scopelock` зарегистрирован на `/opt/homebrew/bin/node packages/mcp/dist/index.js`. `codex exec --json` реально вызвал MCP server `scopelock`: `scopes_conflict` вернул `conflict:true`, `kind:"write-write"`, witness `config/.json`; `check_drift` вернул `ok:true`, active contract `mcp-live-client-validation-v2`, violations `0`; `plan_parallel` вернул `waves:[["t1-core","t2-cli","t3-docs"]]`, conflicts `[]`, cycles `[]`. Отчёт: `memory-bank/plans/mcp-live-client-validation.md`. Предыдущий Step 5.1: package `@scopelock/mcp` уже закоммичен (`3163092 feat: add narrow ScopeLock MCP server`), все build/test/typecheck/MCP SDK smoke прошли.

Задача #0034 — Step 5.0 buy-vs-build spike ЗАВЕРШЁН под контрактом `mcp-buy-vs-build-spike` (docs-only; конкурентные инструменты ставились/запускались только во внешних scratch-директориях `/tmp/scopelock-mcp-spike`; `packages/**` не тронуты). Вердикт: **GO, но только narrow MCP**. Kill-criterion НЕ сработал: `agent-guardrails@0.20.0` + `wit-protocol@0.1.3` закрывают большую часть finish-time/coordination story, но не дают одновременно (1) true pre-write deny и (2) language-agnostic wave scheduling с witnesses. Evidence: `agent-guardrails` зрелый CLI/MCP/daemon/adapters, но clean-run scope violation ловится после записи (`check`/daemon/PostToolUse/Stop/pre-commit), scheduler отсутствует; Wit даёт hard `LOCK_CONFLICT` для того же symbol string и intent overlap warnings, но не строит N-task waves, а parser/contract слой ограничен TS/JS/Python (JSON/YAML только string paths/locks). ScopeLock на том же полиглот fixture дал `plan-parallel` одну волну для TS+Python+JSON+YAML, witnesses для `config/**` conflicts, и `hook gate` strict exit 2 на PreToolUse-событии `config/settings.json` до записи. Основной документ: `plans/mcp-spike-verdict.md`. **Следующий шаг:** Step 5.1 можно строить только как тонкий `packages/mcp` вокруг `plan_parallel`/`scopes_conflict` + `check_drift`; НЕ строить общий MCP enforcer, daemon clone, `scopelock run`, LLM planner.

Задача #0033 — H3 real-agent measurement ЗАВЕРШЕНА под контрактом `h3-real-agent-docs` (docs-only; эксперимент в внешнем scratch-репо, продуктовый код не тронут). Запущены реальные субагенты (Agent tool, Sonnet, общий рабочий каталог — не worktree) по 3 непересекающимся задачам (1 волна): 13 субагент-запусков (par2/par3 parallel ms, seq1 true sequential, par1 pilot). **H1/H4 = GO** под реальными агентами (4 прогона, 0 коллизий, всё в scope, тесты зелёные, kill-criterion не сработал). **H3 speedup = ~1.5–2.0x (median ~1.8x)** на волне из 3 задач, ниже ~3x — причина: платформа стаггерит dispatch субагентов (стагтер 14.6–23.6s), НЕ contention (solo≈parallel per-task) и НЕ планировщик. Отвергнут наивный 3.2–3.8x (включал оркестраторную задержку между sequential-задачами). Продуктовый вывод: планировщик необходим, но недостаточен — нужен `scopelock run` для настоящего одновременного dispatch. Отчёт `plans/orchestration-h3-real-agents.md`; M5-validation H3-строка обновлена (proxy→real). Core/CLI не менялись. Ранее: #0032 `scopelock rebaseline`; #0031 fix-baseline-not-found; #0030 parallel-workflow guide.

Задача #0032 — SA-решение по протухшим baseline: команда `scopelock rebaseline` ЗАВЕРШЕНА под контрактом `add-rebaseline-command` (approve `f984f45`). SA-вывод: 7 архивных протухших baseline оставить (иммутабельность approved-контракта + не читаются), но закрыть actionability-дыру — текст `BASELINE_NOT_FOUND` из #0031 направлял на `approve`, который на существующем id падает `CONTRACT_ID_EXISTS`. Новый `scopelock rebaseline [<id>]` пере-анкорит baseline существующего контракта на HEAD (сохраняя id/task/scope/createdAt), текст ошибки исправлен на него. Core не трогали (команда на существующих экспортах). CLI 14/14 (+2), core 53/53, `check-drift` = 0. Глубокая робастность (tree-hash якорь / degraded-mode diff) — в бэклог. Плюс написан детальный SA-план H3 real-agent замера (`plans/orchestration-h3-real-agents-plan.md`, задача #0033 pending) — запуск параллельных субагентов по волнам, shared workdir (не worktree!), K прогонов с распределением, проверка H1/H4 под реальными агентами; честная оговорка что H2 (cross-process enforcement) этим не покрывается.

Задача #0031 — fix-baseline-not-found ЗАВЕРШЕНА под контрактом `fix-baseline-not-found` (approve `595c8ab`). Закрыта backlog-находка из #0030: `check-drift` при отсутствующем baseline-коммите (после rewrite истории) отдавал сырой `git fatal ...` как `UNEXPECTED`. Теперь: новый `commitExists(cwd, sha)` в `git/repo.ts`; preflight в `check-drift.ts` → типизированный `CliError("BASELINE_NOT_FOUND", ...)` с actionable-текстом (exit 2, не UNEXPECTED); `doctor.ts` отрефакторен на тот же `commitExists` (DRY, `runGit` убран). +1 CLI-тест (симуляция протухшего baseline). Подчищены 6 leaked approved-контрактов (`t1-core`..`t5-cycle-b`) из `.scopelock/contracts/` — дубли draft'ов из `examples/parallel/`, пример по-прежнему воспроизводится. Core 53/53, CLI 12/12, `check-drift` = 0. Стратегический контекст: пользователь выбрал №2 (робастность+чистка) из моего совета; №1 (реальный multi-agent dogfood для живого H3) обсуждён — могу запустить параллельные субагенты для тайминга+scope-проверки, но полноценный runtime hook-gate между независимыми UI-процессами за пользователем; npm publish осознанно не трогали.

Задача #0030 — интеграция parallel-workflow ЗАВЕРШЕНА (включая follow-up фиксы после rewrite истории). Движок (M1-M5) НЕ трогали.

**Основная работа** под `workflow-parallel-docs-v2`: живой прогон реальной 4-задачной цепочки (`t1-core`/`t2-cli`/`t3-docs`/`t4-tests`, последний с намеренным read-write хазардом через `--read`) через `contract new` → `approve` → `plan-parallel` (F1/F2, witness перепроверен напрямую `picomatch`) → `export-prompt`/`inject-contract` (честно задокументирован реальный UX-момент: работают только с единственным активным контрактом, нет `--contract <id>`) → `check-drift`; cycle/exit-1 сценарий тоже вживую. Guide `docs/parallel-workflow.md` + врезка в README + воспроизводимый `examples/parallel/`. Polish: human-текст cycles переформулирован (JSON-ключ не менялся), удалены просочившиеся approved-копии из M5.

**Follow-up (после того как по просьбе пользователя история была переписана `git filter-branch` + force-push для удаления `Co-Authored-By: Claude` из коммитов e355902..HEAD):** commit SHA поменялись у всех коммитов в этом диапазоне → часть contract baseline (пиннятся по SHA) стала невалидной. Дефект 1 (High): активный контракт держал мёртвый baseline → `check-drift` падал `UNEXPECTED`/raw git fatal - исправлено новым контрактом `workflow-parallel-docs-fix` (свежий baseline от живого HEAD), `check-drift --json` снова `status:ok`/`violations:[]`. Дефект 2 (Medium): `examples/parallel/plan.json` использовал cwd-relative пути к контрактам (`t1-core.json`), из-за чего документированная «из корня» команда падала `CONTRACT_NOT_FOUND` - исправлено на root-relative пути (`examples/parallel/t1-core.json`), README переписан на единственный документированный вариант «из корня» (вариант «из директории» убран целиком, не просто помечен, т.к. с новыми путями он реально ломается). Полная ревалидация Steps 1-5+3b `docs/parallel-workflow.md` в scratch-репо - всё совпало. Неактивные контракты с протухшим baseline (13 штук) намеренно не чинил - см. список в tasks.md #0030. Продуктовая находка про baseline+rewrite UX записана в бэклог (в этой итерации не реализовывать). Core 53/53, CLI 11/11 (не менялись), `check-drift` = 0. Ранее: #0029 M5 read-write F2; #0028 M4 мини-эксперимент (вердикт GO); #0027 M3 review fixes; #0026 M3 `plan-parallel` CLI; #0025 Group A M1 polish.

## Последние изменения
- Memory Bank инициализирован
- VAN: оценка сложности завершена.
- BUILD: выводы PM/Solution Architect ревью записаны в `projectbrief.md`, `productContext.md`, `techContext.md` и `plans/agent-preflight-strategy-review.md`.
- Задача #0002 (round 2 ревью): рыночная проверка выявила прямых конкурентов (Traycer, Spec Kit, Kiro); дифференциация смещена на deterministic drift check + hooks enforcement + MCP server. Основной документ: `plans/strategy-review-round2-market-corrections.md`.
- Задача #0004 (анализ Traycer repo, архитектурные паттерны; дополняет #0003): открыт только клиент/CLI/протокол, мозг закрыт. Взять паттерны: harness abstraction, git-schemas (эталон drift check), тихие hook-команды, layered contract. По стеку следовать #0003 (pnpm/Node/tsup). Документ: `plans/traycer-repo-analysis.md`.
- Задача #0003: анализ `traycerai/traycer` показал, что для ScopeLock стоит взять CLI/protocol/storage/CI практики, но не platform/desktop/host масштаб. Основной документ: `plans/traycer-infrastructure-lessons.md`.
- Задача #0005: создан стартовый pnpm/TypeScript скелет с `packages/core` Zod-схемами и `packages/cli` commander CLI. Проверки build/typecheck/test прошли.

## Последние изменения (продолжение)
- Задача #0006: записан утверждённый план реализации `plans/scopelock-implementation-plan.md` (фазы 0-7, checkpoint-gate после Phase 3, ключевые решения: baseline в контракте, exit-code контракт, warn-default hooks, LLM опционален, без web UI в v1).
- Задача #0008: реализован Phase 1 drift engine. Core получил parser porcelain v2, diff from baseline, collectChangedFiles, path/risk/test rules и buildDriftReport. CLI получил `approve`, настоящий `check-drift`, doctor проверяет active baseline.
- Задача #0009: реализован Phase 2. Core получил compile-time complete harness registry, prompt renderer и идемпотентный injector для marked doc section. CLI получил `export-prompt` и `inject-contract`.
- Задача #0010: реализован Phase 3. Core получил quiet/noop-safe hook gate, audit append, Claude/Cursor hook entries и idempotent hook config merge. CLI получил `hook gate`, `hook audit`, `hooks install/uninstall`; doctor проверяет hook entries.
- Задача #0011: checkpoint начат. Создан `plans/checkpoint-dogfood-validation.md`; local end-to-end workflow прошёл в temp git repo (strict gate exit 2, warn audit, drift exit 1). Self-dogfood на ScopeLock repo прошёл от baseline `47d2a8802b10903fe767fb3319d4adf79d24f337`: doctor ok, strict gate blocks forbidden, audit writes ndjson, planned check-drift clean.
- Задача #0019: реализован M1-spike `globsIntersect` для scope-algebra scheduler. Core получил conservative intersection witness + set intersection, matcher consistency с `picomatch`, property-soundness tests. `pnpm --filter @scopelock/core test` → 38/38 pass; `check-drift` по контракту `schedule-m1-glob-intersect` → 0 violations.
- Задача #0020: реализован M2 scope-algebra scheduler. Core получил conflict API, deterministic conflict graph, F1 write-write coloring scheduler и `schedulePlanSchema`. `pnpm test` → core 42/42 + cli 3/3 pass; `check-drift` по контракту `schedule-m2-conflict-graph` → 0 violations.
- Задача #0021: исправлен Windows CI storage layout test. Root cause: hardcoded POSIX expected path в тесте при runtime `node:path.join`. `pnpm test` → core 42/42 + cli 3/3 pass.
- Задача #0022: убраны GitHub Actions Node 20 warnings через обновление official actions до Node24-compatible major versions; `macos-latest` запинен на `macos-15`.
- Задача #0023: hardening M1 release-gate выявил баг witness: `*.ts` vs `test-*/**` даёт witness, который не матчится вторым glob под `picomatch`. Стоп-условие выполнено, production logic не менялась.
- Задача #0024: prod fix выполнен — `intersectionWitness` теперь генерирует кандидатов и валидирует их `picomatch`; disjoint возвращается только при исчерпании поиска, иначе консервативный intersect. F1/F2 по 10k зелёные, добавлены regression-тесты trailing-`**`.
- Задача #0025: Group A polish под контрактом `schedule-m1-polish`. `SCHEDULE_PLAN_SCHEMA_VERSION` константа + инвариант-комментарии в scheduler/scope-algebra/conflict-graph. Core 45/45, CLI 3/3, `check-drift` = 0.
- Задача #0026: Group B `plan-parallel` CLI под контрактом `schedule-m3-plan-parallel`. Новый `packages/cli/src/commands/plan-parallel.ts` + CLI wiring + 4 новых теста в `cli.test.ts` + строка в README. Core не менялся (только импорты). Core 45/45, CLI 7/7, `check-drift` = 0.
- Задача #0027: ревью-фиксы под контрактом `schedule-m3-review-fixes`. Убран мёртвый `--include-read-hazards` (F-M3-1); `schedulePlanSchema` теперь отвергает дубли `task.id` через `.superRefine` (F-M3-2); `readJsonFile` различает ENOENT/прочие fs-ошибки (F-M3-3); README поясняет резолвинг путей относительно cwd (F-M3-4). Core 46/46, CLI 9/9, `check-drift` = 0.
- Задача #0028: M4 мини-эксперимент под контрактом `orchestration-m4-experiment`. 4 реальных draft-контракта + `plan.json` в `.scopelock/experiments/`; `plan-parallel` дал 2 волны с одним верно разнесённым конфликтом. H1/H4/H5 = GO, H3 = GO качественно, H2 не тестировался. Итог: **GO** к M5. Отчёт `plans/orchestration-m4-experiment.md`.
- Задача #0029: M5 read-write F2 под контрактом `orchestration-m5-readwrite-scope2`. `readPathPatterns` в схеме, F2 layered scheduler (Kahn + coloring + cycle detection), CLI `--include-read-hazards` восстановлен + exit-код 1 для циклов. H2/H3 закрыты (live hook gate run + timed proxy ~2.0x). Core 53/53, CLI 11/11, `check-drift` = 0. Отчёт `plans/orchestration-m5-validation.md`.
- Задача #0030: интеграция parallel-workflow под контрактом `workflow-parallel-docs-v2`. Живой сквозной прогон (contract new → approve → plan-parallel → export-prompt/inject-contract → check-drift) на реальном 4-task сценарии; guide `docs/parallel-workflow.md` + пример `examples/parallel/`; polish human-текста cycles + чистка стрей-контрактов. Движок не менялся. Core 53/53, CLI 11/11, `check-drift` = 0.
- Задача #0030 (follow-up): после rewrite истории (`git filter-branch` + force-push, удаление Co-Authored-By) baseline активного контракта протух → `check-drift` падал UNEXPECTED. Исправлено новым контрактом `workflow-parallel-docs-fix` (свежий baseline). Плюс `examples/parallel/plan.json` не резолвился из корня репо (cwd-relative пути) - переписан на root-relative, README упрощён до единственного рабочего варианта. Полная ревалидация всех команд guide вживую. Продуктовая находка про baseline+rewrite UX - в бэклог.

## Следующие шаги
- **Текущий делегируемый следующий шаг:** dogfood `scopelock run --plan` на маленьком real/fixture сценарии с `command` tasks и receipt review; затем решить, нужен ли минимальный agent preset layer (`codex exec` command builder), или оставить raw commands до следующей validation.
- ~~Бэклог (продуктовая находка из #0030 follow-up): `check-drift` при отсутствующем baseline кидает сырую `git fatal` как `UNEXPECTED`.~~ **СДЕЛАНО в #0031** (`BASELINE_NOT_FOUND`) **+ #0032** (`scopelock rebaseline` для репары).
- Бэклог (глубокая робастность baseline, из SA-разбора #0032): provenance пиннится к commit SHA, который инвалидируют rebase/squash-merge/rewrite. `rebaseline` закрывает симптом; глубокий фикс — tree-hash как доп. якорь (переживает message-only rewrite) и/или degraded-mode diff против merge-base при отсутствующем baseline. Отдельный эпик со сменой схемы, НЕ реализован.
- ~~Задача #0033 (PENDING): H3 real-agent замер.~~ **СДЕЛАНО** — `plans/orchestration-h3-real-agents.md`. Вывод усилил аргумент за `scopelock run` (см. ниже).
- **СЛЕДУЮЩИЙ ШАГ (приоритет, делегируемый): MCP-сервер, competitively-informed.** Полное ТЗ: `plans/scopelock-implementation-plan.md` → «Phase 5 - MCP server === СЛЕДУЮЩИЙ ШАГ» + раздел «АКТУАЛЬНЫЙ ПЛАН». **Сперва обязательный buy-vs-build spike** (Step 5.0, docs-only): погонять `logi-cmd/agent-guardrails` + `wit`, записать вердикт в `plans/mcp-spike-verdict.md`; kill-criterion — если они покрывают ≥90%, НЕ строить. Причина: веб-скан 2026-07 (`plans/competitive-landscape-2026-07.md`) показал, что наш MCP-enforcer — near-clone `agent-guardrails` (~8★, zero traction); строить общий enforcer вслепую = ошибка. Строить ТОЛЬКО вокруг 2 дифференциаторов: real-time pre-tool-use deny (auto-mode) + language-agnostic glob-disjointness (`plan_parallel`).
- **НЕ строить** (по итогам скана): `scopelock run`-оркестратор (red ocean + платформа заходит), LLM-планировщик (коммодитизирован 3x), общий MCP scope-enforcer (клон agent-guardrails).
- Оркестрация (M1-M5) реализована, провалидирована (H1-H5 GO, H3 теперь на реальных агентах) и задокументирована сквозным guide (#0030). Иначе — вернуться к отложенным пунктам ниже (Stage 0 validation, repo manifest builder).
- CHECKPOINT/validation: провести 5 быстрых интервью по Stage 0 script, затем добить до 10-15 и принять go/no-go перед полноценной Phase 4.
- Позже: реализовать настоящий repo manifest builder через git.
- Решить открытые вопросы round 2 (Codex CLI enforcement, Spec Kit interop, warn-only vs strict default).
- Использовать `plans/traycer-infrastructure-lessons.md` как ориентир при создании первого репозитория ScopeLock.
- Использовать `plans/traycer-repo-analysis.md` как архитектурное дополнение: harness registry, git schema, layered contract, quiet hooks.
- Stage 0 concierge validation с обязательным вопросом "почему не Spec Kit / Traycer".
- `/reflect` + `/archive` для задач #0001, #0002, #0003, #0004 и #0005 после проверки пользователем.
