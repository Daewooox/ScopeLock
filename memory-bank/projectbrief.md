# Project Brief

> **Что это.** Нулевой документ проекта — новая сессия читает его первым, чтобы за 5 минут понять: что за проект, на чём построен, какие домены есть, где лежит код, как устроен memory-bank.
>
> **Чем НЕ должен быть.** Не журнал изменений (для этого есть `progress.md` + `archive/`). Не пересказ продуктовых сценариев (для этого `productContext.md`). Не разбор технических деталей (для этого `techContext.md`).
>
> **Принципы.** Файл организован по доменам, не хронологически. Без декораций `(Месяц YYYY)` / `(сессия #NNNN)` в заголовках. Обновляется только при значимых изменениях (см. `/reflect` шаг 4 — significance gate).
>
> Заполни вручную или запусти `/mb-bootstrap` для авто-сканирования. Удали TODO-комментарии по мере заполнения.

---

## 1. Что это

ScopeLock - local-first guardrails layer for AI coding agents. Продукт помогает разработчику утвердить intended scope, risks, tests и constraints до запуска Codex/Cursor/Claude/Copilot-style агента, а после выполнения сравнить approved plan с фактическим diff.

Отличие от AI diagram generators: диаграмма не является товаром сама по себе. Она служит интерфейсом к implementation contract и scope-drift контролю.

**Конкурентный контекст (июль 2026).** Ниша "план до агента" уже занята: Traycer (planning + verification layer над агентами), GitHub Spec Kit (~117k stars, бесплатный OSS SDD-toolkit), AWS Kiro (spec-first IDE). Дифференциация ScopeLock: детерминированный объяснимый drift check, enforcement approved plan через agent hooks, local-first privacy, mobile risk templates. Детали: `plans/strategy-review-round2-market-corrections.md`.

**Инфраструктурный ориентир.** Traycer полезен как инженерный reference для CLI/protocol/storage/CI практик, но ScopeLock должен идти противоположным продуктовым путём: маленький scriptable local devtool, не desktop/cloud/collaboration platform. Детали: `plans/traycer-infrastructure-lessons.md`.

---

## 2. Технологический стек

### Frontend
Пока не реализован. Рекомендуемый MVP стек: локальный web UI на Vite/React или Next.js, Mermaid renderer для первой версии визуализации.

### Backend
Пока не реализован. Рекомендуемый MVP: TypeScript/Node CLI/local runner, локальные JSON-файлы, LLM provider abstraction для OpenAI/Anthropic/OpenRouter. SQLite отложить до появления реальной истории/поиска.

### Тесты и dev-инфра
Пока не реализованы. Для будущего MVP важны schema validation тесты, deterministic drift-check тесты и fixtures на разных типах репозиториев.

---

## 3. Ключевые домены

### 3.1. Preflight Planning
- Превращает task/issue + repo manifest в structured implementation plan.
- Показывает planned layers/files, assumptions, open questions, risks и required tests.
- Позволяет пользователю отредактировать plan до передачи агенту.

### 3.2. Approved Plan Artifact
- Утверждённый JSON/Markdown artifact работает как контракт между developer и AI coding agent.
- Artifact экспортируется в prompt для Codex/Cursor/Claude и позже может использоваться в GitHub PR checks.
- В scope должны быть planned path patterns, forbidden path patterns, confidence и evidence.

### 3.3. Plan-vs-Actual Drift Check
- После работы агента продукт сравнивает approved plan с `git diff`.
- V1 должен находить изменения вне planned scope, forbidden files, отсутствие тестов и high-risk config/build/migration changes.
- Это главный кандидат на moat, потому что превращает визуальный план в проверяемый контрольный контракт.

### 3.4. Mobile Risk Templates
- iOS/Android/KMP/RN templates - сильный wedge, но не весь продукт.
- Mobile templates покрывают permissions, deep links, navigation, analytics, localization, accessibility, UI/snapshot tests.

---

## 4. Архитектура frontend

Код пока не создан. Рекомендуемая стартовая структура для MVP:

```
src/
├── app/              # routes / main shell
├── components/       # controls, plan panels, Mermaid preview
├── domain/           # plan schema, risk rules, diff checks
├── lib/              # LLM provider, git/repo manifest client
└── fixtures/         # sample repo manifests and diffs
```

