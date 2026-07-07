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

## Phase 4 - Repo manifest + LLM planner (опциональный слой), 3-5 дней

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

## Phase 5 - MCP server, 2-3 дня

`packages/mcp`: `@modelcontextprotocol/sdk`, stdio. Tools: `get_approved_contract`,
`check_drift`, `generate_preflight_plan` - тонкие обёртки над core (никакой логики
в mcp-пакете). Схемы аргументов - Zod из core. В inject-contract секцию добавить
строку: "before finishing, call the scopelock check_drift tool and resolve violations".
README-сниппеты конфигов для Cursor/Claude Code. Тест: smoke через MCP inspector.

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
LICENSE (Apache 2.0 - симметрично Traycer), CHANGELOG.

---

## Сводка и порядок

| Фаза | Статус | Оценка |
|---|---|---|
| 0 Hardening | DONE 2026-07-05 | - |
| 1 Drift engine | DONE 2026-07-05 | 3-5 д |
| 2 Harness + prompt export | DONE 2026-07-05 | 2-3 д |
| 3 Enforcement hooks | IMPLEMENTED 2026-07-05; live dogfood pending | 2-4 д |
| CHECKPOINT dogfood/validation | IN PROGRESS 2026-07-05; local + self-dogfood passed, live UI/user validation pending | 3-5 д |
| 4 Manifest + LLM planner | | 3-5 д |
| 5 MCP server | | 2-3 д |
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
