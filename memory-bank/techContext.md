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

CodeQL SARIF upload needs GitHub Advanced Security, which is free for public
repos but unavailable on a private personal repo - `codeql.yml` briefly ran
with `upload: false` + artifact fallback while the repo was private, reverted
to `upload: true` once it went public (2026-07-12). `codeql.yml` needs
`permissions: actions: read` (an internal codeql-action API call 403s
without it) in addition to `security-events: write`. `secret-scan.yml`'s
`gitleaks-action` needs `env: GITHUB_TOKEN` and `permissions:
pull-requests: read` to list a PR's commits - without either it fails red on
every PR even though no secret was found.

### Git workflow and branch protection

Repo went public and `main` is protected by a GitHub **Ruleset** (2026-07-12,
not legacy branch protection - see
[About rulesets](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)).
Ruleset `protect-main` (id `18816875`) enforces on `refs/heads/main`:

- `pull_request` - required, `required_approving_review_count: 0` (solo
  maintainer - a PR is still mandatory, just no second reviewer is required),
  `allowed_merge_methods: ["squash"]`.
- `required_status_checks` (strict - branch must be up to date with `main`):
  `analyze` (CodeQL job), `gitleaks` (secret-scan job), and all 6 `test (os,
  node)` matrix jobs.
- `non_fast_forward` - no force-push to `main`.
- `deletion` - `main` cannot be deleted.
- `bypass_actors`: `RepositoryRole: admin`, `bypass_mode: always` - the repo
  owner can override in an emergency; nobody else can.

Repo-level merge settings: `allow_squash_merge: true`,
`allow_merge_commit: false`, `allow_rebase_merge: false`,
`delete_branch_on_merge: true` - squash is the only available method, feature
branches are deleted automatically after merge.

**Consequence for every agent (including this one): no direct `git push
origin main`, ever.** Workflow is `git checkout -b <branch>` → commits →
`git push -u origin <branch>` → `gh pr create` → wait for the required
checks to go green → `gh pr merge --squash --delete-branch`. Dependabot PRs
follow the same gate; if a PR's base falls behind `main` after another merge,
`gh api repos/<owner>/<repo>/pulls/<n>/update-branch -X PUT` re-syncs it
before the checks can pass again.

---

## 14. Agent Environment Compatibility

### Canonical artifacts

- Durable repo guidance: root/nested `AGENTS.md`.
- Reusable workflows: Agent Skills directories with required `SKILL.md` and
  optional `scripts/`, `references/`, `assets/`.
- Dynamic per-task policy: existing `.scopelock/contracts/*.json`.
- Run provenance: bounded ScopeLock receipt with hashes, not source contents.

ScopeLock must not invent a second skill standard. Static distribution is an
external/materializer concern until the mandatory Ruler + `skills --copy`
spike proves a concrete uncovered gap.

### Adapter model

`HarnessAdapter` must evolve from one coarse `hooksSupport` enum into:

1. static locations and nominal capabilities documented by the harness;
2. observed configuration/version/probe status returned per repository.

Nominal support never implies reliable enforcement. Each preflight result
records confidence as `documented`, `live-verified`, or `degraded`. Post-run
git drift remains the source of truth when a host ignores or skips a hook.

Current correction: Codex now documents lifecycle hooks, including project and
user `hooks.json`/`config.toml` layers and `PreToolUse`. The existing ScopeLock
registry value `hooksSupport: none` is stale and must be corrected only after a
live fixture confirms the exact event/response contract. Project-local Codex
hooks also depend on repository trust.

### Agent workspace manifest

The planned `.scopelock/agents.json` v1 declares only:

- target harness ids;
- required repo-relative rule files;
- required repo-relative skill directories;
- parity policy for physical copies and hashes.

It must not contain secrets, MCP credentials, raw agent config, model API keys,
or executable install commands. All JSON boundaries use Zod; all persisted JSON
uses `writeJsonAtomic` and `scopelockPaths()`.

### Preflight engine

Pure core logic discovers declared target locations, uses `lstat` to distinguish
physical files from symlinks, computes deterministic SHA-256 digests in sorted
repo-relative path order, and returns typed findings with severity/detail/fix.
It never executes skill scripts, starts agents, downloads packages, or performs
network calls.

CLI target: `scopelock agents preflight --manifest .scopelock/agents.json` with
existing exit contract `0` pass / `1` violations / `2` operational error.

### Receipt integration

After the standalone preflight is stable, `scopelock run --plan` may run it
automatically when an agent manifest exists. The bounded receipt stores:

- manifest digest;
- harness id/version;
- rules and skills digests;
- observed hook confidence;
- compact violation codes.

Raw rule/skill/config content is forbidden in the receipt. Optional raw probe
evidence uses local artifacts and the existing bounded-receipt pattern.

### Explicit exclusions

- no SQLite/FTS/session memory;
- no RTK/context-mode command proxy;
- no generic rule compiler before the buy-vs-build gate;
- no daemon/watcher/cloud sync;
- no model-specific adapters;
- no more than Claude/Cursor/Codex in the first slice.

Authoritative implementation sequence, tests, and stop conditions:
`plans/agent-environment-preflight-plan.md`.

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
