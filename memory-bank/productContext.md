# Продуктовый контекст

> **Что это.** Пользовательские сценарии и продуктовые решения, организованные **по доменам**. Технические детали реализации — в `techContext.md`. Расположение файлов — в `docs/component-map.md`. История изменений — в `archive/` + `reflection/`.
>
> **Принципы.**
> - **Доменная структура, не хронологическая.** Один раздел на каждый продуктовый домен. Новое решение встраивается в свой домен, не в конец файла как очередная декада.
> - **Без декораций в заголовках.** Никаких `(Апрель 2026)` / `(сессия #NNNN)` / `(задача #NNNN)` — это файл текущего состояния, не журнал.
> - **Обновляется только при значимых изменениях.** См. `/reflect` шаг 4 (significance gate): новый user-visible flow, смена default-поведения, новая граница прав, новый продуктовый принцип. Мелочи (CSS-фикс, i18n-ключ, перестановка кнопки) сюда НЕ идут — они ложатся в `reflection-NNNN-*.md` и `archive-NNNN-*.md`.
>
> Заполни вручную или запусти `/mb-bootstrap`. Удали TODO по мере заполнения.

---

## Кратко

ScopeLock помогает разработчикам контролировать AI coding agents: до запуска утвердить scope/risks/tests, после выполнения проверить, что фактический diff не вышел за контракт. Первая ниша - solo/senior developers, активно использующие Codex, Cursor, Claude Code или Copilot agent; wedge - mobile teams с iOS/Android/KMP/RN edge cases.

**Конкуренты и позиционирование.** Планирование до агента коммодитизировано (Traycer, GitHub Spec Kit, AWS Kiro, Tessl). Продаём не план, а deterministic guardrails: объяснимый drift check, enforcement через hooks, local-first. Elevator answers против каждого конкурента - в `plans/strategy-review-round2-market-corrections.md`.

---

## 1. Preflight Planning

### Пользовательский сценарий
- Пользователь запускает tool в корне репозитория или открывает локальный UI.
- Вводит task/issue, project type и при необходимости selected files/project rules.
- Получает impact map, assumptions, open questions, risks, test checklist и proposed agent prompt.
- Редактирует planned/forbidden scope до approval.

### Product requirements
- План должен быть editable, а не только generated.
- Каждый риск должен объяснять impact и mitigation.
- Каждый planned node должен иметь confidence и evidence, иначе пользователь не поймёт, почему ему доверять.
- Unknown/open questions должны быть честно показаны, а не замаскированы уверенной диаграммой.

---

## 2. Approved Plan Artifact

### Пользовательский сценарий
- Пользователь утверждает план как implementation contract.
- Экспортирует его в prompt для Codex/Cursor/Claude.
- Сохраняет artifact локально для последующей сверки.

### Product requirements
- Artifact должен быть переносимым: JSON + Markdown/Mermaid.
- Он должен содержать planned path patterns, forbidden path patterns, layers, tests, assumptions, risks.
- Prompt export должен быть "ready to paste" и явно говорить агенту не выходить за approved scope без запроса.

---

## 3. Plan-vs-Actual Drift Check

### Пользовательский сценарий
- После работы агента пользователь запускает drift check.
- Tool читает `git diff --name-only` и сравнивает changed files с approved plan.
- Пользователь видит warnings: changed outside scope, forbidden path touched, missing tests, high-risk files changed.

### Product requirements
- V1 должен быть объяснимым и rule-based.
- LLM classifier можно использовать позже, но не как единственный источник правды.
- Warning должен вести к конкретному action: ask agent to explain, revert, add tests, or update approved plan.

---

## 4. Mobile Risk Templates

### Пользовательский сценарий
- Пользователь выбирает iOS / Android / KMP / React Native.
- Preflight добавляет domain-specific risk/test checklist.

### Product requirements
- Mobile templates не должны сужать весь продукт до mobile-only.
- Это дифференцирующий wedge для первых пользователей.
- Шаблоны должны покрывать navigation, permissions, deep links, analytics, localization, accessibility, UI/snapshot tests.

---

## 5. Contract Enforcement (hooks)

