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

<!-- TASK #0020 BEGIN
     Owner: codex
     Started: 2026-07-07T20:57Z
     Status: build
-->
## Задача #0020 — M2: scope-algebra conflict graph + F1 scheduler

- **Описание:** Реализовать M2 из `plans/orchestration-implementation-plan.md`: scope conflict API, deterministic conflict graph, F1 write-write coloring scheduler и Zod-схему входного `plan-parallel` файла.
- **Уровень сложности:** Level 2
- **Статус:** BUILD завершён под контрактом `schedule-m2-conflict-graph` (approve от `ea92289`). Core 42/42 + CLI 3/3 pass, `check-drift` = 0 violations.

### Сделано
- `packages/core/src/schedule/scope-algebra.ts`:
  - `TaskScope`, `ScopeConflict`;
  - `firstIntersectionWitness(as,bs)`;
  - `scopesConflict(a,b)` с приоритетом write-write, затем read-write direction.
- `packages/core/src/schedule/conflict-graph.ts`:
  - `ConflictGraph`;
  - `buildConflictGraph(scopes, { readHazards? })`;
  - deterministic node order, duplicate id guard, writeEdges/readEdges/conflicts.
- `packages/core/src/schedule/scheduler.ts`:
  - F1 greedy Welsh-Powell coloring по writeEdges;
  - deterministic tie-break by node id;
  - `cycles: []` до M5.
- `packages/core/src/schedule/plan.ts`:
  - `schedulePlanSchema` с `schemaVersion: 1`, `planId`, `tasks[]`;
  - типы `SchedulePlan`, `SchedulePlanTask`.
- Public exports добавлены через `packages/core/src/index.ts`.

### Проверки
- Unit: disjoint scopes → `null`.
- Unit: overlapping planned scopes → `write-write` + concrete witness.
- Unit: read hazard writer→reader direction при `readHazards`.
- Unit: deterministic graph nodes/edges/conflicts.
- Unit: F1 schedule serializes only conflicting write tasks.
- Unit: `schedulePlanSchema` accepts valid shape and rejects empty tasks.
- `node --test packages/core/dist/schedule.test.js` → 8/8 pass.
- `pnpm test` → core 42/42 + cli 3/3 pass.
- `node packages/cli/dist/index.js check-drift --json` → 0 violations по контракту `schedule-m2-conflict-graph`.

### Следующий шаг
- M3: `plan-parallel` CLI command: load plan JSON, load referenced contracts, derive `TaskScope`, build graph, schedule, print matrix/waves/witnesses; exit codes 0/1/2.
<!-- TASK #0020 END -->

<!-- TASK #0021 BEGIN
     Owner: codex
     Started: 2026-07-07T21:09Z
     Status: build
-->
## Задача #0021 — CI fix: Windows path separator в storage layout test

- **Описание:** Исправить падение GitHub Actions на `windows-latest` Node 22/24: storage layout test ожидал POSIX-строки `/repo/.scopelock/...`, а `node:path.join` на Windows корректно возвращает `\\repo\\.scopelock\\...`.
- **Уровень сложности:** Level 1
- **Статус:** BUILD завершён под контрактом `ci-windows-path-test-fix`. Локально `pnpm test` → core 42/42 + cli 3/3 pass, `check-drift` = 0 violations.

### Root cause
- Runtime-код `scopelockPaths()` корректно использует `node:path.join`.
- Некроссплатформенной была проверка в `packages/core/src/schema.test.ts`: hardcoded POSIX expected path.

### Сделано
- Expected значения в storage layout test переведены на `join("/repo", ".scopelock", ...)`.
- Production-код не менялся.

### Проверки
- `pnpm test` → core 42/42 + cli 3/3 pass.
- `node packages/cli/dist/index.js check-drift --json` → 0 violations по контракту `ci-windows-path-test-fix`.
<!-- TASK #0021 END -->

<!-- TASK #0022 BEGIN
     Owner: codex
     Started: 2026-07-07T21:21Z
     Status: build
-->
## Задача #0022 — CI cleanup: убрать GitHub Actions Node 20 warnings

- **Описание:** После зелёного CI GitHub Actions показывал annotations: `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v4` target Node.js 20, а также notices о будущей миграции `macos-latest`.
- **Уровень сложности:** Level 1
- **Статус:** BUILD завершён под контрактом `ci-actions-node24-warnings`. Локально `pnpm test` pass; `check-drift` ожидаемо оставляет `high_risk_file` на `.github/workflows/test.yml` как intentional workflow review stop.

### Сделано
- `.github/workflows/test.yml`: `actions/checkout@v7`, `actions/setup-node@v6`, `pnpm/action-setup@v6`.
- Matrix macOS pin: `macos-latest` → `macos-15`, чтобы убрать notice о миграции latest label.

### Проверки
- `pnpm test` → core 42/42 + cli 3/3 pass.
- `node packages/cli/dist/index.js check-drift --json` → только ожидаемый `high_risk_file` на `.github/workflows/test.yml`.
<!-- TASK #0022 END -->

<!-- TASK #0023 BEGIN
     Owner: codex
     Started: 2026-07-07T21:39Z
     Status: blocked
-->
## Задача #0023 — M1 hardening: release-gate выявил over-approx witness

- **Описание:** Выполнить инструкцию hardening M1 release-gate: заменить тривиальный matcher-consistency тест на проверку witness через `picomatch`, добавить language-derived soundness sampling и продолжить F3/F5/F6/F7/F8 только если F1 зелёный.
- **Уровень сложности:** Level 2
- **Статус:** BLOCKED по стоп-условию инструкции. Новый F1-тест краснеет на supported-glob, значит найден реальный баг логики пересечений; production logic не менялась.

### Root cause evidence
- Команда: `pnpm --filter @scopelock/core build && node --test packages/core/dist/schedule.test.js`.
- Failing case: `intersectionWitness("*.ts", "test-*/**")` вернул `"test-.ts"`.
- Runtime matcher: `picomatch("*.ts", { dot: true })("test-.ts") === true`, но `picomatch("test-*/**", { dot: true })("test-.ts") === false`.
- Вывод: `segmentListWitness` переоценивает trailing `/**` после glob-сегмента (`test-*`) и считает zero-dir вариант валидным там, где `picomatch` требует slash/child path.

### Что уже сделано в рабочем дереве
- `packages/core/src/schedule.test.ts`: добавлен новый F1 witness-under-picomatch gate и F2 language-derived soundness sampler.
- F2 проходит, F1 падает на реальном counterexample.

### Что НЕ сделано из-за стоп-условия
- Не менялась production logic в `glob-intersect.ts`.
- Не выполнялись F3/F5/F6/F7/F8, чтобы не смешивать hardening с отдельным prod-fix.

### Следующая задача
- #0024: отдельный prod-scope fix для `intersectionWitness` / `segmentListWitness` семантики trailing `/**` после glob-сегмента, затем вернуться к hardening checklist.
<!-- TASK #0023 END -->

<!-- TASK #0024 BEGIN
     Owner: cursor
     Started: 2026-07-07T21:39Z
     Status: done
-->
## Задача #0024 — Prod fix: trailing globstar witness must match picomatch

- **Описание:** Исправить production-логику пересечения glob-ов после counterexample из #0023: `*.ts` vs `test-*/**` не должен давать witness `"test-.ts"`, который не матчится вторым glob под `picomatch`.
- **Уровень сложности:** Level 2
- **Статус:** DONE под активным контрактом `schedule-m1-hardening` (glob-intersect.ts входит в его planned-scope). Core 45/45, CLI 3/3, `check-drift` = 0 violations.

