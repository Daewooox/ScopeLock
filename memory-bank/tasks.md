# Активные задачи

<!-- BOOTSTRAP NEEDED:
     Если в проекте уже есть код — запусти /mb-bootstrap для первичного сканирования.
     Если проект новый — заполни projectbrief.md и запусти /van <описание задачи>.
-->

---

*Готов к новой задаче.*

<!-- TASK #0001 BEGIN
     Owner: codex
     Started: 2026-07-04T11:59Z
     Status: build
-->
## Задача #0001 — Зафиксировать стратегическое ревью AgentPreflight

- **Описание:** Записать в Memory Bank выводы глубокого анализа плана Visual Pre-flight Review for AI Coding Agents: продуктовая стратегия, неточности, риски, архитектурные варианты и реализационный путь.
- **Уровень сложности:** Level 2
- **Дата начала:** 2026-07-04
- **Статус:** VAN завершён; материалы ревью записаны в memory-bank.

### Оценка
- Затронутые файлы:
  - `memory-bank/projectbrief.md`
  - `memory-bank/productContext.md`
  - `memory-bank/techContext.md`
  - `memory-bank/plans/agent-preflight-strategy-review.md`
  - `memory-bank/activeContext.md`
- Ключевые зависимости: исходный PDF `visual_agent_preflight_strategy.pdf`, рыночный контекст Codex/Cursor/Claude Code/GitHub Copilot coding agents.
- Риски:
  - Не позиционировать продукт как generic AI diagram generator.
  - Не откладывать Plan-vs-Actual слишком поздно, иначе moat слабый.
  - Не строить SaaS-only MVP без privacy/local-first режима.
  - Не полагаться на LLM-inference по одному `repo tree` без evidence/confidence/path rules.
<!-- TASK #0001 END -->

<!-- TASK #0002 BEGIN
     Owner: cursor-agent
     Started: 2026-07-04T12:10Z
     Status: build
-->
## Задача #0002 — Round 2 ревью стратегии: рыночные поправки и enforcement

- **Описание:** Глубокое PM + Solution Architect ревью PDF `visual_agent_preflight_strategy.pdf` с проверкой рыночных утверждений (июль 2026). Ключевая поправка: ниша "plan before agent" уже занята (Traycer, GitHub Spec Kit ~117k stars, AWS Kiro); дифференциация смещена на deterministic drift check + enforcement через agent hooks + MCP server + mobile templates.
- **Уровень сложности:** Level 2
- **Статус:** BUILD завершён; выводы записаны.

### Изменённые файлы
- `memory-bank/plans/strategy-review-round2-market-corrections.md` (новый, основной документ)
- `memory-bank/projectbrief.md` (конкурентный контекст, принцип layered enforcement)
- `memory-bank/productContext.md` (домен 5 Contract Enforcement, принцип "не продавать план")
- `memory-bank/techContext.md` (§11 Contract Compiler / Enforcement, обновлённый pipeline)

### Ключевые решения
- Продаём deterministic guardrails, не visual plan (plan-генерация коммодитизирована OSS).
- Contract Compiler + hooks (Claude Code first) входят в MVP; Cursor deny-баг учтён.
- MCP server предпочтительнее раннего IDE extension.
- Валидация Stage 0 обязана включать вопрос "почему не Spec Kit / Traycer".
<!-- TASK #0002 END -->

<!-- TASK #0004 BEGIN
     Owner: cursor-agent
     Started: 2026-07-05T19:00Z
     Status: build
-->
## Задача #0004 — Анализ репо Traycer: паттерны протокола/git/harness для ScopeLock

- **Описание:** Проанализирован открытый репозиторий traycerai/traycer (Apache 2.0) на предмет переиспользуемых архитектурных паттернов. Дополняет задачу #0003 (codex, инженерные практики) со стороны protocol/git-схем/harness abstraction. Номер #0004, т.к. #0003 параллельно занят codex.
- **Уровень сложности:** Level 2
- **Статус:** BUILD завершён; выводы записаны.

