# Активный контекст

## Текущий фокус
Задача #0019 — M1-spike `globsIntersect` для scope-algebra scheduler реализована под контрактом `schedule-m1-glob-intersect`: core получил `packages/core/src/schedule/glob-intersect.ts` с `intersectionWitness`, `globsIntersect`, `globSetsIntersect` и conservative fallback для unsupported glob-конструкций; matcher-wrapper использует `picomatch.makeRe(..., { dot: true })`, чтобы scheduler не расходился с runtime path-rules. Release-gate M1 зелёный: known-pairs, 10 000 matcher-consistency cases против `picomatch`, 10 000 property-soundness glob pairs, `pnpm --filter @scopelock/core test` → 38/38 pass, `check-drift` → 0 violations. Следующий исполнимый шаг по плану: M2 conflict graph / schedule schemas поверх `globSetsIntersect` (не начинать M3+ до зелёных M2 unit-тестов). Ранее: #0018 синхронизировала планы под делегирование; #0017 зафиксировала implementation-ready план Идеи A; #0016 creative-формализация scope-algebra; #0015 Trialable v0.1; #0014 live UI dogfood. Интервью Stage 0 сознательно отложены до более цепляющего v0.1; продуктовая ставка: оркестрация (Идея A) = 4-й слой moat и ответ на «почему не Spec Kit/Traycer». Housekeeping pending: .pnpm-store/ в .gitignore, решить нужно ли вернуть mode=strict глобально, закоммитить .claude/.cursor настройки от live-теста.

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

## Следующие шаги
- M2 scope-algebra scheduler: build conflict graph / schedule schemas поверх `globSetsIntersect`; DoD: deterministic unit tests для disjoint/conflict graph + contract schema.
- После M2: M3 CLI/API для plan-parallel только при зелёном M2.
- CHECKPOINT/validation: провести 5 быстрых интервью по Stage 0 script, затем добить до 10-15 и принять go/no-go перед полноценной Phase 4.
- Позже: реализовать настоящий repo manifest builder через git.
- Решить открытые вопросы round 2 (Codex CLI enforcement, Spec Kit interop, warn-only vs strict default).
- Использовать `plans/traycer-infrastructure-lessons.md` как ориентир при создании первого репозитория ScopeLock.
- Использовать `plans/traycer-repo-analysis.md` как архитектурное дополнение: harness registry, git schema, layered contract, quiet hooks.
- Stage 0 concierge validation с обязательным вопросом "почему не Spec Kit / Traycer".
- `/reflect` + `/archive` для задач #0001, #0002, #0003, #0004 и #0005 после проверки пользователем.
