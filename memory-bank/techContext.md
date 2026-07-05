# Технологический контекст

> **Что это.** Технические решения и инфраструктура проекта, организованные **по доменам**. Подробности отдельных компонентов — в `docs/component-map.md`. Паттерны — в `system-patterns/_index.md`. Decision-logs по конкретным задачам — в `archive/archive-NNNN-*.md` и `reflection/reflection-NNNN-*.md`.
>
> **Принципы.**
> - **Доменная структура.** Один раздел на каждую техническую плоскость (Frontend stack, Backend, State management, Realtime, Infrastructure, AI, …). НЕ хронология.
> - **Без декораций.** Никаких `(Апрель 2026)` / `(сессия #NNNN)` в заголовках.
> - **Узкие decision-logs сюда НЕ идут.** Конкретные баги/итерации/одноразовые решения живут в `archive/` + `reflection/`. Сюда — только то, что описывает _текущее устойчивое состояние_ или общий паттерн.
> - **Не дублировать `system-patterns/`.** Когда паттерн извлечён в отдельный файл — он там источник истины; в `techContext.md` достаточно одной строки с указателем «см. `system-patterns/<file>.md`».
> - **Обновляется только при значимых изменениях.** См. `/reflect` шаг 4 (significance gate): новая зависимость / major-bump, новый архитектурный паттерн (state/realtime/RLS/edge/cron), новая инфра-единица (bucket/edge function/cron/env var/таблица-домен), смена deploy.
>
> Заполни вручную или запусти `/mb-bootstrap`. Удали TODO по мере заполнения.

---

## 1. Frontend stack

### Базовый
Рекомендуемый MVP: Vite + React или Next.js. UI локальный, запускается из CLI в корне репозитория. Главный экран - preflight panel: task input, impact map, risks, tests, assumptions, approved prompt.

### Редакторы и текст
Не требуется для MVP.

### Медиа и файлы
Не требуется для MVP, кроме экспорта Markdown/Mermaid/JSON.

### UI-утилиты
Mermaid renderer для первой версии. React Flow отложить до появления реальной необходимости интерактивного graph editor.

### Тесты и dev-инфра
Покрыть schema validation, risk rules и diff matching fixtures. Визуальный renderer можно тестировать snapshot/DOM smoke-тестами. Инфраструктурные выводы из Traycer: `plans/traycer-infrastructure-lessons.md`.

---

## 2. Backend stack

### Проект
На старте backend не нужен. Использовать local runner/CLI, который сканирует repo и запускает локальный UI.

### API / Edge Functions / RPC
LLM calls через provider abstraction: OpenAI, Anthropic или OpenRouter. Важно иметь BYOK/local-first режим и no-code-storage policy.

### Storage
Локальные JSON/Markdown artifacts. SQLite отложить до появления поиска/истории. Хранить approved plans, project rules, risk templates и history of drift checks.

### Миграции
Не требуется для local MVP. Если появится SaaS, миграции и auth проектируются отдельно.

### RLS / authz паттерны
Не требуется до появления SaaS/backend.

---

## 3. State management

### Контексты
Определить после выбора UI stack. На старте достаточно локального состояния формы и plan editor state.

### Stores
Отложить. Не вводить global store до появления устойчивой необходимости.

### React Query / TanStack Query / SWR (если применимо)
Не требуется для local-only MVP. Может понадобиться при SaaS/GitHub integration.

---

## 4. Realtime / sync (если есть)

Не требуется для MVP.

---

## 5. Auth / Permissions

Не требуется для local-first MVP. Для team/GitHub stages понадобится отдельная модель access control.

---

## 6. AI infrastructure (если есть)

### Edge Functions / API
LLM используется для planning/classification, но не для скрытой authority. Основной output - structured JSON, валидируемый JSON Schema/Zod.

### Usage logging и rate limiting
Для local/BYOK MVP можно не вводить usage limits. Для SaaS позже: Free quota, Pro usage, Team GitHub checks.

### Structured plan pipeline

```text
Repo Scanner
  -> Repo Manifest
  -> LLM Planner
  -> JSON Schema Validation
  -> Deterministic Risk Rules
  -> Visual Renderers
  -> Approved Plan Artifact
  -> Contract Compiler (prompt + hooks + AGENTS.md section)
  -> Runtime Hooks (Claude Code deny; Cursor audit)
  -> Post-run Diff Checker
```

### Required plan fields

- `task`
- `projectType`
- `scope.plannedPathPatterns`
- `scope.forbiddenPathPatterns`
- `nodes[].paths`
- `nodes[].confidence`
- `nodes[].evidence`
- `risks[].mitigation`
- `tests[].command`
- `assumptions`
- `openQuestions`

