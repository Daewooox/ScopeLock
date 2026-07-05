# Strategy Review Round 2: рыночные поправки и enforcement-архитектура

> Дата: 2026-07-04. Дополняет `plans/agent-preflight-strategy-review.md` (round 1).
> Источник: глубокое PM + Solution Architect ревью PDF `visual_agent_preflight_strategy.pdf`
> с проверкой рыночных утверждений по состоянию на июль 2026.

## Вердикт round 2

Идея остаётся жизнеспособной, но главное утверждение PDF - "визуальный pre-flight слой
не закрыт крупными игроками" - фактически неверно. Ниша "plan before agent + verify after"
уже занята минимум тремя заметными продуктами. Продукт выживает только если сместить
центр тяжести с "visual plan" на то, чего у конкурентов реально нет:
детерминированный локальный drift check + enforcement через agent hooks + mobile risk templates.

---

## 1. Фактические ошибки и слепые зоны PDF

### 1.1. "Свободная ниша" - неверно

PDF (раздел 3) утверждает, что не закрыты: visual impact map до выполнения, plan approval
artifact, plan-vs-actual diff, cross-tool output. Проверка рынка (июль 2026):

| Конкурент | Что уже делает | Пересечение с планом PDF |
|---|---|---|
| **Traycer** (traycer.ai) | Planning + verification layer НАД coding agents. VS Code/Cursor/Windsurf extension. File-level планы с mermaid-диаграммами, handoff в Cursor/Claude Code/Copilot/Cline, post-hoc verification выполнения против плана, Phases для декомпозиции | Прямой конкурент: покрывает plan approval, cross-tool handoff, plan-vs-actual И mermaid-визуализацию |
| **GitHub Spec Kit** (~117k stars, MIT) | Spec-driven development CLI: constitution -> specify -> plan -> tasks -> implement. Agent-agnostic, 30+ агентов. Бесплатный, spec-файлы живут в репо | Покрывает "plan artifact как контракт" и cross-tool. Бесплатный OSS давит на pricing |
| **AWS Kiro** | Spec-first IDE: requirements (EARS), design.md, tasks.md как first-class объекты | Покрывает structured planning для enterprise/AWS |
| Tessl, OpenSpec, cc-sdd, amux | Разные веса той же SDD-методологии | Подтверждают: SDD - мейнстрим-тренд 2025-2026, не пустое поле |

PDF вообще не упоминает spec-driven development как категорию - это главная слепая зона документа.

### 1.2. Что ДЕЙСТВИТЕЛЬНО не закрыто (уточнённая дифференциация)

1. **Детерминированный, объяснимый, локальный drift check.**
   Spec Kit и Kiro не верифицируют результат против спеки вообще (это отмечают обзоры).
   Traycer верифицирует, но post-hoc, single-pass и через LLM - без объяснимых rule-based
   проверок (forbidden paths, missing tests, high-risk files). Наш rule-based drift check
   поверх `git diff` остаётся реальным отличием.
2. **Enforcement, а не только advice.**
   Никто не компилирует approved plan в runtime-ограничения агента. Cursor hooks и
   Claude Code hooks (PreToolUse) позволяют блокировать действия агента вне approved scope
   в реальном времени. Approved plan artifact -> generated hooks config = контракт,
   который агент физически не может молча нарушить. Это самый сильный кандидат на moat.
3. **Mobile-specific risk/test templates.** По-прежнему никем не заняты.
4. **Risk overlay как первоклассный слой.** У SDD-инструментов планы markdown-центричные,
   риски не структурированы и не привязаны к nodes/paths.
5. Visual impact map - теперь только UX-дифференциатор, НЕ moat (Traycer уже рисует mermaid).

### 1.3. Прочие поправки к PDF

- **Plan-vs-Actual отложен на Stage 3** - подтверждаю вывод round 1: это ошибка,
  drift check должен быть в MVP. Round 2 усиливает: без него продукт неотличим от Spec Kit.
- **Pasted repo tree как input** - даст правдоподобные, но выдуманные карты.
  Подтверждён вывод round 1: нужен local repo scan (git ls-files + manifests), не paste.
- **Метрика валидации "5/10 хотели бы"** - слабая. Round 2 добавляет обязательный вопрос
  валидации: **"почему не бесплатный Spec Kit / уже установленный Traycer?"**
  Если у 20 опрошенных нет внятного ответа - pivot или kill.
- **Pricing hypothesis ($8-15 Pro за планирование)** - завышена. Планирование само по себе
  коммодитизировано бесплатным OSS. Платить будут за drift/enforcement/templates/team,
  не за генерацию плана. Lifetime BYOK для local-first - самый честный первый оффер.
- **Источники PDF** валидны, но список неполон: нет Traycer, Spec Kit, Kiro, SDD-обзоров.

---

## 2. PM review round 2

### Уточнённое позиционирование

Было (round 1): "approved implementation contract + drift check".
Стало (round 2, с учётом конкурентов):

> AgentPreflight: локальный, детерминированный guardrails-слой для AI coding agents.
> Утверди scope/risks/tests как контракт, скомпилируй его в enforcement hooks агента,
> и получи объяснимый drift report после выполнения. Local-first, без отправки кода.

Ключевые слова против конкурентов: **deterministic** (vs LLM-verification Traycer),
**enforced** (vs advisory-планы Spec Kit), **local-first** (vs Kiro/AWS-perimeter),
**mobile-aware** (vs все).

### Позиционирование против каждого конкурента (elevator answers)

