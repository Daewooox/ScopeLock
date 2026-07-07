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

<!-- TASK #0014 BEGIN
     Owner: cursor-agent
     Started: 2026-07-07T21:56Z
     Status: build
-->
## Задача #0014 — Live UI dogfood: Claude Code + Cursor (закрывает часть #0011)

- **Описание:** Реальная (не CLI-симулированная) проверка хуков в настоящих Claude Code и Cursor UI после Phase 3.5 (`hooks install --local`).
- **Уровень сложности:** Level 1
- **Статус:** Пройдено. Первый пункт checkpoint-gate из #0011 ("live invocation в настоящих Claude Code/Cursor UI") закрыт.

### Claude Code (strict, --local)
- `hooks install --target claude --mode strict --local` → `.claude/settings.json` получил абсолютную команду `node "<abs>/dist/index.js" hook gate`.
- Промпт "измени packages/core/src/schemas/contract.ts" (forbidden) → PreToolUse denied, файл НЕ изменён (подтверждено `git status` - нет диффа), Claude вежливо сообщил о блокировке и спросил про расширение scope вместо падения.
- Промпт "добавь строку test в memory-bank/tasks.md" (planned) → прошло, строка добавлена.
- Deny в strict корректно НЕ пишет audit.ndjson (это поведение только warn) - подтверждено.

### Cursor (warn, --local)
- `hooks install --target cursor --mode warn --local` → `.cursor/hooks.json` абсолютная команда `hook audit`.
- Живая правка кодового файла вне scope (agent edit через Cursor) → `afterFileEdit` сработал, `.scopelock/reports/audit.ndjson` получил новую строку `verdict: warn, reason: outside` с реальным таймстампом, правка не блокировалась.

