# ScopeLock: технический план реализации (v2, исполнимый)

> Дата: 2026-07-05 (v2). Автор ревью: Solution Architect / Principal Engineer.
> v2 = v1 + Phase 0 выполнена + детализация "как делать" до уровня, исполнимого
> младшим разработчиком или AI-агентом без дополнительных вопросов.
> Стратегический контекст: `strategy-review-round2-market-corrections.md`,
> `traycer-infrastructure-lessons.md`, `traycer-repo-analysis.md`.

---

## 0. Правила работы для исполнителя (читать перед любой фазой)

### Как собирать и проверять

```bash
pnpm install                 # один раз
pnpm typecheck               # core собирается первым (нужен dist для cli)
pnpm build
pnpm test
```

Если `node` недоступен в PATH (Codex/Cursor sandbox), работает Electron-as-Node:

```bash
export ELECTRON_RUN_AS_NODE=1
NODE="/Applications/Cursor.app/Contents/MacOS/Cursor"
"$NODE" node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
"$NODE" --test packages/core/dist/schema.test.js
```

### Инварианты (нарушение = ошибка ревью)

1. **Exit-code контракт CLI**: `0` clean/ok, `1` violations найдены, `2` execution error.
   На него полагаются CI и agent hooks. Не придумывать другие коды.
2. **Все boundaries через Zod**: файлы на диске, stdin хуков, LLM output, MCP input.
   `JSON.parse` без последующего `schema.parse` запрещён.
3. **Каждый persisted артефакт имеет `schemaVersion`** (literal в схеме).
4. **Запись JSON только через `writeJsonAtomic`** (temp + rename). Прямой `writeFile`
   для JSON запрещён.
5. **Пути `.scopelock/` только через `scopelockPaths()`** - никаких хардкодов.
6. **core не знает про CLI**: в `packages/core` нет `process.exit`, `console.log`,
   commander. Чистые функции + типизированные ошибки.
7. **Бизнес-логика в core, CLI-команда - тонкий адаптер**, возвращающий
   `CommandResult { data, human, exitCode }`.
8. **Placeholder честный**: незапиленная команда кидает `CliError("NOT_IMPLEMENTED", ...)`,
   а не возвращает пустой "успех".
9. Стиль: TypeScript strict, без `any`, без `as unknown as`, файлы kebab-case,
   node:test + assert/strict.
10. После каждой фазы: тесты зелёные, `component-map.md` обновлена, task-блок в
    `tasks.md` дополнен.

### Текущая структура (после Phase 0)

```text
packages/core/src/
├── schemas/contract.ts     # contract + baseline + nodeType enum
├── schemas/drift.ts        # drift report, changed file, violations
├── schemas/repo-manifest.ts
├── schemas/config.ts       # scopelockConfigSchema (mode warn|strict)
├── storage/paths.ts        # scopelockPaths(), SCOPELOCK_GITIGNORE
├── storage/atomic.ts       # writeJsonAtomic
├── storage/contracts.ts    # save/load/setActive/getActive
├── git/exec.ts             # runGit (sync, для дешёвых запросов)
├── git/repo.ts             # findRepoRoot/headSha/currentBranch/gitVersion
├── index.ts
└── schema.test.ts
packages/cli/src/
├── index.ts                # commander wiring, --json на каждой подкоманде
├── run.ts                  # CommandResult, CliError, exit-code контракт
└── commands/{init,doctor,check-drift}.ts
.github/workflows/test.yml
```

---

## Phase 0 - Hardening: ВЫПОЛНЕНА (2026-07-05)

Сделано: структура core по доменам (schemas/storage/git), baseline в контракте,
nodeType enum с first-class `unknown`, config-схема, атомарная запись, layout-хелпер
с `.scopelock/.gitignore` (contracts коммитятся, reports/active - нет), CLI разложен
на commands/ + run.ts с CliError и статусами ok/violations/error, `--json` через
`optsWithGlobals` на каждой подкоманде, doctor с severity/detail/fix, честный
NOT_IMPLEMENTED в check-drift, engines >= 22, CI workflow, 8 тестов.

Проверено: build core+cli, 8/8 тестов, smoke в реальном git-репо
(init идемпотентен, doctor --json в обеих позициях флага, check-drift exit 2 с кодом).

---

## Phase 1 - Drift engine (moat), 3-5 дней

Цель: `scopelock approve` + реальный `scopelock check-drift`.

### 1.1 Async git runner - `core/git/exec.ts` (дополнить)

```ts
export async function runGitAsync(
  args: string[],
  cwd: string,
  options: { timeoutMs: number },  // default 30_000 у вызывающих
): Promise<GitResult>
```

`spawn` (не spawnSync), собирать stdout/stderr как Buffer (porcelain -z содержит NUL),
по таймауту kill + `ok: false`. Существующий sync `runGit` не трогать.

### 1.2 Парсер worktree - `core/git/status.ts` (новый)

Вход: вывод `git status --porcelain=v2 -z --no-renames=false`.
Формат записей (разделитель NUL, у типа `2` ДВА пути через NUL):

- `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` - изменённый файл
- `2 <XY> <sub> ... <X><score> <path>NUL<origPath>` - rename/copy
- `u <XY> ...` - конфликт
- `? <path>` - untracked

Маппинг в `ChangedFile`:
- `status`: X/Y -> modified/added/deleted/renamed/copied; `u` -> conflicted; `?` -> untracked.
- `stage`: X != "." -> staged, иначе unstaged; `?` -> untracked; `u` -> conflicted.
- rename: `path` = новый путь, `previousPath` = старый.
- insertions/deletions/sizeBytes на этом этапе 0 (заполняет numstat-слой), isBinary false.

Сигнатура: `parsePorcelainV2(raw: Buffer): ChangedFile[]` - чистая функция, без git-вызова
(тестируется на байтовых fixtures).

### 1.3 Коммиты после baseline - `core/git/diff.ts` (новый)

```ts
export async function changedSinceBaseline(
  cwd: string,
  baselineSha: string,
): Promise<ChangedFile[]>
```

- `git diff --name-status -z -M <sha>..HEAD`: записи `M/A/D/Cn/Rn` (+2 пути у R/C).
- `git diff --numstat -z <sha>..HEAD`: insertions/deletions; `-\t-\t` = binary.
- Смерджить по path. `stage` для committed изменений: "staged" (условно; поле
  осмысленно для worktree, для committed не влияет на правила).

### 1.4 Объединение - `core/drift/collect.ts` (новый)

```ts
export async function collectChangedFiles(
  cwd: string,
  baselineSha: string | null,
): Promise<{ files: ChangedFile[]; repoState: RepoState; repoMode: RepoMode }>
```