### Ключевые находки
- Открыт только клиент/CLI/протокол; "мозг" (planning/verification host + cloud) закрыт - скопировать бизнес-логику нельзя.
- Полезные паттерны: harness abstraction (единый enum агентов), git-schemas.ts (эталон для drift check: rename/binary/repo-state/degraded mode), layered agent-selection-guide, тихие отказоустойчивые hook-команды, versioned RPC.
- Стек: по вопросу monorepo следую рекомендации #0003 (pnpm/Node/tsup, без Bun/Nx на старте); из Traycer зеркалю только версии библиотек (Zod 4, commander, при UI - Vite/React).
- Решение: ScopeLock CLI-first, локальный процесс вместо cloud, Zod-схемы first, harness registry с первого дня.

### Изменённые файлы
- `memory-bank/plans/traycer-repo-analysis.md` (новый; дополняет `traycer-infrastructure-lessons.md`)
<!-- TASK #0004 END -->

<!-- TASK #0003 BEGIN
     Owner: codex
     Started: 2026-07-05T18:54Z
     Status: build
-->
## Задача #0003 — Зафиксировать инфраструктурные уроки из Traycer для ScopeLock

- **Описание:** Проанализировать репозиторий `traycerai/traycer` и записать, какие инженерные практики стоит взять для ScopeLock, а какие элементы Traycer не нужны для solo MVP.
- **Уровень сложности:** Level 2
- **Дата начала:** 2026-07-05
- **Статус:** BUILD завершён; выводы записаны.

### Изменённые файлы
- `memory-bank/plans/traycer-infrastructure-lessons.md` (новый основной документ)
- `memory-bank/projectbrief.md` (название ScopeLock и инфраструктурный принцип)
- `memory-bank/productContext.md` (принцип small scriptable devtool, не платформа)
- `memory-bank/techContext.md` (CLI runner, JSON/NDJSON, core package, storage, doctor, CI)
- `memory-bank/activeContext.md` (актуальный фокус и следующие шаги)

### Ключевые решения
- ScopeLock должен быть маленьким local-first CLI/MCP tool, а не Traycer-like platform.
- Взять из Traycer engineering patterns: typed contracts, schema validation, machine-readable CLI, local storage, doctor diagnostics, security CI.
- Не брать: Electron desktop, host daemon, auth/cloud sync/collaboration, workspaces/boards, agent orchestration, Nx/Bun complexity на старте.
<!-- TASK #0003 END -->

<!-- TASK #0005 BEGIN
     Owner: codex
     Started: 2026-07-05T19:12Z
     Status: build
-->
## Задача #0005 — Стартовый скелет ScopeLock

- **Описание:** Собрать стартовый TypeScript/pnpm скелет проекта: `packages/core` со схемами contract/drift/repo-manifest на Zod и `packages/cli` с commander CLI.
- **Уровень сложности:** Level 2
- **Дата начала:** 2026-07-05
- **Статус:** BUILD завершён; скелет создан и проверен.

### Изменённые файлы
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- `packages/core/package.json`, `packages/core/tsconfig.json`
- `packages/core/src/contract.ts`, `drift.ts`, `repo-manifest.ts`, `index.ts`, `schema.test.ts`
- `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/index.ts`
- `memory-bank/docs/component-map.md`, `memory-bank/activeContext.md`

### Проверки
- `pnpm install`
- `pnpm typecheck` (с bundled Node в PATH в текущем Codex окружении)
- `pnpm build` (с bundled Node в PATH)
- `pnpm test` (с bundled Node в PATH)
- `node packages/cli/dist/index.js --help`
- `node packages/cli/dist/index.js --json doctor`
- `node packages/cli/dist/index.js --json check-drift`
<!-- TASK #0005 END -->

<!-- TASK #0006 BEGIN
     Owner: cursor-agent
     Started: 2026-07-05T19:25Z
     Status: plan
-->
## Задача #0006 — Технический план реализации ScopeLock v1

- **Описание:** Tech Director / Solution Architect ревью скелета #0005 и детальный план реализации по фазам 0-7: hardening, git drift engine (moat), harness registry + prompt export, enforcement hooks, checkpoint-gate, LLM planner, MCP server, templates + Mermaid, дистрибуция.
- **Уровень сложности:** Level 3 (план); реализация фаз - отдельные задачи.
- **Статус:** PLAN завершён; документ записан.