### Вывод
Runtime enforcement подтверждён в обоих реальных UI, не только в CLI-эмуляции. Остаётся перед Phase 4: 5→10-15 интервью Stage 0 + go/no-go (см. #0011, #0013).
<!-- TASK #0014 END -->

<!-- TASK #0015 BEGIN
     Owner: cursor-agent
     Started: 2026-07-07T20:10Z
     Status: build
-->
## Задача #0015 — Trialable v0.1 (шаги из SA-ревью)

- **Описание:** Довести проект до состояния «можно дать пощупать»: onboarding-доки, детерминированный скаффолдер контрактов, наблюдаемость ошибок хука, компактные ошибки, конфигурируемый порог, npm-подготовка, кросс-ОС CI и integration-тесты. Интервью со внешними бета-дев-пользователями сознательно отложены (продукт ещё сырой).
- **Уровень сложности:** Level 2
- **Статус:** BUILD завершён под контрактом `trialable-v0.1-2026-07-07` (approve от d583fff). core 34/34 + cli 3/3 pass, typecheck чист, check-drift = только ожидаемый `high_risk_file` на CI (нет нарушений scope).

### Сделано
- P1/P4: `README.md` (60-секундный quickstart, таблица команд, exit-коды, `--local`, layout `.scopelock/`) + `LICENSE` (MIT).
- P2: `scopelock contract new` - детерминированный скаффолдер (без LLM). Пайпится в stdout или `--out <file>`, вывод валидируется `approvedContractSchema`. Повторяемые `--planned/--forbidden/--agent/--test`.
- A1: hook gate при внутренней ошибке пишет `.scopelock/reports/hook-errors.ndjson` (best-effort, никогда не роняет агента) вместо тихого noop.
- A4: `formatZodError()` в core - однострочные path-ориентированные ошибки; `run.ts` отдаёт `INVALID_INPUT` вместо JSON-простыни.
- A5: `degradedFileThreshold` в config (default 10000), проброшен в `collectChangedFiles`.
- P3: npm-подготовка обоих пакетов (`files`, `repository`, `publishConfig.access=public`, `prepublishOnly`). Публикация требует npm-логина пользователя (порядок: core → cli).
- A2: CI-матрица ubuntu/windows/macos × Node 22/24.
- A3: CLI integration-тесты (`packages/cli/src/cli.test.ts`): init→contract new→approve→check-drift, exit-коды 0/1/2, no-git.

### Изменённые файлы
- `README.md`, `LICENSE`
- `packages/core/src/{format.ts,index.ts}`, `schemas/config.ts`, `drift/collect.ts`, `hook/gate.ts`, `schema.test.ts`, `hook.test.ts`
- `packages/cli/src/{index.ts,run.ts}`, `commands/{contract-new.ts,check-drift.ts}`, `cli.test.ts`
- `packages/core/package.json`, `packages/cli/package.json`
- `.github/workflows/test.yml`

### Осознанно отложено
- P5 per-harness mode (шаг 3 «если go»).
- Интервью Stage 0 (перенесены до готовности v0.1 к демонстрации).
<!-- TASK #0015 END -->

<!-- TASK #0016 BEGIN
     Owner: cursor-agent
     Started: 2026-07-07T20:30Z
     Status: creative
-->
## Задача #0016 — CREATIVE: scope-algebra для parallel-safe оркестрации (Идея A)

- **Описание:** Формализовать Идею A - вывод доказуемо parallel-safe расписания для нескольких агентов из glob-scope контрактов (formal-language disjointness → conflict graph → graph coloring → волны), с runtime hook gate как backstop. Плюс объяснение идей B/C и как их миксовать.
- **Уровень сложности:** Level 3 (design/creative; реализация отдельно, за checkpoint-gate).
- **Статус:** CREATIVE завершён; документ записан. Реализация НЕ начата (docs-only фаза).

### Основной документ
- `memory-bank/plans/orchestration-scope-algebra.md`

### Ключевые решения
- Scope контракта = формальный язык над путями; «можно ли параллельно?» = disjointness write-языков (детерминированно, без LLM).
- Инвариант корректности: процедура disjointness КОНСЕРВАТИВНА - при неопределённости всегда «конфликт» (ложный disjoint = data race, недопустим).
- Расписание = graph coloring конфликт-графа; внутри волны write-scope попарно не пересекаются ⇒ коллизии невозможны by construction. Hook gate - runtime backstop.
- Мини-эксперимент `plan-parallel` с falsifiable-гипотезами (H1-H5, kill-criterion H4).
- B (temporal monitor) = слой порядка/зависимостей, растёт вместе с A; C (information-theoretic surprise) = приоритизация drift для человека, обобщение текущего `high_risk_file`. Идеи стекаются: A предотвращает коллизии, B - плохие последовательности, C - фокусирует ревью. Строить A сейчас, B/C - позже.

### Дисциплина контракта
- Выполнено под docs-only контрактом `creative-orchestration-scope-algebra-2026-07-07` (approve от cfb3b85), forbidden на `packages/**`, `.github/**`, README/LICENSE. check-drift = 0 нарушений scope.
<!-- TASK #0016 END -->

<!-- TASK #0017 BEGIN
     Owner: cursor-agent
     Started: 2026-07-07T20:45Z
     Status: plan
-->
## Задача #0017 — PLAN: реализация scope-algebra scheduler (Идея A)

- **Описание:** Implementation-ready план Идеи A, исполнимый младшим агентом. SA-анализ вариантов disjointness-движка (L1), выбран гибрид, расписаны milestones M1-M5, сигнатуры, алгоритмы (glob→regex→NFA product-emptiness, префиксный fast-path, char-предикаты, F1 coloring / F2 послойное), стратегия тестирования (property soundness + matcher-consistency как release-gate).
- **Уровень сложности:** Level 3 (план; реализация за checkpoint-gate).
- **Статус:** PLAN завершён; документ записан. Код НЕ начат (docs-only фаза).

### Основной документ
- `memory-bank/plans/orchestration-implementation-plan.md`

### Зафиксированные решения
- Движок disjointness = ГИБРИД B+A: NFA product-emptiness backbone + директорный prefix fast-path + консервативный fallback (неопределённость = конфликт).
- Forbidden в write-write тесте игнорируем: `W ⊆ union(planned)` ⇒ complement не нужен (доказательство в §2.1).
- Ядро = один примитив `globsIntersect(a,b)`; всё остальное - тонкая детерминированная надстройка.
- Планировщик: F1 (coloring, только write-write) сначала, F2 (смешанный граф, послойный + детект циклов) за `--include-read-hazards`.
- Release-gate: наш regex ≡ picomatch на фаззе (иначе гарантия дырявая на шве планировщик/gate).
- Порядок: M1-spike (`globsIntersect` + property/consistency) первым; M2+ не начинать пока M1 soundness-gate не зелёный.

### Дисциплина контракта
- Docs-only контракт `plan-orchestration-impl-2026-07-07` (approve от 49dcade), forbidden на `packages/**`, `.github/**`, README/LICENSE.
<!-- TASK #0017 END -->

<!-- TASK #0018 BEGIN
     Owner: cursor-agent
     Started: 2026-07-07T21:00Z
     Status: build
-->
## Задача #0018 — Синхронизация планов под делегирование

- **Описание:** Проверить и обновить продуктовый план и техплан так, чтобы рутину можно было отдать младшему разработчику/агенту: актуальный статус, зафиксированное решение (отложить интервью, moat = оркестрация) и один явный делегируемый следующий шаг (M1-spike) с DoD.
- **Уровень сложности:** Level 2 (docs).
- **Статус:** BUILD завершён под контрактом `refresh-plans-delegatable-2026-07-07` (approve от c1ba100). check-drift = 0 нарушений scope.

### Изменённые файлы
- `memory-bank/plans/scopelock-implementation-plan.md` (таблица статусов актуализирована; новый раздел «АКТУАЛЬНЫЙ ПЛАН И СЛЕДУЮЩИЙ ШАГ» с пошаговым делегируемым M1 + DoD).
- `memory-bank/plans/strategy-review-round2-market-corrections.md` (addendum 2026-07-07: статус MVP, решение отложить интервью, оркестрация как 4-й слой moat, обновлённая последовательность, elevator-ответ).
- `memory-bank/tasks.md`, `memory-bank/activeContext.md`.

### Итог
- Финальный/авторитетный план = `plans/scopelock-implementation-plan.md` → раздел «АКТУАЛЬНЫЙ ПЛАН И СЛЕДУЮЩИЙ ШАГ» (ссылается на `plans/orchestration-implementation-plan.md` для деталей M1-M5).
- Следующая исполнимая задача проекта: #0018→ M1-spike `globsIntersect` (см. orchestration-impl §2, §5, §8).
<!-- TASK #0018 END -->

<!-- TASK #0019 BEGIN
     Owner: codex
     Started: 2026-07-07T20:40Z
     Status: build
-->
## Задача #0019 — M1-spike: glob intersection для scope-algebra scheduler

- **Описание:** Реализовать первый кодовый шаг оркестрации из `plans/orchestration-implementation-plan.md`: sound/conservative `globsIntersect`, `globSetsIntersect` и `intersectionWitness` для проверки пересечения write-scope glob-ов перед построением conflict graph.
- **Уровень сложности:** Level 2
- **Статус:** BUILD завершён под контрактом `schedule-m1-glob-intersect` (approve от `ea92289`). Core 38/38 pass, `check-drift` = 0 violations.

### Сделано
- Добавлен `packages/core/src/schedule/glob-intersect.ts`:
  - `intersectionWitness(a,b): string | null` через segment-aware product search;
  - `globsIntersect(a,b): boolean`;
  - `globSetsIntersect(as,bs): boolean`;
  - conservative fallback: unsupported glob-конструкции считаются конфликтом, а не disjoint.
- Matcher-wrapper `globToRegExp` использует `picomatch.makeRe(..., { dot: true })`, чтобы scheduler и runtime path-rules не расходились в семантике matching.
- Нормализация схлопывает соседние `**/**` в один `**`; brace alternatives ограничены, brace ranges/extglob/negation fallback-ятся как unsupported.
- Public export добавлен через `packages/core/src/index.ts`.

### Проверки
- Known-pairs: `*.ts` vs `*.tsx`, `src/**`, `**/*.ts`, `a/*/b`, `src/ui/**` vs `src/api/**`, braces, unsupported fallback.
- Matcher consistency: 10 000 random supported glob/path cases против `picomatch`.
- Property soundness: 10 000 random glob pairs; если `globsIntersect=false`, corpus-поиск через `picomatch` не находит общего path.
- `pnpm --filter @scopelock/core test` → 38/38 pass.
- `node packages/cli/dist/index.js check-drift --json` → 0 violations по контракту `schedule-m1-glob-intersect`.

### Следующий шаг
- M2: build conflict graph / schedule schemas поверх `globSetsIntersect`; не начинать M3+ до зелёных M2 unit-тестов.
<!-- TASK #0019 END -->