### Что сделано (`packages/core/src/schedule/glob-intersect.ts`)
- `intersectionWitness` переписан: product-search теперь **генератор кандидатов** (`collectWitnesses`), а истиной пересечения служит `picomatch` (тот же матчер, что в runtime hook gate). Возвращаем только тот witness, который реально матчится обоими glob под picomatch → устранён seam между scheduler и gate и все trailing-`**` quirks.
- Вердикт «disjoint» (null) возвращается только при исчерпании поиска без валидного кандидата; при упоре в `CANDIDATE_CAP` остаёмся консервативными (сообщаем пересечение — over-approx безопасен: теряем параллелизм, не корректность).
- `collectWitnesses`: DFS по (i,j); каждый переход строго увеличивает `i+j` (DAG → терминируется без visited-pruning, чтобы не терять альтернативные witness). Добавлена depth-bounded ветка «оба globstar поглощают общий filler-сегмент» — покрывает случай `**` × `.../wildcard/**`, где picomatch требует ребёнка, а не родителя.
- Добавлен memo-кеш picomatch-матчеров (`matcherFor`) — perf для property-тестов (20k+ вызовов).

### Acceptance (все выполнены)
- F1 witness-under-picomatch: зелёный на 10 000 supported-glob пар.
- F2 language-derived soundness: зелёный на 10 000 пар (нашёл и подтвердил fix false-disjoint `** & [ab]/test-*/**`).
- Regression-тесты `trailing globstar semantics match picomatch (#0024)`: `*.ts`×`test-*/**`→disjoint, `a/**`×`a`→intersect, `test-*/**`×`test-x/y.ts`→intersect.
- `node --test packages/core/dist/*.test.js` = 45/45, CLI = 3/3, `check-drift` = 0.
<!-- TASK #0024 END -->

<!-- TASK #0025 BEGIN
     Owner: cursor-agent
     Started: 2026-07-08T00:00Z
     Status: done
-->
## Задача #0025 — Group A: M1 hardening polish (F3/F5/F6/F7/F8 хвост)

- **Описание:** Закрыть оставшиеся мелкие hardening-находки из плана `orchestration-implementation-plan.md` после #0024: schema-version константа для `plan.ts`, инвариант-комментарии в `scheduler.ts`/`scope-algebra.ts`/`conflict-graph.ts`, проверка полноты публичных экспортов schedule-модуля.
- **Уровень сложности:** Level 1.
- **Статус:** DONE под контрактом `schedule-m1-polish` (approve от `e355902`). Core 45/45, CLI 3/3, `check-drift` = 0 violations.

### Сделано
- `packages/core/src/schedule/plan.ts`: добавлена `export const SCHEDULE_PLAN_SCHEMA_VERSION = 1` (стиль как у `CONTRACT_SCHEMA_VERSION`/`DRIFT_REPORT_SCHEMA_VERSION`/`REPO_MANIFEST_SCHEMA_VERSION`/`CONFIG_SCHEMA_VERSION`); `schedulePlanSchema` использует константу вместо инлайн `z.literal(1)`. Экспортируется через уже существующий `export *` в `index.ts`.
- `packages/core/src/schedule/scheduler.ts`: комментарий-инвариант над `cycles: []` - F1 красит только неориентированный write-write граф (циклов там нет по определению), поле зарезервировано под F2 (mixed read-write graph).
- `packages/core/src/schedule/scope-algebra.ts`: комментарий в `scopesConflict` - write-write конфликт всегда приоритетнее read-write, даже если пара имеет оба хазарда.
- `packages/core/src/schedule/conflict-graph.ts`: два комментария-инварианта в `buildConflictGraph` - (1) `nodes` сортируются, а не берутся в порядке вставки, для детерминизма графа/расписания; (2) перебор `left < right` по отсортированным узлам гарантирует, что каждая неориентированная пара посещается ровно один раз в фиксированном порядке.
- Публичные экспорты schedule-модуля подтверждены полными (`index.ts` уже содержал `export *` для всех пяти файлов `schedule/*.ts`, включая новую константу) - изменений в `index.ts` не потребовалось.
- `packages/core/src/schedule.test.ts`: тест `validates the plan-parallel input schema shape` дополнен проверкой `SCHEDULE_PLAN_SCHEMA_VERSION === 1` и использует константу вместо литерала `1` в обоих `schedulePlanSchema.parse` кейсах.

### Проверки
- `pnpm -r build` чист.
- `node --test packages/core/dist/*.test.js` -> 45/45 pass.
- `node --test packages/cli/dist/*.test.js` -> 3/3 pass.
- `node packages/cli/dist/index.js check-drift --json` под контрактом `schedule-m1-polish` -> 0 violations.