**Точки входа в navigation knowledge:**
- `memory-bank/docs/component-map.md` — карта файлов с описанием. Читать ДО `Glob`/`Grep` по `src/`.
- `memory-bank/docs/architecture-*.md` (если есть) — deep-dive по крупным компонентам.

---

## 5. Архитектура backend / БД

Для MVP backend лучше заменить local runner:

- `agent-preflight` CLI запускается в корне репозитория.
- CLI собирает repo manifest через `git ls-files`, package manifests, test folders и selected files.
- UI отложен. Первым интерфейсом должен быть CLI с human Markdown output и machine-readable `--json`.
- Approved plans сохраняются локально как JSON/Markdown artifacts.
- SaaS/GitHub App появляются позже, после доказанного repeat usage.

---

## 6. Структура memory-bank

```
memory-bank/
├── projectbrief.md          # ← этот файл (нулевой документ)
├── productContext.md        # пользовательские сценарии по доменам
├── techContext.md           # технические решения по доменам
├── activeContext.md         # текущий фокус сессии
├── progress.md              # лог прогресса
├── tasks.md                 # активные задачи (с BEGIN/END блоками)
│
├── archive/                 # архивы завершённых задач
├── reflection/              # рефлексии (+ lessons-registry.md — реестр уроков)
├── creative/                # CREATIVE-фазы (дизайн-решения)
├── plans/                   # PLAN-фазы крупных задач
│
├── docs/                    # архитектурные доки + component-map.md
├── system-patterns/         # архитектурные паттерны (один файл = один паттерн)
│   └── _index.md
└── style-guide/             # дизайн-система
    └── _index.md
```

**Правила работы:**
- Перед `Glob`/`Grep` по `src/` — открыть `docs/component-map.md`.
- Для `system-patterns/` / `style-guide/` — сначала `_index.md`, потом нужный файл.
- `archive/` / `reflection/` / `plans/` пачкой НЕ читать — только конкретный нужный файл.
- В shared файлах memory-bank — только `Edit`, никогда `Write` (см. правило memory-bank-never-overwrite).

---

## 7. Workflow задачи

```
   /van           /plan            /creative          /build          /reflect       /archive
   ─────►─────────►──────────────────►─────────────────►────────────────►──────────────►
   Оценка        Детальный        Дизайн-решения     Реализация       Уроки          Финал
   сложности     план             (если Level≥3)     (код)            и паттерны     (memory-bank
   (Level 1-4)                                                                        update)
```

- **Level 1** — мелкий багфикс, `/van → /build → /archive`.
- **Level 2** — батч багов / средняя фича, добавляется `/plan` и `/reflect`.
- **Level 3-4** — крупная фича / архитектурное изменение, обязателен `/creative`.

**Итерации**: повтор того же бага = round N+1 той же задачи, не новая задача.

---

## 8. Ключевые правила и конвенции

### Из CLAUDE.md / AGENTS.md / .cursorrules (читается каждой сессией)
- Structured first: LLM возвращает валидный plan JSON, renderer строит Mermaid/Markdown поверх него.
- Local-first by default: не отправлять полный private code context без явного решения пользователя.
- Plan-vs-Actual early: drift check должен появиться уже в solo MVP, не после GitHub integration.
- Enforcement layered: approved plan компилируется в agent hooks (Claude Code deny, Cursor audit), но source of truth - детерминированный post-run drift check.
- Small scriptable devtool first: не строить Traycer-like desktop/host/cloud platform до доказанного спроса.
- Диаграмма служит decisions, а не vanity visuals.

### Дисциплина коммитов
Пока не определена.

---

## 9. Куда смотреть дальше

| Вопрос | Файл |
|--------|------|
| Где живёт компонент X? | `memory-bank/docs/component-map.md` |
| Какой архитектурный паттерн применить? | `memory-bank/system-patterns/_index.md` → нужный файл |
| Какие цвета/spacing/типографика? | `memory-bank/style-guide/_index.md` → нужный файл |
| Какие уроки уже извлечены? | `memory-bank/reflection/lessons-registry.md` |
| Подробная история продукта? | `memory-bank/productContext.md` |
| Подробные технические решения? | `memory-bank/techContext.md` |
| Текущий фокус сессии? | `memory-bank/activeContext.md` |
| Активные задачи? | `memory-bank/tasks.md` |
| Глобальные правила проекта? | `CLAUDE.md` / `AGENTS.md` / `.cursorrules` в корне |
