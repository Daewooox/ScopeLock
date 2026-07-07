# Активный контекст

## Текущий фокус
Задача #0027 — M3 review fixes ЗАВЕРШЕНА под контрактом `schedule-m3-review-fixes` (approve от `9dbdefe`). Независимое ревью #0025/#0026 нашло: (F-M3-1, обязательно) `--include-read-hazards` был мёртвым флагом - `loadTaskScope` никогда не заполняет `TaskScope.read`, флаг молча ничего не делал бы на M4-эксперименте - CLI-поверхность убрана (из `plan-parallel.ts`, `index.ts`, README), core `readHazards` не тронут (это M5-хук); (F-M3-2, желательно) `schedulePlanSchema` получил `.superRefine` на уникальность `task.id` - вместо невнятного runtime `UNEXPECTED` теперь чистый `INVALID_INPUT`; (F-M3-3/4, опционально, сделаны) `readJsonFile` различает `ENOENT` (`*_NOT_FOUND`) от прочих fs-ошибок (`FILE_READ_ERROR`); README поясняет, что `task.contract` резолвится относительно cwd. Core 46/46 (+1), CLI 9/9 (+2), `check-drift` = 0. Следующий шаг: M4 (мини-эксперимент H1-H5, go/no-go) - M5 (F2 read-write) не начинать раньше. Ранее: #0026 M3 `plan-parallel` CLI (`58ccb3b`/`9dbdefe`); #0025 Group A M1 polish; #0024 M1 prod fix (witness bound to picomatch); #0023 hardening release-gate; #0020 M2 scope-algebra scheduler; #0021 Windows CI path fix; #0022 CI actions cleanup; #0019 M1 `globsIntersect`.

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

## Следующие шаги
- M4: прогнать creative-мини-эксперимент (H1-H5, `orchestration-scope-algebra.md` §5.1) на реальном мульти-агентном сценарии с `plan-parallel`; зафиксировать go/no-go перед M5.
- M5 (read-hazard edges, F2 layered scheduling, cycle detection) не начинать до готового M4 reflection report.
- CHECKPOINT/validation: провести 5 быстрых интервью по Stage 0 script, затем добить до 10-15 и принять go/no-go перед полноценной Phase 4.
- Позже: реализовать настоящий repo manifest builder через git.
- Решить открытые вопросы round 2 (Codex CLI enforcement, Spec Kit interop, warn-only vs strict default).
- Использовать `plans/traycer-infrastructure-lessons.md` как ориентир при создании первого репозитория ScopeLock.
- Использовать `plans/traycer-repo-analysis.md` как архитектурное дополнение: harness registry, git schema, layered contract, quiet hooks.
- Stage 0 concierge validation с обязательным вопросом "почему не Spec Kit / Traycer".
- `/reflect` + `/archive` для задач #0001, #0002, #0003, #0004 и #0005 после проверки пользователем.