### Следующий шаг
- M3: `plan-parallel` CLI команда (см. #0020 "Следующий шаг" и `orchestration-implementation-plan.md` §5).
<!-- TASK #0025 END -->

<!-- TASK #0026 BEGIN
     Owner: cursor-agent
     Started: 2026-07-08T00:00Z
     Status: done
-->
## Задача #0026 — Group B: M3 plan-parallel CLI

- **Описание:** Реализовать M3 из `plans/orchestration-implementation-plan.md` §5: CLI-команда `scopelock plan-parallel <plan.json>`, которая по набору контрактов задач строит доказуемо parallel-safe расписание (волны) и печатает конфликты с witness.
- **Уровень сложности:** Level 2.
- **Статус:** DONE под контрактом `schedule-m3-plan-parallel` (approve от `58ccb3b`, forbidden `packages/core/**`). Core 45/45, CLI 7/7 pass, `check-drift` = 0 violations.

### Сделано
- `packages/cli/src/commands/plan-parallel.ts` (новый): читает `plan.json`, валидирует `schedulePlanSchema`; для каждой задачи читает файл контракта (путь из `task.contract`, разрешается относительно cwd - тот же конвеншн, что у `approve <file>`) и валидирует `approvedContractSchema`; строит `TaskScope[]` (`planned`/`forbidden` из `contract.scope`); `buildConflictGraph` + `schedule` из `@scopelock/core` (core не менялся - только импорт существующих публичных экспортов). Человекочитаемый вывод: `wave N: [...]` построчно + секция `conflicts:` с `a x b [kind]: witness`. `--json` отдаёт `{ planId, waves, conflicts }` (conflicts включают witness для explainability). `--include-read-hazards` пробрасывается в `buildConflictGraph({ readHazards })`.
- Ошибки: отсутствующий `plan.json` -> `PLAN_NOT_FOUND`; невалидный JSON в plan/contract файле -> `INVALID_JSON`; отсутствующий файл контракта -> `CONTRACT_NOT_FOUND`; невалидная схема (plan или contract) -> `ZodError` перехватывается общим `run()` в `run.ts` и форматируется `formatZodError` в `INVALID_INPUT`. Все ошибки -> exit `2` (существующий `run()` всегда возвращает 2 в catch-ветке). Успешный план (даже с конфликтами/несколькими волнами) -> exit `0`, т.к. F1 `cycles` всегда `[]` (см. #0025 инвариант) - `1`/`unschedulable` ветка из исходного design-дока в M3 не достижима и не реализована.
- `packages/cli/src/index.ts`: команда `plan-parallel <plan> [--include-read-hazards] [--json]` подключена по образцу остальных команд (`run()` + `jsonOf(command)`).
- `packages/cli/src/cli.test.ts`: новый `describe("plan-parallel")` - 4 теста: disjoint-контракты -> одна волна, `conflicts: []`; пересекающиеся контракты (общий write-glob) -> две волны + один conflict с `witness: "src/shared/utils.ts"`; отсутствующий plan-файл -> exit 2 `PLAN_NOT_FOUND`; пустой `tasks: []` (невалидная схема) -> exit 2 `INVALID_INPUT`. Тесты не требуют git-репозитория (`plan-parallel` git-free, в отличие от остальных команд).
- `README.md`: строка про `scopelock plan-parallel <plan.json> [--include-read-hazards]` в таблице команд.

### Проверки
- `pnpm -r build` чист.
- `node --test packages/core/dist/*.test.js` -> 45/45 pass (core не менялся).
- `node --test packages/cli/dist/*.test.js` -> 7/7 pass (3 старых + 4 новых plan-parallel).
- Ручной smoke: 3 контракта (`src/ui/**`, `src/api/**`, `src/ui/button.ts`) -> `wave 1: [t1, t2]`, `wave 2: [t3]`, конфликт `t1 x t3 [write-write]: src/ui/button.ts` и в human-, и в `--json`-выводе.
- Ручной smoke ошибок: отсутствующий plan -> `PLAN_NOT_FOUND`/exit 2; пустой `tasks` -> `INVALID_INPUT`/exit 2; отсутствующий файл контракта -> `CONTRACT_NOT_FOUND`/exit 2.
- `node packages/cli/dist/index.js check-drift --json` под контрактом `schedule-m3-plan-parallel` -> 0 violations.

### Следующий шаг
- M4: прогнать creative-мини-эксперимент (H1-H5) на реальном мульти-агентном сценарии, зафиксировать go/no-go перед M5.
- M5 (read-write F2, layered scheduling + cycle detection) НЕ начинать до готового M4 reflection report (см. handoff-инструкцию: "Не начинать M4/M5 до готового и оттестированного plan-parallel").
<!-- TASK #0026 END -->

<!-- TASK #0027 BEGIN
     Owner: cursor-agent
     Started: 2026-07-08T00:00Z
     Status: done
-->
## Задача #0027 — M3 review fixes: убрать мёртвый флаг, уникальность task.id

- **Описание:** Независимое ревью коммитов #0025/#0026 (`58ccb3b`, `9dbdefe`) нашло 4 находки. Закрыты обязательная F-M3-1 и желательная F-M3-2, а также опциональные F-M3-3/F-M3-4 (оказались быстрыми).
- **Уровень сложности:** Level 1-2.
- **Статус:** DONE под контрактом `schedule-m3-review-fixes` (approve от `9dbdefe`). Core 46/46 (+1), CLI 9/9 (+2), `check-drift` = 0 violations.

### F-M3-1 (Major, обязательно) — мёртвый `--include-read-hazards`
Причина: `loadTaskScope` никогда не заполняет `TaskScope.read` (в `approvedContractSchema` нет read-паттернов), значит `buildConflictGraph({ readHazards: true })` всегда работал по пустому read-множеству - флаг молча ничего не делал и исказил бы M4-эксперимент.
- `packages/cli/src/commands/plan-parallel.ts`: убран параметр `options.includeReadHazards`; `buildConflictGraph(scopes)` вызывается без опций; добавлен комментарий-инвариант, что CLI-флаг появится вместе с M5/`readPathPatterns`.
- `packages/cli/src/index.ts`: убран `.option("--include-read-hazards", ...)` у команды `plan-parallel`.
- `README.md`: убран `[--include-read-hazards]` из строки команды в таблице.
- `readHazards` в core (`buildConflictGraph`) не тронут - это будущий M5-хук, само API осталось.

### F-M3-2 (Minor, желательно) — уникальность `task.id` в схеме
- `packages/core/src/schedule/plan.ts`: `schedulePlanSchema` получил `.superRefine`, который добавляет issue `duplicate task id: <id>` при повторе id в `tasks[]` (вместо невнятного runtime-throw из `buildConflictGraph`).
- Тест на уровне схемы в `schedule.test.ts` ("rejects a plan with duplicate task ids") + CLI-тест в `cli.test.ts` ("exits 2 with INVALID_INPUT (not UNEXPECTED) on duplicate task ids") - подтверждает, что `ZodError` форматируется общим `run()` в `INVALID_INPUT`, а не падает как `UNEXPECTED`.

### F-M3-3 (Low, опционально) — различение ENOENT от прочих fs-ошибок
- `readJsonFile` в `plan-parallel.ts`: `ENOENT` -> `notFoundCode` (`PLAN_NOT_FOUND`/`CONTRACT_NOT_FOUND`), любая другая fs-ошибка (проверено вручную на `EISDIR`) -> новый код `FILE_READ_ERROR` с реальным сообщением ОС вместо вводящего в заблуждение "file not found".

### F-M3-4 (Low, опционально) — путь `task.contract` резолвится относительно cwd
- `README.md`: добавлена строка после таблицы команд, поясняющая, что `task.contract` резолвится относительно текущей директории (как у `approve <file>`), а не относительно расположения `plan.json`.

### Дополнительно
- `cli.test.ts`: тест "rejects an unknown --include-read-hazards flag" - подтверждает, что commander теперь отклоняет флаг как неизвестную опцию (exit != 0, stderr содержит "unknown option").
- `component-map.md`: уточнение про `plan-parallel.ts` - write-write only, read-write F2 CLI-поверхность придёт с M5.

### Проверки
- `pnpm -r build` чист.
- `node --test packages/core/dist/*.test.js` -> 46/46 pass (было 45, +1 тест на дубли id).
- `node --test packages/cli/dist/*.test.js` -> 9/9 pass (было 7, +2: дубли id, unknown flag).
- Ручной smoke: обычный сценарий (3 контракта) по-прежнему даёт `wave 1: [t1, t2]`, `wave 2: [t3]`, конфликт с witness `src/ui/button.ts`; `--include-read-hazards` теперь даёт "unknown option" от commander; директория вместо файла плана даёт `FILE_READ_ERROR` (не `PLAN_NOT_FOUND`).
- `node packages/cli/dist/index.js check-drift --json` под контрактом `schedule-m3-review-fixes` -> 0 violations.

### Следующий шаг
- M4: мини-эксперимент H1-H5 (отдельная задача, документ `plans/orchestration-m4-experiment.md`). M5 не начинать раньше готового M4 go/no-go.
<!-- TASK #0027 END -->

<!-- TASK #0028 BEGIN
     Owner: cursor-agent
     Started: 2026-07-08
     Status: done
-->
## Задача #0028 — M4: мини-эксперимент scope-algebra (H1-H5, go/no-go)

- **Описание:** Проверить на реальном мульти-задачном сценарии, что `plan-parallel` даёт корректное и полезное параллельное расписание, и зафиксировать go/no-go по гипотезам H1-H5 из `plans/orchestration-scope-algebra.md` §5. Это gate перед M5 (read-write F2).
- **Уровень сложности:** Level 2 (эксперимент + отчёт; продуктовой логики не добавляем).
- **Статус:** DONE под контрактом `orchestration-m4-experiment` (approve от `b626736`; planned `memory-bank/**` + `.scopelock/experiments/**`, forbidden `packages/**` - продуктовый код не менялся). `check-drift` = 0 (артефакты под `.scopelock/**` в принципе исключены из drift-подсчёта - `isScopelockArtifact` в `drift/collect.ts` фильтрует весь `.scopelock/**`, включая `experiments/` и новый файл контракта).

### Гипотезы (из scope-algebra.md §5) - результаты
- H1 Safety: write-коллизий внутри одной волны — ровно 0. **GO.**
- H2 Enforcement: не тестировался живьём (опционально по протоколу); сигналов против нет. **не тестировался.**
- H3 Speedup: 4 последовательных таска → 2 волны (одна из 3 задач); рассуждение даёт ~2x на этом сценарии (без реального замера времени). **GO (качественно).**
- H4 Soundness (**kill criterion**): единственная намеренно пересекающаяся пара (`t-cli-cmds` ⊂ `t-overlap`) никогда не оказалась в одной волне. Criterion не сработал. **GO.**
- H5 Determinism: два независимых прогона `--json` дали byte-for-byte идентичный вывод (`diff` без разницы). **GO.**
- **Итог: GO** — можно переходить к M5.

### Сценарий и результат
4 draft-контракта на реальных путях репозитория (`scopelock contract new`, сохранены в `.scopelock/experiments/*.json`): `t-core-schedule` (`packages/core/src/schedule/**`), `t-cli-cmds` (`packages/cli/src/commands/**`), `t-docs` (`memory-bank/**` + `README.md`), `t-overlap` (`packages/cli/src/**` — намеренно надмножество `t-cli-cmds`). `.scopelock/experiments/plan.json` по `schedulePlanSchema`, пути к контрактам — относительно cwd.

`plan-parallel .scopelock/experiments/plan.json` → `wave 1: [t-cli-cmds, t-core-schedule, t-docs]`, `wave 2: [t-overlap]`, один конфликт `t-cli-cmds x t-overlap [write-write]: packages/cli/src/commands`. Witness независимо перепроверен напрямую через `picomatch` (вручную, вне CLI) — матчится обоими glob-ами, как того требует M1-инвариант (witness должен матчиться обоими glob под тем же matcher-ом, что и runtime hook gate).

### Основной документ
- `memory-bank/plans/orchestration-m4-experiment.md` (полный отчёт: сценарий, сырой вывод, таблица H1-H5, вердикт)

### Проверки
- `pnpm -r build` чист; core 46/46 + cli 9/9 не менялись (продуктовый код не трогали, только запускали существующий CLI).
- `node packages/cli/dist/index.js plan-parallel .scopelock/experiments/plan.json --json` прогнан дважды, `diff` подтвердил идентичность (H5).
- `node packages/cli/dist/index.js check-drift --json` под `orchestration-m4-experiment` → 0 violations.

### Следующий шаг
- M5: `readPathPatterns` в contract-схему, F2 layered scheduling (Kahn topological + write-write coloring внутри слоя), cycle detection, возврат `--include-read-hazards` в CLI (флаг был намеренно убран в M3 review fixes до появления реальных read-паттернов). Условие начала M5 (готовый M4 с зафиксированным go) выполнено.
<!-- TASK #0028 END -->

<!-- TASK #0029 BEGIN
     Owner: cursor-agent
     Started: 2026-07-08
     Status: done
-->
## Задача #0029 — M5: read-write F2 (layered scheduler + cycle detection)

- **Описание:** Реализовать F2-режим оркестрации: read-write хазарды, послойное расписание (Kahn) + write-write раскраска внутри слоя, детекция циклов, `readPathPatterns` в схеме контракта и возврат CLI-флага `--include-read-hazards`. Gate M4 пройден с вердиктом GO (#0028). Ссылки: `plans/orchestration-implementation-plan.md` §3-§5 (M5), `plans/orchestration-scope-algebra.md` §5.1 (worked example).
- **Уровень сложности:** Level 3.
- **Статус:** DONE под контрактами `orchestration-m5-readwrite` (approve `871c0e1`) → расширен до `orchestration-m5-readwrite-scope2` (approve `871c0e1`, тот же baseline; добавлен planned `packages/core/src/*.test.ts`, т.к. аддитивное поле `readPathPatterns` стало обязательным в выведенном TS-типе `ContractScope`, что потребовало правки 5 существующих `*.test.ts`-фикстур вне исходного planned-scope). Core 53/53 (+7), CLI 11/11 (+2), `check-drift` = 0.

### Сделано

**M5.1 Schema.** `packages/core/src/schemas/contract.ts`: `contractScopeSchema` получил `readPathPatterns: z.array(pathPatternSchema).default([])` — аддитивно, `CONTRACT_SCHEMA_VERSION` не поднимался. `contract-new.ts` получил `--read <glob>` (repeatable), проброшен в `index.ts`. 2 новых теста схемы (backward-compat без поля + контракт с `readPathPatterns`).

**M5.2 Scheduler F2.** `packages/core/src/schedule/scheduler.ts` переписан: `colorWriteWrite` вынесен как переиспользуемый примитив (используется и F1, и F2 внутри каждого ready-слоя); `scheduleF1`/`scheduleF2` разделены, `schedule(graph)` выбирает режим по `graph.readEdges.length === 0` (F1-путь побайтово не изменился — старые тесты зелёные без правок). F2: Kahn topological layering по `readEdges` (writer→reader), внутри слоя — write-write coloring; при стопоре Kahn (все оставшиеся узлы с in-degree > 0) — `connectedComponents` (BFS по неориентированным rest-edges) группирует ЗАСТРЯВШИЕ узлы в `cycles` (не только строгий SCC-цикл, но и узлы, зависящие от цикла транзитивно — иначе они бы молча исчезли из вывода). Детерминизм — tie-break по id на каждом шаге (сортировка ready-set, coloring, компоненты).

Найдено при реализации worked example §5.1: буквальное `src/**` для чтения t4 по таблице документа технически пересекается (verified под `picomatch`) с write-scope t1/t2 — доп. read-write хазард, который прозаическое описание в доке не учло. Добавлен отдельный тест, показывающий корректный (более консервативный) 3-волновый результат для буквального `src/**`, и адаптированный тест с `src/types/**` для t4, воспроизводящий именно `{t3}` → `{t1,t2,t4}` как в доке.

6 новых тестов: worked example (адаптированный), worked example с буквальным `src/**` (3 волны), read hazard без цикла, 2-узловой цикл, цикл+транзитивно-зависимый узел (не теряется из вывода), F1-путь без `readEdges` не изменился.

**M5.3 CLI.** `plan-parallel.ts`: `loadTaskScope` заполняет `TaskScope.read` из `contract.scope.readPathPatterns`; `includeReadHazards` параметр восстановлен, пробрасывается в `buildConflictGraph(scopes, { readHazards })`; exit-код **1** восстановлен когда `cycles.length > 0` (`0` план построен и `cycles` пуст; `1` unschedulable; `2` execution error — не менялось). Human-вывод получил секцию `error: not parallelizable - read-write cycles detected...` перед волнами, когда `cycles` непуст. `index.ts` вернул `--include-read-hazards`; README вернул флаг в таблицу команд + абзац-пояснение F1 vs F2 + поведение при цикле.

3 новых CLI-теста (`cli.test.ts`): read-hazard `--include-read-hazards` → `[[writer],[reader]]` exit 0; read-write cycle → exit 1, `cycles: [["a","b"]]`, `waves: []`; без флага тот же writer/reader-контракт игнорирует read-паттерны (F1 default, backward-compat) — заменили устаревший тест F-M3-1 "rejects unknown flag" (флаг больше не мёртвый и не unknown).

### Валидация H2/H3 (закрывает caveats из #0028)
- **H2 (live-прогон):** contract `t-cli-cmds` и `t-core-schedule` из M4-сценария поочерёдно активированы (`approve` + существующий `mode: strict`); `hook gate` на собственный in-scope путь каждой задачи → allow (0/2 ложных отказов); на путь соседней волны → корректно deny (не false positive, а верная граница). `.scopelock/active` восстановлен на `orchestration-m5-readwrite-scope2` сразу после.
- **H3 (timed):** прокси-замер (`setTimeout`-нагрузка 300ms/задача) sequential vs wave-план на реальном 4-task M4-сценарии и его фактических волнах (`[t-cli-cmds,t-core-schedule,t-docs]` затем `[t-overlap]`): 3 прогона дали ~2.0x (1.998x-2.003x), совпадает с теоретической оценкой M4. Явная оговорка о том, что выигрыш ограничен критическим путём самой большой волны, не является заменой реального многоагентного замера.
- Полный отчёт: `memory-bank/plans/orchestration-m5-validation.md`.

### Проверки
- `pnpm -r build` чист.
- `node --test packages/core/dist/*.test.js` → 53/53 pass (было 47 после M4/M3-review-fixes).
- `node --test packages/cli/dist/*.test.js` → 11/11 pass (было 9).
- Ручной smoke: F1 default (без флага) игнорирует read-паттерны; `--include-read-hazards` даёт корректный writer→reader порядок; искусственный цикл `a<->b` → exit 1 с `cycle: [a, b]` в human-выводе.
- `node packages/cli/dist/index.js check-drift --json` под `orchestration-m5-readwrite-scope2` → 0 violations.

### DoD
- Core + CLI тесты зелёные, включая новые F2/cycle тесты и восстановленный exit-1 путь. ✅
- `check-drift --json` = 0 под контрактом M5. ✅
- Отчёт по H2/H3: `plans/orchestration-m5-validation.md`. ✅
- `tasks.md` (#0029 → done), `activeContext.md`, `component-map.md` обновлены. Коммит. Push только по явной просьбе. ✅

### Контракты
- `orchestration-m5-readwrite` (исходный, approve `871c0e1`): planned `packages/core/src/schedule/**`, `packages/core/src/schemas/contract.ts`, `packages/cli/**`, `README.md`, `memory-bank/**`, `.scopelock/experiments/**`; forbidden `packages/core/src/git/**`, `packages/core/src/hook/**`, `packages/core/src/drift/**`.
- `orchestration-m5-readwrite-scope2` (расширение, approve `871c0e1`, тот же baseline): то же + planned `packages/core/src/*.test.ts` (правка существующих schema/drift/hook/prompt/schedule тестов, ставшая необходимой из-за обязательности нового поля в выведенном типе `ContractScope`).
<!-- TASK #0029 END -->

<!-- TASK #0030 BEGIN
     Owner: cursor-agent
     Started: 2026-07-08
     Status: done
-->
## Задача #0030 — Интеграция parallel-workflow: guide + воспроизводимый пример

- **Описание:** Движок scope-algebra (M1-M5) готов и провалидирован (#0019-#0029). Эта задача не трогает движок - она связывает существующие команды (`contract new` → `approve` → `plan-parallel` → `export-prompt`/`inject-contract` → `check-drift`) в один задокументированный сквозной сценарий «большая задача → N параллельных агентов», плюс мелкий polish по итогам ревью M5.
- **Уровень сложности:** Level 2 (docs/UX).
- **Статус:** DONE под контрактом `workflow-parallel-docs-v2` (расширение `workflow-parallel-docs`, approve `1d343ec`; forbidden весь `packages/core/**` и весь `packages/cli/src/commands/**`/`index.ts` кроме явно перечисленного `plan-parallel.ts` + `cli.test.ts` под polish). Core 53/53 (не менялся), CLI 11/11 (behavior/JSON не менялись, только human-текст), `check-drift` = 0.

### Сделано

**Живой сквозной прогон (реальные команды, реальный вывод — ничего не выдумано):**
- 4 реалистичных контракта на реальных путях репо: `t1-core` (`packages/core/src/schedule/**`), `t2-cli` (`packages/cli/src/commands/**`), `t3-docs` (`memory-bank/**` + `README.md`), `t4-tests` (`packages/core/src/schedule.test.ts`, **read** `packages/core/src/schedule/**` — намеренный read-write хазард с `t1-core`).
- `contract new --read <glob>` (M5.1 CLI-опция) использована вживую для `t4-tests`.
- Каждый контракт approved (`--no-activate` для трёх, чтобы не сбивать активный контракт задачи).
- `plan-parallel` прогнан и в F1 (default: все 4 в одной волне, write-write disjoint), и в F2 (`--include-read-hazards`: `wave 1: [t1-core, t2-cli, t3-docs]` → `wave 2: [t4-tests]`, конфликт `t1-core x t4-tests [read-write]: packages/core/src/schedule`). Witness независимо перепроверен напрямую через `picomatch` (matches оба glob).
- `export-prompt --target codex` и `inject-contract --target codex` прогнаны вживую для `t1-core` (второе — в изолированном scratch-repo, чтобы не трогать `AGENTS.md` этого репозитория). Обнаружен и честно задокументирован реальный UX-момент: обе команды работают только с ЕДИНСТВЕННЫМ активным контрактом (`getActiveContractId`), явного `--contract <id>` флага нет — чтобы сгенерировать промпт для конкретной задачи волны, нужно сначала сделать её контракт активным.
- Cycle/exit-1 сценарий (`t5-cycle-a`/`t5-cycle-b`, взаимный read-write) прогнан вживую: exit `1`, human-вывод и `--json` зафиксированы.
- `check-drift` сценарий (clean → in-scope edit остаётся clean → out-of-scope edit → violations, exit 1) прогнан в отдельном scratch-repo (git init + `scopelock init` + `contract new` + `approve` + реальные правки файлов), чтобы не создавать файлы внутри реального `packages/core/src/schedule/` этого репозитория.
- `.scopelock/active` каждый раз восстанавливался на `workflow-parallel-docs-v2` сразу после ручных манипуляций (та же дисциплина, что в H2-тесте M5).

**Guide:** `docs/parallel-workflow.md` (новый) — мотивация, пошаговая цепочка с реальными командами/выводом, разбор вывода `plan-parallel` (wave/conflict/witness/`--include-read-hazards`/`cycles`), exit-коды 0/1/2 и что делать при 1, врезка Safety invariant (H1/H4 из M4 + witness verified под тем же `picomatch`, что и runtime hook gate), явный раздel "What this doesn't cover yet" (H3 real-agent timing, `scopelock run`-оркестратор — не в этой итерации). README.md получил короткую врезку-ссылку на guide после таблицы команд.

**Пример-артефакт:** `examples/parallel/` — 4 draft-контракта (`baseline: null`, без approve) + `plan.json` (пути относительно этой директории) + короткий README с ожидаемым выводом. Одна команда для воспроизведения: `scopelock plan-parallel plan.json --include-read-hazards` из `examples/parallel/`. Проверено вживую — вывод совпадает с зафиксированным в guide.

**Опциональный polish (сделан, оба пункта из ревью M5):**
- `plan-parallel.ts` human-вывод: «read-write cycles detected» → «unschedulable (read-write deadlock)»; построчная метка `cycle:` → `stuck group:` (группа может содержать узлы, лишь транзитивно зависящие от цикла, не только сам цикл — см. инвариант из #0029). **JSON-ключ `cycles` не переименован** — только человекочитаемый текст, проверено `--json`-прогоном до/после.
- Удалены просочившиеся из H2-теста M5 контракты `.scopelock/contracts/t-cli-cmds.json` и `.scopelock/contracts/t-core-schedule.json` (approved-копии с реальным baseline, оставшиеся после ad hoc активации в #0029); оригинальные draft-версии в `.scopelock/experiments/` не тронуты.

### Проверки
- `pnpm -r build` чист.
- `node --test packages/core/dist/*.test.js` → 53/53 (core не менялся).
- `node --test packages/cli/dist/*.test.js` → 11/11 (без новых тестов - polish не менял поведение/JSON, только human-текст; существующие тесты проверяют JSON, не текст).
- `node packages/cli/dist/index.js check-drift --json` под `workflow-parallel-docs-v2` → 0 violations.
- Ручной прогон одной командой из `examples/parallel/` воспроизвёл вывод, зафиксированный в guide, побайтово.

### DoD
- Guide написан, все команды в нём реально прогнаны, вывод настоящий. ✅
- Пример-артефакт воспроизводится одной командой. ✅
- Polish сделан: core/cli тесты зелёные, human-вывод обновлён, JSON-схема не изменилась. ✅
- `check-drift --json` = 0 под `workflow-parallel-docs-v2`. ✅
- `tasks.md` (#0030 → done), `activeContext.md`, `component-map.md` обновлены. Коммит. Push только по явной просьбе. ✅

### Контракты
- `workflow-parallel-docs` (исходный, approve `1d343ec`): planned `README.md`, `memory-bank/**`, `docs/**`, `examples/**`, `.scopelock/experiments/**`; forbidden `packages/core/**`, `packages/cli/src/commands/**`, `packages/cli/src/index.ts`.
- `workflow-parallel-docs-v2` (расширение, approve `1d343ec`, тот же baseline): то же + planned `packages/cli/src/commands/plan-parallel.ts`, `packages/cli/src/cli.test.ts` (для опционального polish); остальные `packages/cli/src/commands/*.ts` и `index.ts` остаются forbidden явным списком.

### Follow-up — два дефекта после rewrite истории (закрыто в этой же задаче)

**Контекст:** сразу после #0030 по просьбе пользователя история была переписана (`git filter-branch`, удаление `Co-Authored-By: Claude` из коммитов) и запушена force. Commit SHA у всех коммитов от `e355902` до `HEAD` изменились. Contract baseline в ScopeLock пиннится по commit SHA — переписывание истории сделало часть baseline'ов невалидными.

**Дефект 1 (High) — `check-drift` был сломан.** Активный контракт `workflow-parallel-docs-v2` держал `baseline.headSha = 1d343ec...` (старый M5-коммит, не переживший rewrite) → `check-drift` падал `status:error UNEXPECTED` с сырым `fatal: Invalid revision range 1d343ec...HEAD` вместо понятной ошибки. Исправлено: новый контракт `workflow-parallel-docs-fix` (тот же scope, approve от живого `HEAD` = `7c0bb09`/`bc2038f` на момент фикса, далее ещё раз переписан вместе с force-push до текущего `HEAD`) стал активным — baseline снова валиден, `check-drift --json` → `status:ok`, `violations: []`.

Аудит остальных контрактов в `.scopelock/contracts/` на предмет протухших после rewrite baseline (по договорённости — только неактивные, чинить не стал, это ожидаемо и не блокирует работу): baseline устарел (указывает на переписанный SHA) у `orchestration-m4-experiment.json`, `orchestration-m5-readwrite.json`, `orchestration-m5-readwrite-scope2.json`, `schedule-m3-plan-parallel.json`, `schedule-m3-review-fixes.json`, `t1-core.json`, `t2-cli.json`, `t3-docs.json`, `t4-tests.json`, `t5-cycle-a.json`, `t5-cycle-b.json`, `workflow-parallel-docs.json`, `workflow-parallel-docs-v2.json`. Все прочие (созданные до переписанного диапазона) не затронуты.

**Дефект 2 (Medium) — пример не воспроизводился из корня репозитория.** `examples/parallel/plan.json` ссылался на контракты как `t1-core.json` (относительно cwd) — рабочий вариант только из `examples/parallel/`, а не документированная в README «из корня» команда, которая падала `CONTRACT_NOT_FOUND`. Исправлено (вариант a): пути в `plan.json` переписаны на `examples/parallel/t1-core.json` и т.д. (относительно корня репо); `examples/parallel/README.md` теперь документирует ТОЛЬКО вариант «из корня репозитория» (вариант «из этой директории» убран целиком, а не просто помечен как альтернатива — с новыми путями он реально ломается, оставлять падающую команду в доках нельзя). Живой прогон из корня подтвердил вывод побайтово совпадает с задокументированным в README и в `docs/parallel-workflow.md`.

**Ревалидация `docs/parallel-workflow.md`:** все команды Steps 1-5 и 3b заново прогнаны в чистом scratch-репо именно из той cwd, что указана в тексте рядом с каждой командой (`contract new`/`approve`/`plan-parallel` F1 и F2/cycle-сценарий/`export-prompt`/`check-drift` clean-in-scope-out-of-scope) — вывод по структуре и формату совпал с задокументированным. Сам guide не ссылается на пути `examples/parallel/` внутри команд (только гиперссылка на папку), так что дефект 2 его не затрагивал.

**Продуктовая находка (в бэклог, НЕ реализована в этой итерации):** baseline-пиннинг по commit SHA ломается при rewrite истории, а наружу течёт сырая `git fatal ...` как `UNEXPECTED` вместо понятной ошибки. Нужна отдельная задача по `check-drift`/drift-движку: при отсутствии baseline-коммита в репозитории — явное сообщение вида `baseline commit <sha> not found (history rewritten?), re-run approve` вместо raw git error. Код `check-drift`/`drift` в этой итерации не трогал.

### Проверки (follow-up)
- `pnpm -r build` чист.
- `node --test packages/core/dist/*.test.js` → 53/53 (не менялся).
- `node --test packages/cli/dist/*.test.js` → 11/11 (не менялся, JSON-схема та же).
- `node packages/cli/dist/index.js check-drift --json` под `workflow-parallel-docs-fix` → `status:ok`, `violations: []`.
- `node packages/cli/dist/index.js plan-parallel examples/parallel/plan.json --include-read-hazards` из корня репо → вывод побайтово совпадает с README/guide.
- Полная ревалидация Steps 1-5 + 3b гайда в scratch-репо — поведение совпадает с задокументированным.

### DoD (follow-up)
- `check-drift --json` снова `status:ok`, `violations: []` под активным контрактом. ✅
- `plan-parallel examples/parallel/plan.json --include-read-hazards` из корня отрабатывает и даёт документированный вывод. ✅
- `docs/parallel-workflow.md` и `examples/parallel/README.md` согласованы, падающих команд нет. ✅
- Тесты core/cli зелёные, JSON-схема не менялась. ✅
- `tasks.md`/`activeContext.md` обновлены с пометкой про rewrite-эффект на baseline. ✅ Коммит. Push только по явной просьбе.
<!-- TASK #0030 END -->

<!-- TASK #0031 BEGIN
     Owner: cursor-agent
     Started: 2026-07-09
     Status: done
-->
## Задача #0031 — Fix baseline-not-found: понятная ошибка вместо сырого git fatal + чистка leaked-контрактов

- **Описание:** Реализовать backlog-находку из #0030 follow-up: `check-drift` при отсутствующем baseline-коммите (например, после rewrite истории) отдавал сырой `fatal: Invalid revision range <sha>..HEAD` как `UNEXPECTED`. Дать вместо этого понятную типизированную ошибку `BASELINE_NOT_FOUND` с actionable-текстом. Плюс подчистить 6 leaked-контрактов из `.scopelock/contracts/`, просочившихся из живых прогонов гайда #0030.
- **Уровень сложности:** Level 2.
- **Статус:** DONE под контрактом `fix-baseline-not-found` (approve от `595c8ab`). Core 53/53, CLI 12/12 (+1), `check-drift` = 0.

### Сделано
- **Core** `packages/core/src/git/repo.ts`: новый `commitExists(cwd, sha): boolean` — `git cat-file -e <sha>^{commit}`. Экспортируется автоматически (`export * from "./git/repo.js"` в index.ts).
- **CLI** `packages/cli/src/commands/check-drift.ts`: preflight после резолвинга `baselineSha` — если `!commitExists(root, baselineSha)`, кидаем `CliError("BASELINE_NOT_FOUND", "baseline commit <sha> not found (history rewritten?); re-run \`scopelock approve <file>\` to re-baseline")`. Ловится общим `run()` → exit 2, `status:error`, чёткий `code`/`message` вместо `UNEXPECTED`. Работает и для `--base <sha>` override (проверяется итоговый baselineSha).
- **CLI** `packages/cli/src/commands/doctor.ts`: заменил инлайновый `runGit(["cat-file","-e",...])` на `commitExists(...)` — DRY, единый источник истины для «существует ли коммит». `runGit` убран из импортов doctor (больше не используется).
- **Тест** `packages/cli/src/cli.test.ts`: integration-тест воспроизводит реальный баг — approve контракта → правка `baseline.headSha` на несуществующий SHA (симуляция rewrite) → `check-drift` даёт exit 2, `code: BASELINE_NOT_FOUND`, и `message` не содержит `fatal`/`UNEXPECTED`.
- **Чистка:** `git rm` шести leaked approved-контрактов (`t1-core`, `t2-cli`, `t3-docs`, `t4-tests`, `t5-cycle-a`, `t5-cycle-b`) из `.scopelock/contracts/` — это были approved-копии draft'ов из `examples/parallel/` (тот же scope, только с протухшим baseline), просочившиеся при живых прогонах #0030. Draft-версии в `examples/parallel/` не тронуты; `examples/parallel/plan.json` ссылается на них, не на удалённые копии — пример по-прежнему воспроизводится. Настоящие task-history контракты (`orchestration-*`, `schedule-m3-*`, `workflow-parallel-docs*`) оставлены как аудит-след (их протухший baseline безвреден — они никогда не активны).

### Проверки
- `pnpm -r build` чист.
- `node --test packages/core/dist/*.test.js` → 53/53.
- `node --test packages/cli/dist/*.test.js` → 12/12 (+1 baseline-тест).
- Живой прогон в scratch-репо: valid baseline → check-drift exit 0; bogus baseline → exit 2 `BASELINE_NOT_FOUND` (не raw fatal); doctor корректно показывает `active-baseline FAIL` без краша.
- `examples/parallel/plan.json --include-read-hazards` из корня → вывод не изменился.
- `check-drift --json` под `fix-baseline-not-found` → 0 violations (4 изменённых файла в scope; удаления в `.scopelock/` исключены из drift по дизайну).

### Не сделано (осознанно, вне scope)
- Подготовка к npm publish — по явной просьбе пользователя не трогал.
- Реальный multi-agent dogfood (H3 живой замер) — отдельная задача, обсуждена, отложена.
<!-- TASK #0031 END -->

<!-- TASK #0032 BEGIN
     Owner: cursor-agent
     Started: 2026-07-09
     Status: done
-->
## Задача #0032 — SA-решение по протухшим baseline: команда `scopelock rebaseline`

- **Описание:** SA-разбор ситуации с 13 (после чистки #0031 — 7) протухшими baseline у неактивных контрактов. Вывод: сами архивные записи оставить (иммутабельность approved-контракта + они никогда функционально не читаются), но закрыть реальную дыру — текст ошибки `BASELINE_NOT_FOUND` (из #0031) направлял на `scopelock approve`, который для существующего id падает `CONTRACT_ID_EXISTS`, т.е. советовал нерабочую команду. Правильное завершение — первоклассная команда репары `scopelock rebaseline`.
- **Уровень сложности:** Level 2.
- **Статус:** DONE под контрактом `add-rebaseline-command` (approve от `f984f45`). Core не трогали. CLI 14/14 (+2), `check-drift` = 0.

### SA-решение (зафиксировано)
- **Симптом vs болезнь:** «протухшие baseline» — симптом. Болезнь: provenance пиннится к commit SHA — изменяемому идентификатору, который инвалидируют рутинные rebase/squash-merge/rewrite. Ударит любую команду на rebase-workflow, не только разовый rewrite.
- **7 архивных протухших baseline — оставлены как есть.** Причины: (1) approved-контракт иммутабелен по модели доверия — переписывать baseline задним числом хуже, чем честно хранить «стамп был на SHA X (которого больше нет)»; (2) их baseline никогда не читается (не активны); (3) фабриковать новый SHA = подрыв «заморожен на approve».
- **Реальный фикс — forward-looking:** `scopelock rebaseline [<id>]` пере-анкорит baseline существующего контракта на текущий HEAD, сохраняя id/task/scope/createdAt. Закрывает actionability-дыру из #0031 и даёт честный ответ на весь класс «история переписалась».
- **В бэклог (НЕ реализовано):** глубокая робастность — tree-hash как доп. якорь (переживает message-only rewrite) и/или degraded-mode diff против merge-base при отсутствующем baseline. Отдельный эпик со сменой схемы.

### Сделано
- `packages/cli/src/commands/rebaseline.ts` (новый): резолвит контракт (явный id или активный), берёт HEAD (`headSha`), грузит контракт (`loadContract`, ENOENT → `CONTRACT_NOT_FOUND`), пере-стамповывает `baseline` (`headSha`/`currentBranch`/`capturedAt`), сохраняет (`saveContract`, overwrite). Активный указатель не трогает. Всё на существующих экспортах core — core не менялся. v1 анкорит только на HEAD (90%-кейс «resume after rewrite»); `--to <sha>` для исторического коммита осознанно отложен (избегает канонизации SHA без правки core).
- `packages/cli/src/index.ts`: команда `rebaseline [contract] [--json]`.
- `packages/cli/src/commands/check-drift.ts`: текст `BASELINE_NOT_FOUND` теперь указывает на `scopelock rebaseline` (рабочая команда), а не на `approve` (падал бы `CONTRACT_ID_EXISTS`).
- `packages/cli/src/cli.test.ts`: +2 теста — repair-loop (сломать baseline → check-drift exit 2 → rebaseline → check-drift exit 0; id/createdAt сохранены, baseline сменился); unknown id → exit 2 `CONTRACT_NOT_FOUND`. Существующий BASELINE_NOT_FOUND-тест дополнен проверкой, что сообщение указывает на `rebaseline`.
- `README.md`: строка про `rebaseline` в таблице команд.

### Проверки
- `pnpm -r build` чист; core 53/53; CLI 14/14.
- Живой прогон scratch-репо: сломанный baseline → `BASELINE_NOT_FOUND`/rebaseline-подсказка → `rebaseline` → `check-drift` снова 0; unknown id → `CONTRACT_NOT_FOUND`; rebaseline не-активного по id не меняет активный указатель.
- `check-drift --json` под `add-rebaseline-command` → 0 violations.
<!-- TASK #0032 END -->

<!-- TASK #0033 BEGIN
     Owner: cursor-agent
     Started: 2026-07-09
     Status: done
-->
## Задача #0033 — H3 real-agent measurement (реальный multi-agent замер вместо proxy)

- **Описание:** Заменить proxy-замер H3 (setTimeout-нагрузка из M5) на реальный: запустить параллельные субагенты по волнам scope-locked-workload, измерить wall-clock sequential vs wave-parallel живыми агентами + проверить H1/H4 (нет коллизий) под реальным исполнением. План — `plans/orchestration-h3-real-agents-plan.md`.
- **Уровень сложности:** Level 3 (эксперимент).
- **Статус:** DONE под контрактом `h3-real-agent-docs` (docs-only; сам эксперимент — во внешнем scratch-репо, продуктовый код не трогали). Отчёт: `plans/orchestration-h3-real-agents.md`.

### Что сделано
- Одноразовый git-репозиторий, 3 независимых модуля (`src/strings|numbers|arrays`), по одной сопоставимой задаче на каждый («добавить документированную чистую функцию + `node:test`-файл»). `plan-parallel` подтвердил 1 волну / 0 конфликтов. Агенты — реальные субагенты (Agent tool), пиннены на одну модель (Sonnet), **общий рабочий каталог** (не worktree — чтобы claim про collision-safety реально проверялся), самотайминг через `python3` epoch-ms.
- **13 реальных субагент-запусков:** par1 (pilot, сломанный `date` %N → coarse), par2/par3 (parallel, ms), seq1 (true sequential, 3 агента строго по одному).
- **H1/H4 под реальными агентами = GO:** 4 прогона, 0 коллизий, каждый изменённый файл строго в своей полосе, все сгенерированные тесты зелёные (13–15 assertions/run). Kill-criterion (два агента пишут один файл в одной волне) не сработал ни разу.
- **H3 speedup = ~1.5–2.0x (median ~1.8x)** на волне из 3 задач, ниже теоретического ~3x. Причина вскрыта и это НЕ планировщик и НЕ contention: **платформа стаггерит dispatch** субагентов (стагтер стартов 14.6–23.6 s ≈ длина задачи). Contention исключён: solo-длительности (23/25s) ≈ параллельные (24–27s) — агенты не тормозят друг друга (LLM-работа API-bound). Отвергнут наивный 3.2–3.8x: он берёт seq1 *elapsed* (158.9s), включающий мою оркестраторную задержку между задачами (~73s), которой нет в параллельной ветке — честная база = Σ-длительностей (85.5s).
- 2-wave вариант: `plan-parallel` корректно вынес пересекающийся `t-strings-extra` в волну 2 (write-write, witness `src/strings`) — показано через CLI; реальный прогон 2-волн отдельно не таймился (добавляет только ordering, уже покрытый unit-тестами M5 F2) — осознанная экономия.

### Ключевой продуктовый вывод
Планировщик необходим, но недостаточен: он доказывает, что волна collision-free и МОЖЕТ идти параллельно (H1/H4 GO), но реализация speedup упирается в исполнитель. Нужен `scopelock run`, который диспатчит агентов волны действительно одновременно (а не стаггером) — это закроет разрыв до ~3x. Сильнейший на сегодня конкретный аргумент за оркестратор.

### Fidelity-оговорки
- Проверяет scheduling + real-agent collision-safety + wall-clock speedup. НЕ воспроизводит cross-process runtime hook-gate enforcement (это H2, отдельно закрыт live в #0029) — субагенты в одном харнессе.
- Тайминг индикативный: малое K, высокая дисперсия LLM-латентности; репортится как диапазон с объяснённым механизмом, не одно число.

### Проверки
- Эксперимент — вне продуктового репо; `check-drift` под `h3-real-agent-docs` = 0 (только docs в memory-bank).
- `orchestration-m5-validation.md` H3-строка обновлена (proxy → real).
<!-- TASK #0033 END -->

<!-- TASK #0034 BEGIN
     Owner: codex
     Started: 2026-07-09
     Status: build
-->
## Задача #0034 — Phase 5 MCP server (competitively-informed) + buy-vs-build spike

- **Описание:** Приоритетный следующий шаг проекта. Веб-скан Q4 (2026-07, `plans/competitive-landscape-2026-07.md`) выявил, что планируемый MCP scope-enforcer — near-clone `logi-cmd/agent-guardrails` (~8★, zero traction), а категория с weak PMF. Поэтому шаг переработан: сперва обязательный spike buy-vs-build, потом узко-дифференцированный MCP-сервер (только если GO).
- **Уровень сложности:** Level 3 (spike Level 2 + build Level 3).
- **Статус:** Step 5.0 BUILD завершён. Вердикт: **GO, но только narrow MCP**, без общего enforcer-клона.
- **Step 5.1 статус:** BUILD завершён под контрактом `mcp-narrow-server-v2`; commit done.
- **Полное ТЗ:** `plans/scopelock-implementation-plan.md` → раздел «Phase 5 - MCP server === СЛЕДУЮЩИЙ ШАГ» (строка ~364) + «АКТУАЛЬНЫЙ ПЛАН И СЛЕДУЮЩИЙ ШАГ». Контекст конкурентов: `plans/competitive-landscape-2026-07.md`.

### Порядок (жёсткий)
- **Step 5.0 — buy-vs-build spike (гейт, docs-only, ~1 сессия):** **СДЕЛАНО**. Погоняны `logi-cmd/agent-guardrails` + `wit` на полиглот scratch-репо (`/tmp/scopelock-mcp-spike`). Основной документ: `plans/mcp-spike-verdict.md`. Kill-criterion НЕ сработал: вместе покрывают ~65-75% целевого Step 5.1, но не language-agnostic wave scheduler и не true pre-write deny.
- **Step 5.1 — MCP server (только если GO):** `packages/mcp`, тонкие обёртки над core, строго 2 дифференциатора: `plan_parallel`/`scopes_conflict` (уникальный language-agnostic scheduler) + `check_drift` verification-tool + опора на готовый real-time hook gate. НЕ дублировать enforcer agent-guardrails.

### Evidence / выводы Step 5.0
- `agent-guardrails@0.20.0`: зрелый CLI/MCP/daemon/adapters; первый `npx` упал на packaged native binary `EACCES`, fallback `AGENT_GUARDRAILS_RUNTIME=node` работает. Scope violation ловится `check`/daemon/PostToolUse/Stop/pre-commit **после записи**; clean-run `check --json` дал `outOfTaskScopeFiles:["config/settings.json"]`, exit 1. Scheduler отсутствует.
- `wit-protocol@0.1.3`: npm-пакет требует Bun; `npx wit-protocol --help` без Bun завис, source-run через temporary `npx bun` работает. TS symbol lock conflict hard-fail (`LOCK_CONFLICT`), file intent overlap warning есть. JSON/YAML принимаются как string paths/locks, но parser/contract слой по docs/source поддерживает только TS/JS/Python.
- ScopeLock: `plan-parallel` на TS+Python+JSON+YAML дал одну волну; конфликт `config/**` vs `config/*.json|*.yaml` дал witness. `hook gate` в strict на PreToolUse-событии `config/settings.json` вернул exit 2 до записи.

### Step 5.1 narrow MCP implementation
- Добавлен новый workspace package `@scopelock/mcp` (`packages/mcp`) со stdio MCP server на `@modelcontextprotocol/sdk@1.29.0`.
- MCP tools строго ограничены дифференциаторами:
  - `plan_parallel`: Zod-валидирует `schedulePlanSchema`, грузит contract files, возвращает waves/conflicts/cycles.
  - `scopes_conflict`: проверяет две task scope структуры и возвращает boolean + witness detail.
  - `check_drift`: запускает существующий core drift path для active approved contract и пишет report.
- `renderAgentPrompt` получил финальную инструкцию вызывать `check_drift` перед завершением и устранять violations.
- README дополнен MCP config snippets для Claude/Cursor-style JSON и Codex TOML.
- Smoke через официальный MCP SDK client: `tools/list` вернул `check_drift`, `plan_parallel`, `scopes_conflict`; `scopes_conflict` вернул witness `config/.json`.
- Dependency review: `pnpm-lock.yaml` изменён намеренно из-за `@modelcontextprotocol/sdk` + `zod`; `check-drift` ожидаемо флагует `high_risk_file` для lockfile как review stop, scope violations нет.

### DoD
- [x] `plans/mcp-spike-verdict.md` с вердиктом GO/NO-GO (конкретика, не «кажется полезно»).
- [x] Step 5.0 docs-only: `packages/**` не тронуты.
- [x] Финальные проверки после записи Memory Bank: `pnpm -r build`, core 53/53, cli 14/14, `check-drift`=0 под контрактом.
- [x] Коммит: `docs: add MCP buy-vs-build verdict`. Push — только по явной просьбе.
- [x] Если следующий шаг запускается: Step 5.1 narrow MCP, не общий enforcer.
- [x] Step 5.1 финальные проверки: `pnpm -r build`, `pnpm -r test` (core 53/53, cli 14/14, mcp 3/3), `pnpm typecheck`, MCP SDK stdio smoke. `check-drift` scope-clean; единственная violation — ожидаемый `high_risk_file` на `pnpm-lock.yaml` из-за dependency update (`@modelcontextprotocol/sdk` + `zod`), reviewed.
- [x] Step 5.1 commit: `feat: add narrow ScopeLock MCP server`. Push — только по явной просьбе.
<!-- TASK #0034 END -->