- worktree (status) + committed (diff, если baselineSha != null);
- дедупликация по `path`: worktree-запись побеждает committed;
- repoState: проверка файлов в `.git/`: `MERGE_HEAD` -> merge, `rebase-merge/` или
  `rebase-apply/` -> rebase, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`; иначе clean;
- repoMode: files.length > 10_000 -> "degraded" (пропустить numstat).

### 1.5 Path rules - `core/rules/path-rules.ts` (новый)

Зависимость: `picomatch` (добавить в core dependencies).

```ts
export function matchesAny(path: string, patterns: string[]): boolean
// picomatch(patterns, { dot: true }); пути нормализовать в posix ("\\" -> "/")

export function classifyPath(
  file: ChangedFile,
  scope: ContractScope,
): "forbidden" | "outside" | "planned"
```

Порядок правил (не менять):
1. `path` ИЛИ `previousPath` матчит forbidden -> `"forbidden"`.
2. `plannedPathPatterns` пуст -> `"planned"` (пустой scope не шумит).
3. `path` не матчит ни один planned -> `"outside"`.
4. Иначе `"planned"`.

### 1.6 Risk rules - `core/rules/risk-rules.ts` (новый)

`export const DEFAULT_HIGH_RISK_PATTERNS: string[]` - стартовый список:
`.github/workflows/**`, `**/*.lock`, `pnpm-lock.yaml`, `**/migrations/**`,
`Dockerfile*`, `.env*`, `**/auth/**`, `**/*.entitlements`, `**/Info.plist`,
`**/AndroidManifest.xml`, `**/*.gradle*`, `**/project.pbxproj`, `Package.swift`.

`export function highRiskViolations(files, extraPatterns): DriftViolation[]`.

### 1.7 Test heuristics - `core/rules/test-heuristics.ts` (новый)

`TEST_PATTERNS_BY_PROJECT_TYPE: Record<ProjectType, string[]>`
(generic: `**/*.{test,spec}.*`, `**/__tests__/**`; ios: + `**/*Tests.swift`;
android/kmp: + `**/src/test/**`, `**/src/androidTest/**`; rn: generic + `**/e2e/**`).

`missingTestsViolation(files, contract, projectTypes): DriftViolation | null` -
возвращает violation, если `contract.tests` непуст И ни один changed file не матчит
тестовые паттерны.

### 1.8 Engine - `core/drift/engine.ts` (новый)

```ts
export function buildDriftReport(input: {
  contract: ApprovedContract;
  files: ChangedFile[];
  repoState: RepoState;
  repoMode: RepoMode;
  extraHighRiskPatterns: string[];
  checkedAt: string;
}): DriftReport
```

Чистая функция. Violations: forbidden_path и outside_scope из classifyPath;
high_risk_file; missing_tests; repo_state если kind != clean; repo_mode если degraded.
Каждый `message` - человекочитаемый, с конкретным путём и действием
("changed outside approved scope: src/auth/x.ts - revert, or extend the approved scope").

### 1.9 CLI

`commands/approve.ts`: аргумент - путь к contract JSON. Шаги: read -> Zod parse ->
если id занят в `contracts/` - CliError `CONTRACT_ID_EXISTS` -> штамп baseline
(headSha/currentBranch/now; вне git-репо - CliError `NOT_A_GIT_REPO`) ->
`saveContract` -> `setActiveContractId`. `--no-activate` пропускает последний шаг.

`commands/check-drift.ts` (заменить заглушку): active contract -> `collectChangedFiles`
(baseline из контракта, override `--base <sha>`) -> `buildDriftReport` ->
`writeJsonAtomic` в `reports/drift-<ISO ts>.json` -> human-вывод: violations
сгруппированы по типу; exitCode 1 если violations непусты, иначе 0.

### 1.10 Тесты Phase 1 (обязательный список)

Unit (fixtures, без git):
- porcelain v2: modified staged+unstaged, untracked, rename с NUL и двумя путями,
  путь с пробелом, путь с unicode, conflicted `u`;
- path-rules: forbidden побеждает planned; rename ловится по СТАРОМУ пути;
  пустой planned -> не outside; `{dot: true}` (`.github/...` матчится);
- test-heuristics: contract.tests пуст -> null; тестовый файл в diff -> null;
  нет тестов -> violation;
- engine: снапшот отчёта на составной фикстуре.

Integration (реальный git, helper `makeTmpRepo()` в `core/src/git/__tests__/`):
`git init -q` во временной папке + commit; сценарии: файл вне scope -> outside_scope;
rename planned -> forbidden -> forbidden_path; commit после baseline виден в отчёте;
merge-in-progress -> repo_state violation. ВАЖНО: в CI git есть; локально в sandbox
`git init` может падать - тесты должны `skip`, если `git init` не удался.

### Definition of done Phase 1
- [ ] Все тесты 1.10 зелёные в CI.
- [ ] Демо-сценарий вручную: approve -> правка вне scope -> check-drift exit 1
      с outside_scope; правка forbidden -> forbidden_path; touch тестового файла
      убирает missing_tests.
- [ ] `doctor` дополнен проверкой "active contract валиден и baseline существует в репо"
      (`git cat-file -e <sha>`).

---

## Phase 2 - Harness registry + prompt export, 2-3 дня

### 2.1 `core/harness/registry.ts`

```ts
export type HarnessAdapter = {
  id: AgentId;
  label: string;
  docFile: "AGENTS.md" | "CLAUDE.md";
  hooksSupport: "deny" | "audit" | "none";
};
export const HARNESSES = {
  claude: { id: "claude", label: "Claude Code", docFile: "CLAUDE.md", hooksSupport: "deny" },
  cursor: { id: "cursor", label: "Cursor", docFile: "AGENTS.md", hooksSupport: "audit" },
  codex:  { id: "codex",  label: "Codex CLI", docFile: "AGENTS.md", hooksSupport: "none" },
} as const satisfies Record<AgentId, HarnessAdapter>;
```

`satisfies Record<AgentId, ...>` обязателен: новый агент в enum без адаптера
= ошибка компиляции (паттерн Traycer).

### 2.2 `core/render/prompt.ts`

`renderAgentPrompt(contract: ApprovedContract, target: AgentId): string`.
Секции в порядке: Task; Approved scope (planned patterns списком); Forbidden
(с формулировкой "do NOT modify; if required - stop and ask"); Required tests
(с командами); Assumptions; Open questions; финальная инструкция: не выходить за
scope, запускать тесты, при сомнении остановиться. Снапшот-тест на каждый target.

### 2.3 `core/render/agents-md.ts`

Маркеры: `<!-- SCOPELOCK CONTRACT BEGIN -->` / `<!-- SCOPELOCK CONTRACT END -->`.
`injectContractSection(existing: string | null, section: string): string` -
заменяет содержимое между маркерами, при отсутствии - дописывает в конец.
Идемпотентность: `inject(inject(x)) === inject(x)` - обязательный тест.
Контент вне маркеров байт-в-байт неизменен.

### 2.4 CLI: `export-prompt --target <id>` (stdout; `--json` -> `{prompt}`),
`inject-contract [--target <id>]` (пишет в docFile адаптера через обычный writeFile -
это Markdown, не JSON).

---

## Phase 3 - Enforcement hooks, 2-4 дня

### 3.1 `scopelock hook gate` (скрытая команда, вызывается хуками)

Бюджет: p95 < 100ms. Никаких LLM/network. Правила поведения (из уроков Traycer):
тихий stdout, никогда не ломает сессию агента, graceful noop.

Алгоритм: stdin JSON -> Zod-схема хука (у Claude PreToolUse: `tool_input.file_path`) ->
не распарсилось -> noop. Нет git-репо/активного контракта -> noop
(`{decision: "noop", reason: "no-active-contract"}` в data). Путь matched forbidden
или outside planned: mode strict -> exit 2 + короткое сообщение в stderr (Claude
блокирует действие по exit 2); mode warn -> exit 0 + append-строка в
`reports/audit.ndjson` `{ts, path, verdict}`.

Скорость: читать только config + active contract (2 маленьких файла), git не вызывать
(repo root от cwd хука известен - искать `.scopelock/` вверх по дереву).

### 3.2 Генераторы конфигов

`core/harness/claude-hooks.ts`: фрагмент для `.claude/settings.json` -
`hooks.PreToolUse[]` c matcher `Edit|Write|MultiEdit`, command `scopelock hook gate`.
`core/harness/cursor-hooks.ts`: фрагмент для `.cursor/hooks.json` -
`afterFileEdit` -> `scopelock hook audit` (только лог; deny в Cursor для file ops
игнорируется - известный баг июля 2026, полагаемся на audit + post-run check).

Merge-правила (общий модуль `core/harness/hooks-merge.ts`):
- читать существующий файл; невалидный JSON -> CliError `HOOKS_FILE_INVALID` (не затирать);
- свои entries идентифицировать по подстроке `"scopelock hook"` в command;
- install идемпотентен (повтор не дублирует), uninstall удаляет ТОЛЬКО свои entries;
- запись через writeJsonAtomic.

### 3.3 CLI: `hooks install --target claude|cursor [--mode warn|strict]`,
`hooks uninstall --target ...`; mode пишется в config. `doctor` дополняется
проверками: hooks установлены, наши entries на месте, чужие не тронуты.

### DoD Phase 3
- [ ] Live-тест с Claude Code: правка вне scope в strict блокируется, в warn попадает в audit.ndjson.
- [ ] Live-тест с Cursor: afterFileEdit пишет audit-события.
- [ ] `gate` на 1000 вызовов подряд: p95 < 100ms (простой bench-скрипт).
- [ ] install/uninstall идемпотентны, пользовательские hooks не повреждаются (тест на fixture с чужими entries).

---

## CHECKPOINT (после Phase 3) - dogfood + Stage 0 validation

Продукт полноценен без LLM: ручной контракт -> prompt -> hooks -> drift report.
1-2 недели использования на реальных задачах + 10-15 внешних пользователей.
Kill-вопрос: "почему не Spec Kit / Traycer" (см. round 2). Gate не пройден ->
фазы 4-6 пересматриваются, деньги/время не тратятся.

---

## Phase 4 - Repo manifest DONE; LLM planner отложен/NO-GO без нового сигнала

> Deterministic manifest builder завершён в Task #0035. Generic LLM planner не
> реализован: research Task #0036 подтвердил коммодитизацию и отсутствие причины
> добавлять provider/API слой до нового пользовательского evidence.

- `core/manifest/build.ts`: `git ls-files` + детект projectType по манифестам
  (package.json/*.gradle/Package.swift/Podfile/pubspec.yaml) + test dirs.
  Сжатие до бюджета ~4-8k токенов: директории схлопываются в `dir/ (N files)`,
  полные пути только для директорий, лексически релевантных task-строке.
- `core/planner/provider.ts`: интерфейс `generateDraft(task, manifest, template) ->
  Promise<unknown>`; реализации openai/anthropic/openrouter (официальные SDK,
  structured output). Ключи: env `SCOPELOCK_API_KEY` или `~/.scopelock/config.json`.
  **Privacy-инвариант: наружу уходят только пути и метаданные, никогда содержимое файлов.**
- `core/planner/validate.ts`: Zod parse -> 1 repair-retry (в prompt добавляются ошибки) ->
  path guard: каждый `node.paths` обязан матчить хотя бы один файл manifest, иначе
  node.type = "unknown", путь переносится в openQuestions.
- CLI `plan "<task>" [--manual]`: draft в `contracts/draft-<id>.json`; `--manual` -
  пустой шаблон без LLM. Draft НЕ активируется - только `approve`.
- Тесты: manifest builder на fixture-дереве; validate на битых LLM-ответах
  (fixtures); path guard на галлюцинированном пути.

## Phase 5 - Narrow MCP server DONE (Task #0034)

> Step 5.0 buy-vs-build, Step 5.1 implementation и Step 5.2 live Codex client
> validation завершены. Ниже сохранено исходное ТЗ как decision record; это не
> текущая задача.

> **ЧИТАТЬ ПЕРВЫМ:** `plans/competitive-landscape-2026-07.md`. Наш исходный
> план «MCP scope-enforcement server» — near-clone существующего
> `logi-cmd/agent-guardrails` (contracts + scope/tests/risk checks + MCP +
> multi-harness, ~8★, zero traction). Строить общий enforcer вслепую = вторая
> итерация ошибки «строить коммодитизированное» (как убитый LLM-планировщик,
> #0002/#0016). Поэтому шаг переработан: сперва spike-гейт buy-vs-build, затем
> — узко-дифференцированный MCP-сервер, а не clone.

### Step 5.0 — Buy-vs-build spike (ОБЯЗАТЕЛЬНЫЙ гейт, ~1 сессия)

Docs-only, кода не писать. Установить и реально погонять на настоящей работе
двух ближайших конкурентов:
- `logi-cmd/agent-guardrails` (наш near-clone: contracts, scope/test/risk, MCP);
- `wit` (AST function-level locking — дифференциатор disjointness, но per-language).

Ответить письменно в новом `plans/mcp-spike-verdict.md` на ОДИН вопрос:
**«что ScopeLock делает, чего эти инструменты НЕ делают, и что я реально
почувствовал как нехватку, погоняв их?»** Сверить по двум осям, где мы
теоретически сильны (см. competitive doc §«Где ScopeLock дифференцирован»):
1. **Real-time pre-tool-use deny** (наш hook gate) vs **pre-merge check**
   (agent-guardrails). В auto-mode/proactive loops (без человека на каждом шаге)
   реально ли ощущается разница?
2. **Language-agnostic glob-disjointness + picomatch-witness** (наш
   plan-parallel) vs **AST-locking** (wit) vs **worktree-изоляция** (Conductor).

**Kill-criterion:** если agent-guardrails + Claude Code native hooks/loops
покрывают ≥90% того, что дал бы наш MCP-сервер, — НЕ строить его; вместо этого
либо контрибьютить в существующее, либо переоценить проект. Записать verdict:
GO (строить 5.1 с чётким списком «что именно уникального») / NO-GO (что
покрыто и чем заменяемся).

### Step 5.1 — MCP server (только если spike = GO), 2-3 дня

`packages/mcp`: `@modelcontextprotocol/sdk`, stdio. Тонкие обёртки над core
(НИКАКОЙ логики в mcp-пакете; схемы аргументов - Zod из core). Область строго
ограничена ДВУМЯ дифференциаторами, не общий enforcer:

1. **`plan_parallel(plan)` / `scopes_conflict(a,b)`** — детерминированный,
   language-agnostic wave-scheduler с picomatch-witness. Это то, чего нет у
   agent-guardrails (нет scheduling) и что у wit только per-language через AST.
   Даёт in-loop агенту (в т.ч. platform dynamic workflows) ответ «эти подзадачи
   безопасно параллелить? где именно конфликт?».
2. **`check_drift()`** как verification-tool для `/goal`-лупа (детерминированная
   метрика «остался в scope: да/нет» — ровно то, что `/goal` любит), +
   опора на уже готовый **real-time hook gate** как enforcement в auto-mode
   (наш дифференциатор №1 vs merge-gate agent-guardrails).

Не дублировать 5 проверок agent-guardrails как «ещё один enforcer». Позиция —
**guardrail-слой ДЛЯ платформенных loops/auto-mode**, где enforcement нужен
больше всего (человек не аппрувит каждый шаг), а не конкурент оркестраторам.

В `inject-contract`/prompt добавить строку: "before finishing, call the
scopelock check_drift tool and resolve violations". README-сниппеты конфигов
для Cursor/Claude Code. Тест: smoke через MCP inspector + dogf- прогон в реальном
Claude Code (вызвать оба tool из агентного цикла).

### DoD Step 5 (делегируемый)

- `plans/mcp-spike-verdict.md` создан, вердикт GO/NO-GO зафиксирован с
  конкретикой (не «кажется, полезно»).
- Если GO: `packages/mcp` собирается (`pnpm -r build`), smoke через MCP
  inspector зелёный, оба tool вызываются live из Claude Code; core/cli тесты не
  сломаны; `check-drift` = 0 под контрактом шага; README дополнён; component-map
  и tasks/activeContext обновлены; коммит. Push - только по явной просьбе.
- Всё под активным ScopeLock-контрактом (dogfooding). Планируемый scope:
  `packages/mcp/**`, `packages/core/src/index.ts` (реэкспорт при нужде),
  `README.md`, `memory-bank/**`; forbidden - остальной `packages/core/**`,
  `packages/cli/**`.

## Security M0 - Trustworthy beta release gate, 5-8 дней

### Почему эта фаза обязательна сейчас

ScopeLock уже выполняет команды, устанавливает hooks, читает agent configuration и
создаёт receipts. Значит, продукт сам находится на security boundary. До внешнего
beta нельзя добавлять новые execution surfaces, пока не закрыты найденные пути
обхода и пока документация не отделяет реальные гарантии от best-effort checks.

**Целевой threat model:** ScopeLock защищает от ошибочного scope drift,
несогласованных действий нескольких агентов и случайного изменения trusted
configuration. ScopeLock **не является OS sandbox** и не защищает от злонамеренного
процесса, которому пользователь уже дал unrestricted shell с теми же правами.

**Release gate:** Phase 6, npm publish и публичный design-partner pilot не начинать,
пока M0.1-M0.8 не выполнены и M0.9 review не дал GO.

### Не строить в M0

- cloud control plane, daemon, accounts, RBAC или remote policy service;
- собственную криптографическую PKI;
- контейнерный orchestrator или кроссплатформенный OS sandbox;
- generic secret manager;
- подписанные receipts до подтверждения, что локального integrity seal недостаточно.

### M0.1 - Безопасные identifiers и path containment (P0)

**Цель:** ни один contract id, active id, receipt path или MCP contract path не
должен неявно читать/писать за пределами разрешённого root.

Изменения:

- `packages/core/src/schemas/contract.ts`: добавить единый `contractIdSchema`
  (`^[a-z0-9][a-z0-9._-]{0,63}$`) и применить его к `approvedContractSchema.id`;
- `packages/core/src/storage/contracts.ts`: добавить containment helper на
  `resolve()` + `relative()` и использовать его в save/load/exists call sites;
- `packages/cli/src/commands/approve.ts`: проверять destination через core helper,
  не собирать путь повторно через `join`;
- active pointer с небезопасным id считать integrity error, а не `null`;
- receipt path оставить user-selectable, но artifact directory обязан быть внутри
  выбранной receipt directory и не проходить через symlinked parent;
- MCP paths закрываются отдельно в M0.7.

Обязательные тесты:

- ids `../../config`, `a/b`, абсолютные POSIX/Windows paths, Unicode separators;
- valid ids с `.`, `_`, `-`, длина 64; длина 65 отклоняется;
- malicious active pointer не читает файл вне `contractsDir`;
- symlinked parent не позволяет записать artifact за intended directory.

DoD: все storage path operations используют один helper; `rg` не находит других
`join(paths.contractsDir, ...)` с внешним id.

### M0.2 - Явная модель доверия к plan и безопасный dispatcher (P0)

**Цель:** клонированный `plan.json` не должен незаметно превращаться в shell script.

Изменения:

- argv array остаётся основным форматом и запускается только с `shell: false`;
- string command отклоняется по умолчанию; совместимость доступна только через
  явно названный `--allow-shell` с warning в human и JSON output;
- перед dispatch receipt получает SHA-256 исходных bytes plan и всех contracts;
- human mode до запуска печатает task id + executable + contract id;
- non-interactive execution должно передать `--yes`; demo/benchmark scripts
  обновляются явно, чтобы опасное действие было видно в call site;
- добавить per-task timeout и graceful process-tree termination;
- stdout/stderr писать streaming, с лимитом памяти; не накапливать unlimited string;
- environment inheritance пока сохраняется для agent CLI compatibility, но это
  явно документируется как trusted-plan boundary. `--clean-env` отложить до
  отдельного compatibility spike.

Обязательные тесты:

- string command без `--allow-shell` не запускается;
- shell metacharacters внутри argv остаются обычным аргументом;
- plan digest меняется при одном изменённом byte;
- timeout завершает child и даёт typed result;
- бесконечный stdout не увеличивает память без границы;
- Windows `.cmd` compatibility тестируется только в explicit shell mode.

DoD: ни один default dispatcher path не использует `shell: true`; документация
называет plan executable code и требует доверять его источнику.

### M0.3 - Approval integrity seal и self-protection (P0/P1)

**Цель:** approved contract не должен тихо меняться после approval.

Минимальная архитектура:

- создать user-local store вне repo:
  `~/.local/state/scopelock/<sha256(realpath+git-common-dir)>/approval.json`
  (Windows/macOS paths через стандартные platform locations);
- directory mode `0700`, files `0600`; atomic write;
- seal v1: repo fingerprint, contract id/digest, baseline SHA, config digest,
  relevant hook config digests, approvedAt, ScopeLock version;
- `approve` создаёт seal; `rebaseline` обновляет его только после успешной записи;
- hook gate, `run`, `check-drift` и `agents preflight` проверяют seal до использования
  trusted contract;
- mismatch: strict = deny/block, warn = audit + degraded receipt;
- hardcoded self-protected paths: active contract, `.scopelock/config.json`,
  `.scopelock/contracts/**` и ScopeLock hook entries нельзя менять через agent edit
  во время активного strict run независимо от user contract scope;
- ручная maintenance-команда должна быть явной; не добавлять скрытый env bypass,
  который сможет выставить сам агент.

Ограничение зафиксировать в docs: seal защищает от repo-local mutation и даёт
tamper evidence, но не от unrestricted same-user malicious shell. Для последнего
нужен sandbox, которого в M0 нет.

Обязательные тесты:

- contract/config/hook byte mutation после approve;
- stale/missing seal; moved repository; rebaseline update;
- strict блокирует, warn деградирует;
- foreign hook entries не включаются в ScopeLock-owned digest или сохраняются при
  reinstall согласно выбранной canonicalization policy;
- permissions проверяются на POSIX, Windows test проверяет отсутствие regression.

### M0.4 - Безопасная Codex hook verification (P0)

**Цель:** verification не должна запускать agent с отключёнными sandbox и approvals
в пользовательском repository.

Порядок:

1. Сделать короткий compatibility spike доступных Codex CLI flags и событий.
2. Удалить default использование `--dangerously-bypass-approvals-and-sandbox`.
3. Probe запускать в одноразовом temp fixture с минимальными instructions,
   sanitized environment, timeout и удалением fixture.
4. Если невозможно доказать trust реального repo без unsafe mode, результат
   остаётся `degraded`; это валидный исход, не повод возвращать bypass.
5. `--codex-bin` резолвить как executable path. На Windows не передавать
   пользовательскую строку в shell; `.cmd` shim обрабатывать через безопасный
   platform-specific launcher или отклонять с actionable error.
6. `live-verified` требует structured evidence, отсутствия mutation и записи
   версии/пути/digest executable. Regex по словам `denied|ScopeLock` недостаточен.

Kill criterion: если безопасный live probe невозможен, удалить команду verify из
публичного UX и оставить config probe + honest degraded confidence.

### M0.5 - Hook fail semantics, empty scope и filesystem escapes (P1)

**Цель:** strict действительно означает deny при повреждённой trusted state.

Изменения:

- schema v2: пустой planned scope = deny-all; unrestricted contract возможен только
  через явное поле/CLI flag `allowAllPaths: true`;
- migration reader для v1 не должен молча менять смысл старых contracts; v1 с
  пустым scope получает warning и требует re-approve;
- malformed recognized mutation event, missing active contract при установленном
  strict hook, invalid config/contract/seal = deny с reason code;
- `no-scopelock-root` остаётся noop, чтобы global hook не ломал чужие directories;
- warn/audit остаётся fail-open, но пишет hook error;
- перед allow проверять realpath ближайшего существующего parent; запись через
  symlink, выходящий из repo root, deny;
- skill digest walker сообщает nested symlink violation вместо silent ignore;
- hook coverage table фиксирует: Claude Edit/Write/MultiEdit, Codex apply_patch,
  Cursor post-write audit; Bash/shell не объявлять pre-write protected.

Обязательные reason codes и tests: `invalid_input`, `missing_active_contract`,
`integrity_mismatch`, `gate_error`, `symlink_escape`, `outside_scope`, `forbidden`.

### M0.6 - Privacy-safe receipts и audit data (P1)

**Цель:** flight recorder не должен становиться хранилищем credentials.

Изменения:

- `.scopelock/reports` mode `0700`; receipt/artifacts `0600` на POSIX;
- основной receipt хранит digest, byte counts, exit status и redacted bounded preview;
- raw command/stdout/stderr выключены по умолчанию; включаются через
  `--store-raw-output` с явным warning;
- redaction до записи: известные token/key patterns, credential URL, common secret
  environment names; redaction отмечается count-ом без сохранения исходного value;
- абсолютные local paths в portable receipt заменить repo-relative, где возможно;
- добавить max artifact bytes, retention guidance и `scopelock reports clean` только
  после подтверждения реальной UX-потребности; в M0 достаточно documented cleanup;
- receipt v4 schema валидируется перед записью; raw artifacts остаются gitignored;
- честно назвать receipt tamper-evident only when seal/digest anchored; обычный local
  JSON не называть криптографически подписанным доказательством.

Тесты должны включать fake API keys в command/stdout/stderr и доказать, что secret
bytes отсутствуют и в receipt, и в default artifacts.

### M0.7 - MCP root confinement (P1)

**Цель:** MCP client не может использовать ScopeLock как confused deputy для чтения
или записи других repositories.

Изменения:

- server получает единственный root при старте (`--repo-root` или cwd) и canonicalizes
  его через realpath + git root;
- убрать `repoRoot` из public tool inputs;
- absolute contract paths запрещены; relative path обязан оставаться внутри root;
- `check_drift` пишет только в `.scopelock/reports` pinned root;
- добавить read-only server mode; mutation tool отсутствует в M0;
- tool errors не возвращают raw filesystem paths сверх необходимого.

Тесты: second repo rejection, absolute path rejection, `../` traversal, symlink escape,
valid worktree root, no report outside pinned root.

### M0.8 - Supply chain и публичные trust artifacts (P1/P2)

Repository:

- `.github/workflows/test.yml`: `permissions: contents: read`, job timeout,
  `persist-credentials: false`, official actions pinned на full commit SHA;
- добавить dependency update automation, CodeQL и gitleaks/secret scan;
- branch protection: required matrix checks, no direct force-push to release tags;
- создать `SECURITY.md` (private disclosure + support window), `THREAT-MODEL.md`,
  `PRIVACY.md`, security-boundaries section в README;
- CI проверяет `pnpm audit --prod` и secret scan; audit failure policy начинается с
  high/critical, чтобы не создать постоянно игнорируемый noisy gate.

npm release:

- Trusted Publishing/OIDC вместо long-lived npm token;
- provenance enabled, package account 2FA, traditional automation tokens disabled;
- protected GitHub environment с manual approval;
- `npm pack --dry-run` allowlist, install smoke из tarball, затем publish;
- SBOM/attestation расширять после первого публичного release, не строить вручную.

### M0.9 - Финальный adversarial review и GO/NO-GO

Перед GO выполнить на temp fixtures:

- malicious contract id/path traversal;
- modified approved contract/config/hook after seal;
- untrusted plan с shell metacharacters и fake secrets;
- malformed hook payload в strict и warn;
- symlink escape из planned directory;
- MCP попытка прочитать второй repo;
- child timeout/output flood;
- install tarball на чистых Linux/macOS/Windows runners.

Общие проверки: `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm audit --prod`,
CodeQL, secret scan, `git diff --check`, live Wallet demo в safe mode.

GO только если нет P0/P1 findings, docs совпадают с фактической harness coverage,
а demo не требует unsafe bypass. Иначе beta остаётся private/informed pilot.

### Рекомендуемый порядок коммитов

1. `fix(core): confine contract identifiers and paths`
2. `feat(core): seal approved contract integrity`
3. `fix(cli): require explicit trust for executable plans`
4. `fix(cli): isolate or remove unsafe Codex verification`
5. `fix(core): harden strict hook failure semantics`
6. `feat(cli): redact and protect receipt artifacts`
7. `fix(mcp): pin server access to one repository`
8. `ci: harden supply chain and add security scans`
9. `docs: publish threat model privacy and security policy`

Каждый коммит должен быть independently green и не смешивать schema migration,
process execution и CI changes.

### Implementation status 2026-07-11

M0.1-M0.8 implemented in the working tree under contract
`security-m0-trustworthy-beta`.

- M0.1: contract ids and contract storage paths are confined.
- M0.2: executable plans require explicit `--yes`; shell strings require
  `--allow-shell`; inputs are hashed in receipt.
- M0.3: approval integrity seal lives in user-local state and is checked by
  `run`, `check-drift`, hook gate and MCP drift.
- M0.4: unsafe Codex sandbox/approval bypass was removed from `hooks verify`.
- M0.5: strict hook paths fail closed and reject ScopeLock-state edits and
  symlink escapes.
- M0.6: receipt v4 stores redacted bounded previews by default; raw redacted
  artifacts require `--store-raw-output`.
- M0.7: MCP tools are pinned to one repo root and reject absolute/traversal/
  symlink-escaping contract paths.
- M0.8: CI has read-only permissions, timeouts, pinned official actions,
  audit high gate, Dependabot, CodeQL, Gitleaks, and public security docs.

Verified: `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm audit --prod
--audit-level high`, `git diff --check`, `npm pack --dry-run`, `pnpm pack`
tarballs, and local tarball install smoke. `check-drift` has no outside-scope
violations after reseal; high-risk warnings for `.github/workflows/*` and
`pnpm-lock.yaml` are expected because CI/security and publish dependency
metadata changed.

Release-pack finding fixed: package `files` allowlists now exclude compiled
test artifacts. Internal dependencies use `workspace:^`; `pnpm pack` transforms
them to `^0.1.0` in tarballs.

Remaining gate: npm trusted publishing/OIDC plus tarball install smoke on clean
Linux/macOS/Windows runners before public beta.

## Phase 6 - Mermaid + mobile templates, 2-4 дня

- `schemas/template.ts`: `{ schemaVersion, id, projectTypes[], risks[], requiredTests[],
  highRiskPatterns[] }`. `templates/{ios,android,kmp,react-native}.json` - данные,
  не код (permissions, deep links, navigation, analytics, l10n, a11y, offline,
  snapshot tests). Engine подмешивает `highRiskPatterns` активных шаблонов.
- `core/render/mermaid.ts`: contract -> `flowchart TD`, nodes с classDef по risk
  (`high` красный/`medium` жёлтый/`low` зелёный); drift report -> нарушившие nodes
  помечаются. Выход - fenced-блок в Markdown (GitHub/IDE рендерят нативно). Web UI не делаем.
- `core/render/markdown.ts`: полный отчёт (summary, violations, mermaid, чеклист
  тестов) - будущий PR-комментарий.

## Phase 7 - Дистрибуция, 1-2 дня

tsup-бандл CLI (core инлайнится), `npm publish scopelock` + `@scopelock/mcp`,
`npx scopelock init` без глобальной установки. README с демо-GIF
(task -> contract -> hooks -> нарушение -> drift report). CodeQL + gitleaks workflows.
LICENSE (текущий проект использует MIT), CHANGELOG.

---

## Сводка и порядок

| Фаза | Статус | Оценка |
|---|---|---|
| 0 Hardening | DONE 2026-07-05 | - |
| 1 Drift engine | DONE 2026-07-05 | 3-5 д |
| 2 Harness + prompt export | DONE 2026-07-05 | 2-3 д |
| 3 Enforcement hooks | DONE 2026-07-05 | 2-4 д |
| 3.5 Distribution unblocker | DONE 2026-07-05 (--local, npm-ready, contracts versioned) | - |
| CHECKPOINT: live UI dogfood | DONE 2026-07-07 (#0014, реальные Claude Code + Cursor) | - |
| Trialable v0.1 | DONE 2026-07-07 (#0015: README/LICENSE, `contract new`, hook-errors, CI matrix) | - |
| CHECKPOINT: интервью Stage 0 | **ОТЛОЖЕНО** решением пользователя (2026-07-07) до готовности демо-артефакта | - |
| **Orchestration / Flight Control** | **DONE + benchmarked** (#0019-#0033, #0037-#0042) | - |
| 4 Deterministic manifest | **DONE** (#0035); generic LLM planner deferred | - |
| 5 Narrow MCP server | **DONE + live Codex validated** (#0034) | - |
| Thin run dispatcher + bounded receipt | **DONE** (#0039-#0043) | - |
| Agent Environment Preflight | **NEXT: Step 0 buy-vs-build only** (#0044) | 1 session |
| **Security M0 trust hardening** | **NEXT / beta release gate** (#0045) | 5-8 д |
| 6 Mermaid + templates | | 2-4 д |
| 7 npm + security CI | | 1-2 д |

## Зафиксированные решения (не пересматривать без записи сюда)

1. Drift = baseline.headSha..HEAD + worktree; baseline штампуется в approve.
2. Exit codes: 0/1/2. 3. Hook gate: <100ms, тихий, noop-safe; default warn.
4. LLM опционален; наружу только manifest путей. 5. Web UI в v1 нет - Mermaid в MD.
6. Без демона/облака/auth. 7. picomatch `{dot:true}`, posix-пути, rename проверяет оба пути.
8. Codex enforcement = prompt + post-run (research spike по hooks - после checkpoint).

## Риски

| Риск | Митигация |
|---|---|
| Cursor deny-баг не чинится | Архитектура не зависит: audit + post-run check |
| False positives -> снос хуков | warn default; пустой scope не шумит; action в каждом message |
| Porcelain-парсер хрупкий | Байтовые fixtures + integration на реальном git; skip если git init недоступен |
| LLM галлюцинирует пути | Path guard против manifest, unknown nodes |
| Огромные монорепо | degraded mode (порог 10k), honest repoMode в отчёте |
| Spec Kit/Traycer закрывают нишу | Checkpoint-gate до инвестиций в фазы 4-6 |

---

## Review Phase 0-3 (Solution Architect audit, 2026-07-05)

Проверено: чтение всего кода core+cli; вне песочницы `27/27` тестов pass, 0 fail;
`hook gate` в strict корректно денаит forbidden (exit 2) и outside_scope (exit 2),
пропускает in-scope (exit 0). Собрано через ELECTRON_RUN_AS_NODE.

### Подтверждено корректным (не трогать)
- porcelain v2 parser: type 1/2/u/?, rename через двойной NUL, срезы полей корректны.
- diff.ts numstat -z: ветка rename (пустой path -> tokens[index+2]) верна.
- collectChangedFiles: dedup (worktree побеждает), фильтр `.scopelock/`, repo-state по .git/.
- path-rules: forbidden > planned, пустой planned = allow, rename проверяет оба пути.
- hook gate: noop-safe, тихий, читает только config+contract, git не вызывает.
- hooks-merge: идемпотентность, чужие entries сохраняются (isOwnEntry по "scopelock hook").
- registry `satisfies Record<AgentId>` - compile-time полнота.
- inject-contract идемпотентен, байты вне маркеров не меняются.
- exit-code контракт 0/1/2 соблюдён во всех командах.

### Findings (правки БЛОКИРОВАНЫ активным strict-контрактом - см. ниже)

| # | Severity | Файл | Проблема | Фикс |
|---|---|---|---|---|
| R1 | bug (portability) | `cli/commands/check-drift.ts` | имя отчёта `drift-${ISO}.json` содержит `:` - невалидно на Windows/NTFS | санитизировать `:` -> `-` в имени файла (checkedAt в данных оставить ISO) |
| R2 | quality (moat) | `core/rules/risk-rules.ts` | `.env*`, `Dockerfile*`, `Package.swift`, `pnpm-lock.yaml` привязаны к корню, не ловят nested | добавить `**/`-префиксы |
| R3 | robustness | `core/hook/gate.ts` / `cli/commands/hook.ts` | `readStdin` виснет на TTY без пайпа (ручной запуск) | guard `process.stdin.isTTY` -> noop |
| R4 | DX | `cli/commands/hooks.ts` | `hooks install` без `.scopelock/config.json` кидает сырой ENOENT | дружелюбная ошибка "run scopelock init" |
| R5 | consistency (minor) | `core/git/diff.ts` | numstat без `-M -C` (name-status с ними) - счётчики строк для rename неточны, пути не затронуты | добавить `-M -C` в numstat |

### Уже задокументировано, действий для v1 не требуется
- Global `mode` в config (не per-harness): приемлемо, т.к. audit форсит warn и deny-harness один.
- Installed hook command = `scopelock hook gate` требует `scopelock` в PATH: до npm publish нужен `pnpm link`/wrapper.

### Рекомендация (рефактор, не срочно)
- Вынести общий boilerplate CLI-команд (root resolution, loadConfig, exists) в `withRepoContext()`
  helper - по мере роста числа команд это снизит дублирование.

### Как применять фиксы R1-R5 (важно для дисциплины контракта)
Активный контракт `self-dogfood-docs-config-2026-07-05` (strict) запрещает
`packages/**` кроме docs/config. R1/R2/R5 = outside_scope, R3/R4 = forbidden.
Правильный workflow: создать новый контракт (например `phase3-review-fixes`) с planned
scope на эти файлы + required tests (unit на Windows-имя отчёта, на nested risk-паттерны),
approve, затем внести правки. Не отключать strict глобально ради обхода.

**Статус:** сделано. Контракт `phase3-review-fixes` (approve от e028fd6), фиксы R1-R5
внесены, +3 unit-теста, check-drift = 0 violations, коммит `1bd2512`.

---

## Phase 3.5 - Distribution unblocker (2026-07-05)

Причина: перед live-инвокацией в реальных Claude Code / Cursor UI и перед npm publish
всплыли три блокера. Сделано под контрактом `phase3.5-distribution` (approve от `1bd2512`).

### D1 - hooks install --local (главный разблокиратор live-теста)
Установленный хук звал `scopelock hook gate`, требуя бинарь в PATH, которого до publish нет.
- `claudeScopeLockEntry(commandPrefix)` / `cursorScopeLockEntry(commandPrefix)` теперь
  принимают префикс; дефолт `scopelock` (для commit в общий репозиторий).
- `hooks install --local` прошивает абсолютную команду `${process.execPath} "<abs>/index.js"`
  (путь в кавычках - в пути репо есть пробелы). В реале это `node "<abs>/index.js" hook gate`.
- `isOwnEntry` теперь детектит по подстроке `hook gate`/`hook audit` (а не `scopelock hook`),
  иначе `--local` entries не распознавались бы при uninstall.
- Проверено live: install --local -> запуск сгенерированной команды на forbidden path -> exit 2,
  deny-сообщение, БЕЗ глобального scopelock. Uninstall корректно чистит custom entries.

### D2 - npm-ready CLI
`packages/cli/package.json`: добавлены `description`, `license`, `files:["dist"]`.
`bin.scopelock` уже был. После publish: `npm i -g @scopelock/cli` даёт дефолтный путь без --local.

### D3 - контракты снова коммитятся (reproducible baseline)
Root `.gitignore` игнорировал весь `.scopelock/`, из-за чего approved-контракты и config
не версионировались - это ломает принцип "contract as shared artifact" и общий baseline.
Исправлено: игнорируем только `.scopelock/reports/` и `.scopelock/active` (как и задумано
в `.scopelock/.gitignore` от init). Контракты и config теперь под git.

### Тесты
+1 unit (custom --local prefix: генерация, детект, идемпотентность, uninstall). Итого 31/31 pass.

---

## Что дальше (актуальный roadmap, checkpoint-gate ещё НЕ пройден)

Порядок строгий - Phase 4 не начинать, пока не закрыт checkpoint.

1. **Live invocation (пользователь, в реальных UI):**
   - Claude Code: `scopelock hooks install --target claude --mode strict --local`, затем
     проверить, что `PreToolUse` реально блокирует Edit/Write на forbidden path. Главный риск -
     формат stdin-payload от Claude vs `hookInputSchema` (проверить `tool_input.file_path`).
   - Cursor: `scopelock hooks install --target cursor --mode warn --local`, проверить, что
     `afterFileEdit` пишет `.scopelock/reports/audit.ndjson`.
2. **Спрос (пользователь):** 5 быстрых интервью по Stage 0 script (обязательный вопрос
   "почему не Spec Kit / Traycer"), затем добить до 10-15 и принять go/no-go.
3. **После go:** Phase 4+ по основному плану выше (LLM-планировщик опционален, web UI нет в v1).

### Открытые вопросы (перенесены, для v1 приемлемы)
- Global `mode` в config, не per-harness. Приемлемо (audit форсит warn, deny-harness один);
  per-harness mode - кандидат в Phase 4.
- Абсолютный путь в `--local` конфиге машинно-зависим - поэтому это opt-in, а в общий репо
  коммитится дефолтный `scopelock`.
- **Stale baseline noise (новый finding, 2026-07-07):** если "отдыхающий" активный контракт
  (например `self-dogfood-docs-config`) имеет старый baseline, а с тех пор были approve+commit
  других контрактов (phase3-review-fixes, phase3.5-distribution), `check-drift` под старым
  контрактом честно, но неинформативно репортит ВСЕ эти уже одобренные коммиты как
  outside/forbidden - шум, а не реальный drift. Для v1 не блокер (contract-per-task workflow
  и так работает), но подсказывает на будущее: либо периодически "освежать" baseline
  отдыхающего контракта, либо дать `check-drift` понятие "changes already covered by other
  approved+merged contracts". Кандидат в backlog Phase 4+, не выше приоритета.

---

## Live UI dogfood (2026-07-07) - подтверждён в реальных Claude Code / Cursor

Закрывает первый пункт checkpoint-gate из CHECKPOINT self-dogfood ("live invocation").
Детали и владелец задачи - `tasks.md` → Задача #0014.

- Claude Code, strict, `--local`: forbidden-правка денаится ПРЕВЕНТИВНО (файл не записан,
  подтверждено `git status` без диффа), Claude сам вежливо сообщает о блокировке вместо падения.
  Planned-правка проходит нормально. Deny не пишет `audit.ndjson` (это только для warn) - ок.
- Cursor, warn, `--local`: `afterFileEdit` реально вызывается на agent-правку, `audit.ndjson`
  получает новую строку с реальным таймстампом, правка не блокируется.
- Housekeeping после теста: локальные абсолютные команды в `.claude/settings.json` /
  `.cursor/hooks.json` возвращены к committed-дефолту (`scopelock hook ...`), т.к. `--local`
  путь машинно-специфичен и не должен коммититься. `.pnpm-store/` добавлен в `.gitignore`.

Остаётся перед Phase 4: 5 → 10-15 интервью Stage 0 + go/no-go (на пользователе).

---

## АКТУАЛЬНЫЙ ПЛАН И СЛЕДУЮЩИЙ ШАГ (обновлено 2026-07-10) - читать первым

> Это самый свежий раздел. При расхождении с более ранними разделами верить
> этому разделу и `plans/agent-environment-preflight-plan.md`.

### Где мы сейчас

- Фазы 0-3.5 завершены: contract, drift engine, prompt injection и Claude/Cursor
  enforcement работают.
- Оркестрация M1-M5 завершена: glob-disjointness, conflict graph, write-write и
  read-write scheduling, cycle detection, `plan-parallel`.
- Narrow MCP завершён и live-проверен в Codex: `plan_parallel`,
  `scopes_conflict`, `check_drift` (Task #0034).
- Deterministic repo manifest builder завершён (Task #0035).
- Multi-agent benchmark и real Codex K=3 завершены: Flight Control устраняет
  violations/conflicts, но не обязан быть быстрее на каждом workload.
- Thin `scopelock run --plan` dispatcher завершён и dogfood-проверен.
- One-command Flight Control demo и baseline receipt завершены.
- Bounded receipt v2 завершён: previews остаются компактными, raw evidence
  хранится локальными artifacts; real Codex K=1 receipt уменьшен примерно с
  baseline 30 KB до 15 KB.

### Новый validated discovery signal

Design partner описал повторяющуюся multi-agent боль:

- разные `AGENTS.md`/`CLAUDE.md`/Cursor rule surfaces;
- разные skill/config directories;
- необходимость дублировать rules и skills;
- Cursor не всегда работает с symlink;
- разные hook capabilities и поведение между harness.

Research показал, что статическую часть уже во многом решают open Agent Skills,
`vercel-labs/skills --copy` и Ruler. Поэтому **не строить второй Ruler**.

Новый ScopeLock-кандидат, согласованный с Flight Control:

> Перед dispatch доказать, что каждый агент получил обязательные rules/skills и
> нужный enforcement; после run сохранить hashes/capability provenance в receipt.

### Важная техническая коррекция

Старый `HarnessAdapter` считает Codex hooks unsupported. Актуальная официальная
документация Codex описывает user/project lifecycle hooks и `PreToolUse`.
Не менять registry только по документации: сначала live probe в scratch fixture,
затем отдельный implementation contract.

Cursor capability также нельзя считать вечным `audit` или `deny`: hook behavior
зависит от версии и tool type. Архитектура должна разделять nominal documented
capability и observed/live-verified capability.

### СЛЕДУЮЩАЯ ЗАДАЧА (делегируемая): Agent Environment Preflight Step 0

Полное ТЗ:
`plans/agent-environment-preflight-plan.md` → **Step 0 - buy-vs-build
compatibility spike**.

Порядок жёсткий:

1. Создать внешний temp fixture, не менять ScopeLock product code.
2. Проверить `vercel-labs/skills --copy` на Claude/Cursor/Codex: physical files,
   hashes, update/remove, idempotence.
3. Проверить Ruler: rules, skills, MCP/config materialization, preservation
   чужих entries, idempotence и cleanup behavior.
4. Для реально установленных harness провести live sentinel + harmless deny
   probes. Неустановленный target = `blocked`, не `failed`.
5. Записать versions, commands, hashes, generated bytes, manual interventions и
   capability matrix.
6. Создать `plans/agent-environment-preflight-spike-verdict.md`.
7. Дать два независимых решения:
   - GO/NO-GO собственного static materializer;
   - GO/NO-GO ScopeLock environment attestation.

Kill-criteria:

- если Ruler + skills CLI покрывают >=90% static distribution и сохраняют
  foreign config, `scopelock agents apply` не строить;
- если preflight не обнаруживает ни одного meaningful mismatch/unreliable
  capability, environment attestation не строить;
- production code запрещён до письменного GO.

Step 0 DoD и точная fixture structure находятся в authoritative plan. После GO
production работа разбита на отдельные contracts/commits: core schemas/engine,
CLI, capability refresh + Codex hook, run/receipt integration, demo/pilot.