---

## 7. Domain stack

Ключевые доменные модули будущего MVP:

- repo manifest builder;
- structured plan schema;
- deterministic risk rules;
- Mermaid/Markdown/prompt renderers;
- approved plan storage;
- local git diff checker.
- CLI runner with human + machine-readable JSON/NDJSON output;
- doctor diagnostics;
- hook exporters;
- MCP adapter later.

---

## 8. Mobile-specific patterns (если применимо)

Mobile templates должны включать risk/test categories для iOS, Android, KMP и React Native:

- permissions;
- deep links;
- navigation/state restoration;
- analytics events;
- localization;
- accessibility;
- offline/loading/error states;
- UI/snapshot tests.

---

## 9. Деплой и хостинг

Не требуется для local-first MVP. SaaS deployment отложен до подтверждения repeat usage.

---

## 10. Performance principles

Не индексировать и не отправлять весь репозиторий по умолчанию. Сначала строить compact repo manifest, затем расширять selected context только по необходимости.

## 11. Contract Compiler / Enforcement

Approved plan JSON компилируется в три слоя enforcement (мягкая деградация):

1. **Prompt contract** - ready-to-paste prompt + markdown-секция в `AGENTS.md`/`CLAUDE.md` (агент читает scope нативно, наш tool не нужен в runtime).
2. **Runtime hooks:**
   - Claude Code `.claude/settings.json` PreToolUse (matcher Edit|Write) - deny вне `plannedPathPatterns` и на `forbiddenPathPatterns`. Надёжно, первый target.
   - Cursor `.cursor/hooks.json` - `beforeShellExecution` (блокировка команд, работает) + `afterFileEdit` (аудит в drift log). ВНИМАНИЕ: `permission: deny` для file read/edit в Cursor игнорируется агентом (баг, июль 2026) - только best-effort/аудит.
3. **Post-run drift check** - source of truth, не зависит от hook-инфраструктуры агента.

Генерация hooks обязана быть idempotent и merge-friendly (не затирать пользовательские hooks).

**Интеграция без extension:** MCP server с tools `generate_preflight_plan`, `get_approved_contract`, `check_drift` - подключается к Cursor/Claude Code/Codex одной строкой конфига; вероятно, заменяет IDE extension (Stage 4).

## 12. Local Plan-vs-Actual

V1 drift check должен быть deterministic:

- `git diff --name-only` для changed files;
- glob/path pattern matching для planned/forbidden scope;
- эвристики test coverage по file names и folders;
- high-risk file list для config/build/migrations/auth/navigation;
- объяснимый warning с action.

## 13. CLI / Package Infrastructure

ScopeLock starts as a TypeScript/Node CLI with a small core package.

Recommended repo shape:

```text
scopelock/
├── packages/
│   ├── core/       # schemas, drift engine, rule engine
│   ├── cli/        # scopelock commands
│   └── mcp/        # later
├── templates/
│   ├── claude/
│   ├── codex/
│   └── mobile/
├── examples/
└── .github/workflows/
```

Recommended stack:

- TypeScript;
- Node 22+;
- pnpm;
- commander;
- zod;
- minimatch or picomatch;
- vitest;
- eslint/prettier;
- tsup or esbuild.

Avoid Bun/Nx on day one. Traycer uses them successfully for a large monorepo, but ScopeLock should stay simpler until complexity is earned.

### CLI runner pattern

Every command returns both human and machine-readable output:

```ts
type CommandResult = {
  data: unknown;
  human: string | null;
  exitCode: number;
}
```

Commands must support `--json` so agents, MCP tools and CI can consume results without parsing prose.

### Storage layout

```text
~/.scopelock/
├── config.json
└── logs/

<repo>/.scopelock/
├── config.json
├── contracts/
├── reports/
└── hooks/
```

All persisted JSON must include `schemaVersion` and be written atomically via temp file + rename.

### Doctor command

`scopelock doctor` checks git availability, repo-local config, approved contract validity, hook install state, hook conflicts, changed files and LLM config.

### Security CI

Minimum GitHub Actions:

- lint/test/build;
- CodeQL;
- gitleaks or equivalent secret scan.

---

## Куда смотреть дальше

| Вопрос | Файл |
|---|---|
| Где живёт компонент X? | `docs/component-map.md` |
| Как устроен крупный компонент Y? | `docs/architecture-{Y}.md` |
| Какой архитектурный паттерн применить? | `system-patterns/_index.md` → нужный файл |
| Уроки из прошлых рефлексий? | `reflection/lessons-registry.md` |
| Продуктовые сценарии? | `productContext.md` |
| Обзор проекта? | `projectbrief.md` |