### Пользовательский сценарий
- После approval пользователь включает enforcement: tool генерирует hooks-конфиг для его агента.
- Claude Code: PreToolUse deny блокирует edits вне planned scope и в forbidden paths.
- Cursor: beforeShellExecution блокирует опасные команды, afterFileEdit пишет drift log (deny для file ops в Cursor пока игнорируется агентом - известный баг, июль 2026).
- Агент физически не может молча выйти за контракт (там, где hooks надёжны) либо нарушение гарантированно попадает в post-run drift report.

### Product requirements
- Enforcement default - "warn-only"; "strict" режим включается явно (защита от false positives на legitimate refactors).
- Post-run drift check остаётся source of truth независимо от того, сработали hooks или нет.
- Генерация hooks должна быть idempotent и не затирать пользовательские hooks.

---

## 6. Multi-Agent Environment Preflight

### Пользовательский сценарий
- Пользователь назначает одну задачу или plan нескольким harness: Claude Code,
  Cursor и Codex.
- До запуска ScopeLock проверяет, что каждый target реально видит обязательные
  project rules и skills, а его hooks/config соответствуют требуемому уровню
  enforcement.
- Если правила или skills расходятся, отсутствуют либо представлены
  ненадёжным symlink, запуск блокируется или получает явное предупреждение с
  конкретным способом исправления.
- После выполнения receipt содержит версии harness и hashes эффективных
  rules/skills, чтобы результат можно было воспроизвести и объяснить.

### Product requirements
- Использовать открытые стандарты: `AGENTS.md` для durable project guidance и
  Agent Skills (`SKILL.md`) для reusable workflows. Не создавать собственный
  формат skills.
- Различать модель и harness. ScopeLock интегрируется с host/runtime, который
  владеет tools, hooks и config; отдельный adapter для GLM или другой модели не
  нужен.
- Статическую materialization rules/skills сначала покупать или интегрировать:
  Ruler и `skills` CLI с physical-copy mode должны пройти реальный spike до
  любого собственного sync engine.
- Уникальная ценность ScopeLock - не копирование файлов, а pre-dispatch parity
  check, capability evidence и run-level attestation в receipt.
- Nominal capability из документации недостаточна: hook enforcement должен
  иметь status `live-verified` либо честно деградировать до audit/post-run.
- Проверки local-first, deterministic и без LLM/network. В receipt запрещено
  сохранять содержимое rules, skills, secrets или raw configs; только hashes и
  ограниченные диагностические metadata.
- First slice поддерживает Claude Code, Cursor и Codex. Новые harness добавляются
  только после пользовательского сигнала и live fixture.

### Product boundary
ScopeLock не становится skill marketplace, универсальным rule manager,
Context Mode/RTK proxy или OpenHands-подобным runtime. Ruler/skills
распространяют; RTK/Context Mode оптимизируют контекст; harness исполняет;
ScopeLock проверяет готовность, координирует и доказывает результат.

Полный phased plan и decision gates:
`plans/agent-environment-preflight-plan.md`.

---

## Продуктовые принципы

- Не продавать "AI diagram generator": продуктовая ценность в контроле scope, risks, tests и drift.
- Не продавать "план": генерация плана коммодитизирована бесплатным OSS (Spec Kit). Монетизировать drift check, enforcement, mobile templates, team workflow.
- Plan-vs-Actual делать рано: это главный кандидат на moat.
- Local-first по умолчанию: privacy является частью value proposition.
- Mobile templates использовать как wedge, а не как ограничение всего рынка.
- Визуализация должна помогать принять решение, а не просто выглядеть красиво.
- Не обещать absolute correctness: продукт - decision support и guardrails.
- Уменьшать friction: output должен экспортироваться в уже используемые tools.
- Repeat usage важнее разового "вау": первый success metric - пользователь возвращается на следующую задачу.
- Small scriptable devtool first: ScopeLock не должен копировать Traycer как desktop/cloud/collaboration platform; первый продукт - CLI/MCP guardrails utility.
- Open standards before proprietary formats: `AGENTS.md`, Agent Skills и MCP
  являются integration boundaries; собственный формат вводится только для
  уникальных ScopeLock contracts/receipts.
- Verify before synchronize: если экосистема уже умеет разложить rules/skills,
  ScopeLock проверяет parity и provenance, а не дублирует materializer.