### Основной документ
- `memory-bank/plans/scopelock-implementation-plan.md`

### Ключевые решения
- Contract получает `baseline.headSha` при approve; drift считается от baseline + worktree.
- Exit-code контракт CLI: 0 clean / 1 violations / 2 error (CI/hooks-friendly).
- Hook gate: <100ms, тихий, noop-safe; default mode warn, strict опционально.
- LLM-planner опционален (manual mode без API key); наружу уходит только manifest путей.
- Web UI в v1 не делаем: Mermaid в Markdown. Checkpoint-gate после Phase 3 до фаз 4-6.
<!-- TASK #0006 END -->

<!-- TASK #0007 BEGIN
     Owner: cursor-agent
     Started: 2026-07-05T19:40Z
     Status: build
-->
## Задача #0007 — Phase 0 hardening + исполнимый план v2

- **Описание:** Архитектурные правки скелета (Phase 0 из плана #0006) и переработка плана реализации до уровня, исполнимого младшим разработчиком/агентом.
- **Уровень сложности:** Level 2
- **Статус:** BUILD завершён; build + 8/8 тестов + smoke в реальном git-репо проверены (через ELECTRON_RUN_AS_NODE, т.к. node отсутствовал в PATH).

### Изменения в коде
- core реструктурирован: `schemas/` (contract с baseline + nodeType enum + config), `storage/` (paths, atomic, contracts), `git/` (exec, repo).
- CLI разложен: `run.ts` (CliError, exit-контракт 0/1/2), `commands/{init,doctor,check-drift}.ts`; `--json` через optsWithGlobals; doctor с severity/fix; check-drift кидает честный NOT_IMPLEMENTED.
- `.scopelock/.gitignore` генерируется в init (contracts коммитятся, reports/active нет).
- Root: engines node>=22; `.github/workflows/test.yml`.
- Переименование: `repoConfigSchema` -> `scopelockConfigSchema` (согласовано с использованием в CLI).

### План
- `plans/scopelock-implementation-plan.md` переписан в v2: инварианты исполнителя, пофазные сигнатуры функций, алгоритмы (porcelain v2, precedence правил, merge hooks), обязательные списки тестов, DoD-чеклисты, checkpoint-gate.
<!-- TASK #0007 END -->

<!-- TASK #0012 BEGIN
     Owner: cursor-agent
     Started: 2026-07-05T20:55Z
     Status: reflect
-->
## Задача #0012 — Solution Architect ревью Phase 0-3

- **Описание:** Полное чтение кода core+cli после фаз 0-3, прогон тестов и живая проверка hook gate против активного контракта.
- **Уровень сложности:** Level 2
- **Статус:** REVIEW завершён; фиксы R1-R5 применены через новый контракт `phase3-review-fixes` (approve от HEAD e028fd6). 30/30 тестов pass, check-drift = 0 violations.

### Проверено
- Прочитан весь код core (git-парсеры, drift engine, rules, hook gate, harness, render) и cli.
- Вне песочницы: 27/27 core tests pass, 0 fail, 10 suites.
- Живой hook gate (strict): forbidden -> exit 2, outside_scope -> exit 2, in-scope -> exit 0. Продукт корректно ловит собственные out-of-scope правки.

### Findings (детали в plans/scopelock-implementation-plan.md -> Review Phase 0-3)
- R1 bug: имя drift-отчёта с `:` невалидно на Windows.
- R2 quality: часть high-risk паттернов не ловит nested пути.
- R3 robustness: readStdin виснет на TTY.
- R4 DX: hooks install без config кидает сырой ENOENT.
- R5 minor: numstat без -M -C.

### Разрешение (workflow контракта дожат до конца)
Заведён контракт `phase3-review-fixes` (planned scope на 5 файлов + tests + memory-bank,
forbidden на schemas/** и core/hook/**), approve от HEAD, затем применены фиксы:
- R1: `driftReportFileName()` в storage/paths.ts + использование в check-drift.ts (имя без `:`).
- R2: high-risk паттерны переведены на `**/`-префиксы (nested `.env`, `Package.swift`, lockfiles).
- R3: `readStdin` guard по `process.stdin.isTTY` -> "" (noop вместо зависания).
- R4: `hooks install` без config -> CliError NOT_INITIALIZED "run scopelock init".
- R5: numstat получил `-M -C` (консистентно с name-status).
Тесты: +3 (R1 filename, R2 nested hit, R2 negative). Итог 30/30 pass, typecheck чист,
check-drift под новым контрактом = 0 violations, отчёт `drift-...T20-55-27.373Z.json` без `:`.
<!-- TASK #0012 END -->

<!-- TASK #0013 BEGIN
     Owner: cursor-agent
     Started: 2026-07-05T21:15Z
     Status: build
-->
## Задача #0013 — Phase 3.5 distribution unblocker

- **Описание:** Разблокировать live-инвокацию хуков и подготовить CLI к npm, соблюдая контрактную дисциплину.
- **Уровень сложности:** Level 2
- **Статус:** Сделано под контрактом `phase3.5-distribution` (approve от 1bd2512). 31/31 тестов pass, check-drift = 0 violations.

### Сделано
- D1: `hooks install --local` прошивает абсолютную команду `${execPath} "<abs>/index.js"` (кавычки - пробелы в пути). commandPrefix проброшен через claude/cursor entry + merge + installHooks. `isOwnEntry` теперь по `hook gate`/`hook audit` (чтобы --local entries распознавались при uninstall). Проверено live: exit 2 на forbidden без глобального scopelock.
- D2: `packages/cli/package.json` - description/license/files для npm.
- D3: root `.gitignore` больше не глотает весь `.scopelock/` - контракты и config снова версионируются (reproducible baseline); игнорируются только reports/ и active.
- +1 unit-тест на custom --local prefix.

### Дальше (checkpoint-gate, до Phase 4)
- Live invocation в реальных Claude Code / Cursor UI (пользователь).
- 5 -> 10-15 интервью Stage 0, go/no-go.
<!-- TASK #0013 END -->

<!-- TASK #0008 BEGIN
     Owner: codex
     Started: 2026-07-05T19:50Z
     Status: build
-->
## Задача #0008 — Phase 1 drift engine для ScopeLock

- **Описание:** Реализовать Phase 1 из `plans/scopelock-implementation-plan.md`: parser `git status --porcelain=v2 -z`, committed diff from baseline, `collectChangedFiles`, path/risk/test rule engine, CLI `approve` и реальный `check-drift`.
- **Уровень сложности:** Level 3
- **Статус:** BUILD завершён; проверки через Electron-as-Node зелёные.

### Изменённые файлы
- `packages/core/src/git/{exec,status,diff}.ts`
- `packages/core/src/drift/{collect,engine}.ts`
- `packages/core/src/rules/{path-rules,risk-rules,test-heuristics}.ts`
- `packages/core/src/drift.test.ts`
- `packages/core/package.json`
- `packages/cli/src/commands/{approve,check-drift,doctor}.ts`
- `packages/cli/src/index.ts`
- `memory-bank/docs/component-map.md`

### Проверки
- `tsc -p packages/core/tsconfig.json` через `ELECTRON_RUN_AS_NODE=1`
- `tsc -p packages/cli/tsconfig.json` через `ELECTRON_RUN_AS_NODE=1`
- `Cursor --test packages/core/dist/*.test.js` → 15/15 pass
- Smoke: `init -> approve -> check-drift` в temp git repo, `check-drift` вернул exit 1 с `forbidden_path`, `outside_scope`, `high_risk_file`, `missing_tests`.
- Smoke: `doctor --json` после approve проверяет active baseline через `git cat-file -e`.
<!-- TASK #0008 END -->

<!-- TASK #0009 BEGIN
     Owner: codex
     Started: 2026-07-05T20:10Z
     Status: build
-->
## Задача #0009 — Phase 2 harness registry + prompt export

- **Описание:** Реализовать Phase 2 из `plans/scopelock-implementation-plan.md`: typed harness registry, renderAgentPrompt, идемпотентная вставка ScopeLock-секции в agent doc, CLI `export-prompt` и `inject-contract`.
- **Уровень сложности:** Level 2
- **Статус:** BUILD завершён; проверки через Electron-as-Node зелёные.

### Изменённые файлы
- `packages/core/src/harness/registry.ts`
- `packages/core/src/render/{prompt,agents-md}.ts`
- `packages/core/src/prompt.test.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/commands/{export-prompt,inject-contract}.ts`
- `packages/cli/src/index.ts`
- `memory-bank/docs/component-map.md`

### Проверки
- `tsc -p packages/core/tsconfig.json` через `ELECTRON_RUN_AS_NODE=1`
- `tsc -p packages/cli/tsconfig.json` через `ELECTRON_RUN_AS_NODE=1`
- `Cursor --test packages/core/dist/*.test.js` → 22/22 pass
- Smoke: `init -> approve -> export-prompt --target codex` содержит required sections.
- Smoke: `inject-contract --target codex` дважды даёт идентичный `AGENTS.md` и сохраняет внешний текст вне маркеров.
<!-- TASK #0009 END -->

<!-- TASK #0010 BEGIN
     Owner: codex
     Started: 2026-07-05T20:30Z
     Status: build
-->
## Задача #0010 — Phase 3 enforcement hooks

- **Описание:** Реализовать Phase 3 из `plans/scopelock-implementation-plan.md`: quiet/noop-safe `scopelock hook gate`, audit mode, Claude/Cursor hook config generators, idempotent install/uninstall, doctor-проверки hook entries.
- **Уровень сложности:** Level 3
- **Статус:** BUILD завершён; live dogfood в настоящих Claude Code/Cursor остаётся checkpoint-шагом.

### Изменённые файлы
- `packages/core/src/hook/gate.ts`
- `packages/core/src/harness/{claude-hooks,cursor-hooks,hooks-merge}.ts`
- `packages/core/src/hook.test.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/commands/{hook,hooks,doctor}.ts`
- `packages/cli/src/index.ts`
- `memory-bank/docs/component-map.md`

### Проверки
- `tsc -p packages/core/tsconfig.json` через `ELECTRON_RUN_AS_NODE=1`
- `tsc -p packages/cli/tsconfig.json` через `ELECTRON_RUN_AS_NODE=1`
- `Cursor --test packages/core/dist/*.test.js` → 27/27 pass
- Smoke: `hooks install --target claude --mode strict` идемпотентен и не дублирует entries.
- Smoke: `hook gate` на forbidden path в strict возвращает exit 2, stderr содержит deny-message, stdout пустой.
- Smoke: `hook audit` пишет `.scopelock/reports/audit.ndjson` и не блокирует.
- Bench: 1000 вызовов `evaluateHookGate` в одном процессе, p95 ≈ 0.2ms.
<!-- TASK #0010 END -->

<!-- TASK #0011 BEGIN
     Owner: codex
     Started: 2026-07-05T20:50Z
     Status: build
-->
## Задача #0011 — CHECKPOINT dogfood + Stage 0 validation

- **Описание:** Начать checkpoint после Phase 3: проверить полный local-first workflow без LLM, зафиксировать go/no-go критерии перед Phase 4-6 и подготовить validation script против Spec Kit / Traycer.
- **Уровень сложности:** Level 3
- **Статус:** BUILD частично завершён: local dogfood и self-dogfood на ScopeLock repo пройдены; live UI dogfood в настоящих Claude Code/Cursor и внешние интервью pending.

### Изменённые файлы
- `memory-bank/plans/checkpoint-dogfood-validation.md`
- `memory-bank/tasks.md`
- `memory-bank/activeContext.md`
- `memory-bank/plans/scopelock-implementation-plan.md`

### Проверки
- Local temp git repo: `init -> approve -> export-prompt -> inject-contract`.
- Strict hook gate на forbidden path вернул exit `2`.
- Warn hook gate написал `audit.ndjson`.
- Manual drift + `check-drift --json` вернул exit `1`.
- Self-dogfood ScopeLock repo: `doctor --json` ok, strict forbidden gate exit `2`, planned gate quiet exit `0`, audit wrote ndjson, `check-drift --json` exit `0` with 0 violations for planned `AGENTS.md` + hook config changes.
<!-- TASK #0011 END -->
