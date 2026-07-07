# Активный контекст

## Текущий фокус
Задача #0020 — M2 scope-algebra conflict graph + F1 scheduler реализована под контрактом `schedule-m2-conflict-graph`: core получил `TaskScope`/`ScopeConflict`, `scopesConflict`, deterministic `buildConflictGraph`, F1 write-write greedy coloring `schedule`, и `schedulePlanSchema` (`schemaVersion: 1`, `planId`, `tasks[]`). Release-gate M2 зелёный: `node --test packages/core/dist/schedule.test.js` → 8/8, `pnpm test` → core 42/42 + cli 3/3, `check-drift` → 0 violations. Задача #0021: исправлен Windows CI false negative в `schema.test.ts` (expected path теперь через `join`, production-код не менялся). Задача #0022: CI workflow обновлён на Node24-compatible actions (`checkout@v7`, `setup-node@v6`, `pnpm/action-setup@v6`) и `macos-15` вместо `macos-latest`. Следующий исполнимый шаг по плану: M3 `plan-parallel` CLI command (load plan JSON, load referenced contracts, derive `TaskScope`, build graph, schedule, print matrix/waves/witnesses; exit codes 0/1/2). Ранее: #0019 M1 `globsIntersect`; #0018 синхронизировала планы под делегирование; #0017 implementation-ready план Идеи A; #0016 creative-формализация scope-algebra; #0015 Trialable v0.1; #0014 live UI dogfood. Интервью Stage 0 сознательно отложены до более цепляющего v0.1; продуктовая ставка: оркестрация (Идея A) = 4-й слой moat и ответ на «почему не Spec Kit/Traycer». Housekeeping pending: .pnpm-store/ в .gitignore, решить нужно ли вернуть mode=strict глобально, закоммитить .claude/.cursor настройки от live-теста.

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

## Следующие шаги
- M3 scope-algebra CLI: `plan-parallel <plan.json> [--json]`, load referenced contracts, derive scopes, build graph, schedule, output matrix/waves/witnesses; exit 0 schedulable / 1 unschedulable / 2 bad input.
- CHECKPOINT/validation: провести 5 быстрых интервью по Stage 0 script, затем добить до 10-15 и принять go/no-go перед полноценной Phase 4.
- Позже: реализовать настоящий repo manifest builder через git.
- Решить открытые вопросы round 2 (Codex CLI enforcement, Spec Kit interop, warn-only vs strict default).
- Использовать `plans/traycer-infrastructure-lessons.md` как ориентир при создании первого репозитория ScopeLock.
- Использовать `plans/traycer-repo-analysis.md` как архитектурное дополнение: harness registry, git schema, layered contract, quiet hooks.
- Stage 0 concierge validation с обязательным вопросом "почему не Spec Kit / Traycer".
- `/reflect` + `/archive` для задач #0001, #0002, #0003, #0004 и #0005 после проверки пользователем.