- vs Spec Kit: "Spec Kit создаёт план и надеется, что агент его выполнит. Мы проверяем
  и блокируем. Спека без верификации - это пожелание."
- vs Traycer: "Traycer верифицирует LLM-ом - недетерминированно и непрозрачно. Наш drift
  check - объяснимые правила: вот файл вне scope, вот отсутствующий тест, вот тронутый
  forbidden path. Плюс мы local-first: код не уходит на сервер."
- vs Kiro: "Kiro - AWS-периметр и их IDE. Мы работаем с любым агентом в любом редакторе."

### Обновлённые метрики валидации (дополняют round 1)

- Пользователь Spec Kit/Traycer называет конкретную причину переключиться или доплатить.
- Drift check ловит нарушение, которое пользователь признаёт реальным, минимум в 1 из 5 задач.
- Enforcement hook заблокировал/зафлагал out-of-scope edit хотя бы раз за первую неделю.

---

## 3. Solution Architect review round 2

### 3.1. Enforcement layer: approved plan -> agent hooks

Новый компонент pipeline - **Contract Compiler**. Из approved plan JSON генерируются:

1. **Claude Code hooks** (`.claude/settings.json`, PreToolUse matcher на Edit|Write):
   deny для путей вне `plannedPathPatterns` и любых `forbiddenPathPatterns`.
   Работает надёжно уже сегодня - это первый target.
2. **Cursor hooks** (`.cursor/hooks.json`):
   - `beforeShellExecution` - блокировка опасных команд: работает.
   - `afterFileEdit` - аудит фактических правок в drift log: работает (informational).
   - ВАЖНОЕ ОГРАНИЧЕНИЕ (июль 2026): `permission: deny` для file read/edit операций в
     Cursor игнорируется агентом (подтверждено форумом Cursor и известными баг-репортами).
     Поэтому для Cursor enforcement - best-effort + аудит, а source of truth -
     детерминированный post-run drift check.
3. **Post-run drift check** (`git diff --name-only` + path rules) - всегда работающий слой,
   не зависящий от багов hook-инфраструктуры конкретного агента.

Принцип: **enforcement - трёхслойный** (prompt contract -> runtime hooks -> post-run check),
деградирует мягко: если hooks не сработали, drift check всё равно поймает.

### 3.2. MCP server как канал дистрибуции

Вместо (или до) VS Code extension (Stage 4 в PDF) - выставить preflight как MCP server:

- tools: `generate_preflight_plan`, `get_approved_contract`, `check_drift`;
- подключается к Cursor/Claude Code/Codex одной строкой конфига - без extension development;
- агент сам может вызвать `check_drift` перед завершением задачи.

Это радикально дешевле по effort, чем extension, и решает проблему friction из PDF (риск
"developers не захотят отдельный tool").

### 3.3. Формат artifact: совместимость с экосистемой

- Source of truth: plan JSON (schema из round 1 остаётся в силе).
- Дополнительный рендер: markdown-секция контракта, вставляемая в `AGENTS.md`/`CLAUDE.md`,
  чтобы агент читал approved scope нативно, без нашего tool в runtime.
- Экспорт в Spec Kit-совместимый формат рассмотреть позже как interop-ход, не как MVP.

### 3.4. Обновлённый pipeline

```text
Repo Scanner
  -> Repo Manifest
  -> LLM Planner
  -> JSON Schema Validation
  -> Deterministic Risk Rules
  -> Visual Renderers
  -> Approved Plan Artifact
  -> Contract Compiler (prompt + hooks + AGENTS.md section)   <- новое
  -> Runtime Hooks (Claude Code deny; Cursor audit)            <- новое
  -> Post-run Diff Checker
```

---

## 4. Правки roadmap (дельты к round 1)

- **Stage 0 (concierge):** в интервью обязательно включить пользователей Spec Kit/Traycer;
  вопрос "почему не X" - kill-критерий.
- **Stage 1 (local prototype):** добавить генерацию Claude Code hooks из approved plan
  (дёшево, работает сегодня) и локальный drift check. Cursor hooks - experimental flag.
- **Stage 2 (solo MVP):** добавить MCP server и AGENTS.md/CLAUDE.md contract export.
- **Stage 3 (GitHub App):** без изменений.
- **Stage 4:** IDE extension пересмотреть - возможно, MCP server закрывает 80% ценности
  и extension не нужен вовсе.
- **Stage 5 (mobile cockpit):** без изменений, после traction.

---

## 5. Решения, зафиксированные в round 2

1. Ниша "visual plan before agent" занята; продаём deterministic guardrails + enforcement.
2. Contract Compiler и hooks-слой входят в архитектуру MVP (Claude Code first).
3. MCP server - предпочтительный канал интеграции вместо раннего IDE extension.
4. Post-run drift check - всегда source of truth; hooks - best-effort ускоритель.
5. Pricing якорить на drift/enforcement/templates, не на генерации плана.
6. Валидация обязана включать сравнение со Spec Kit и Traycer.

## 6. Открытые вопросы round 2

- Насколько стабильны Cursor hooks к моменту MVP (баг с deny для file ops)?
- Делать ли Spec Kit-interop (импорт их spec.md как input) для захвата их аудитории?
- Codex CLI: какой enforcement-механизм доступен (hooks/sandbox policies) - требует ресёрча.
- Не станет ли enforcement слишком раздражающим (false positives на legitimate refactors)?
  Нужен режим "warn-only" по умолчанию и "strict" по выбору.
