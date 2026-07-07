# Memory Bank — для AI-агента, работающего в этом проекте

> Этот файл читается **в начале каждой сессии**. Не удаляй и не сокращай его.

> **Новому агенту на этом проекте:** начни с `docs/agent-onboarding.md` —
> первоначальный сетап (порядок чтения, дисциплина контракта, команды, текущая задача).

## Что это

`memory-bank/` — структурированная память проекта. Содержит:
- что за проект (`projectbrief.md`, `productContext.md`, `techContext.md`) — **уровень обзора**, организованы по доменам
- текущий фокус (`activeContext.md`, `tasks.md`)
- историю задач (`archive/`, `reflection/`, `progress.md`)
- карты кода (`docs/component-map.md`, `system-patterns/`, `style-guide/`)
- большие планы и отложенная работа (`plans/`, `backlog/`, `audit-sql/`)

### Два уровня документации

**Уровень обзора** (`projectbrief.md`, `productContext.md`, `techContext.md`):
- Описывает _текущее устойчивое состояние_ продукта/стека.
- Организован **по доменам**, не хронологически.
- Без декораций `(Месяц YYYY)` / `(#NNNN)` в заголовках.
- Обновляется **только при значимых изменениях** (см. `/reflect` шаг 4 — significance gate).

**Уровень деталей** (`docs/`, `system-patterns/`, `style-guide/`, `reflection/`, `archive/`):
- Журнал решений, разбор компонентов, точечные паттерны.
- Обновляется по факту, без gate.

**Принцип:** мелочи (CSS-фикс, i18n-ключ, refactor одного хука, перестановка кнопки) идут в `reflection/` + `archive/` — НЕ в обзор. Иначе обзор за полгода превратится в неработающий хронологический мусор.

## Workflow одной задачи

```
/van → /plan → /creative → /build → /reflect → /archive
```

- **L1** (быстрый фикс): `/van → /build → /archive`
- **L2** (улучшение): `/van → /plan → /build → /reflect → /archive`
- **L3** (фича): `/van → /plan → /creative → /build → /reflect → /archive`
- **L4** (система): полный цикл + фазная реализация

Уроки извлекаются инкрементально в `/reflect` (шаг 3a) → `reflection/lessons-registry.md`.

## Дисциплина чтения (экономия токенов)

**Перед любым `Glob`/`Grep`/`Read` по коду** — сначала `docs/component-map.md` (маршрутизатор «файл → назначение»).

**Для `system-patterns/` и `style-guide/`** — ВСЕГДА сначала `_index.md`, потом точечно нужный файл.

**Для `plans/`, `archive/`, `reflection/`, `creative/`** — не читай пачкой. Только конкретный файл по ссылке из активной задачи или по запросу пользователя.

**Исключения:**
- `/van` и `/reflect` читают единый `reflection/lessons-registry.md` (один файл-указатель, не пачка рефлексий).
- `/van` шаг 1a сканирует последние ARCHIVED-маркеры в `tasks.md`.

## Параллельная работа (если в проекте несколько агентов)

Shared-файлы (`tasks.md`, `activeContext.md`, `progress.md`, `projectbrief.md`, `productContext.md`, `techContext.md`) могут содержать блоки разных задач/агентов. Защита — HTML-маркеры:

```markdown
<!-- TASK #NNNN BEGIN
     Owner: <agent-id>
     Started: <YYYY-MM-DDTHH:MMZ>
     Status: <in-progress | plan | creative | build | reflect | archive | done>
-->
## Task #NNNN — короткое название
...
<!-- TASK #NNNN END -->
```

**Главное правило:** свой блок — твой, чужие — никогда не трогай.

Per-task файлы (`archive/`, `reflection/`, `creative/`) — обычный markdown, маркеры не нужны (один файл = одна задача).

## Round/Iteration

Повтор бага = round N+1 той же задачи, **не новая задача**. В BEGIN-блоке добавляется поле `Iteration:` и список `Round-history:` с описанием каждого раунда.

## ARCHIVED-маркеры с TTL

После `/archive` в `tasks.md` остаётся однострочный указатель:

```markdown
<!-- TASK #NNNN ARCHIVED YYYY-MM-DD: archive/archive-NNNN-name.md -->
```

`/archive` шаг 3a автоматически удаляет указатели старше 7 дней.

## Структура

```
memory-bank/
├── README.md              ← этот файл
├── tasks.md               ← активные задачи + ARCHIVED-маркеры
├── activeContext.md       ← текущий фокус
├── progress.md            ← история реализаций
├── projectbrief.md        ← что за проект
├── productContext.md      ← продуктовый контекст
├── techContext.md         ← стек и зависимости
├── archive/               ← завершённые задачи (по одной .md на каждую)
├── reflection/            ← рефлексии (+ lessons-registry.md — реестр уроков)
├── creative/              ← дизайн-решения по фазам CREATIVE
├── plans/                 ← большие планы (см. WHEN_TO_USE.md)
├── backlog/               ← парковка отложенной работы (см. WHEN_TO_USE.md)
├── audit-sql/             ← SQL-чеки перед миграциями (см. WHEN_TO_USE.md)
├── docs/
│   ├── component-map.md   ← маршрутизатор «файл → назначение»
│   └── codex-*.md         ← адаптеры для Codex CLI
├── system-patterns/
│   ├── _index.md          ← таблица «паттерн → файл»
│   └── *.md
└── style-guide/
    ├── _index.md          ← таблица «тема → файл»
    └── *.md
```

## Если ты только что установил Memory Bank

- **Проект пустой:** заполни `projectbrief.md` (хотя бы 2-3 строки), запусти `/van <первая задача>`.
- **Проект уже с кодом:** запусти `/mb-bootstrap` — агент прочитает код и наполнит файлы.
