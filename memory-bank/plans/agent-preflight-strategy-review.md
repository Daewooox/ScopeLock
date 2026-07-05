# AgentPreflight Strategy Review

## Короткий вердикт

Идею стоит продолжать, но нужно сузить позиционирование. Сильная версия продукта - не "визуальная диаграмма до запуска агента", а vendor-neutral слой контроля:

> Approve the intended scope before an AI coding agent touches the repo, then verify that the actual diff stayed inside the approved contract.

Диаграмма важна, но она должна быть интерфейсом к scope, risks, tests и drift warnings, а не самостоятельным товаром.

## Исправленное позиционирование

### Было

Visual Pre-flight Review превращает задачу для AI-агента в визуальную карту реализации.

### Лучше

AgentPreflight creates an approved implementation contract for AI coding agents: intended files/layers, forbidden scope, risks, tests, assumptions, and a post-run drift check against the actual diff.

### Почему так

- Cursor, Codex, Claude Code и GitHub Copilot уже двигаются в planning, remote supervision, PR review и execution loop.
- Простую визуализацию планов крупные игроки могут встроить быстро.
- Более защищённая ниша - cross-tool approved plan artifact + local/GitHub plan-vs-actual verification.

## PM review

### Главный пользователь

Первый ICP: solo developer или senior/lead developer, который активно использует Codex, Cursor, Claude Code или Copilot agent и хочет быстро проверить scope перед запуском агента.

Вторичный ICP: mobile developers и teams с iOS/Android/KMP/RN, потому что у них много edge cases: permissions, deep links, navigation, analytics, localization, accessibility, UI/snapshot tests.

### Job-to-be-done

- Когда я ставлю задачу агенту, я хочу увидеть утверждаемый scope, чтобы понять, куда агент полезет.
- Когда агент предлагает план, я хочу редактировать его как implementation contract, а не читать длинный текст.
- Когда агент закончил, я хочу увидеть scope drift: что было запланировано и что реально изменилось.
- Когда я ревьюю AI-generated PR, я хочу быстро понять, какие риски и тесты обязательны.

### Сильные стороны идеи

- Не конкурирует напрямую с IDE-agent execution loop.
- Закрывает промежуточный checkpoint между intent и code changes.
- Даёт понятную боль: агенты ускоряют написание кода, но увеличивают нагрузку на человека как ревьюера намерений и результатов.
- Может быть cross-tool: Cursor, Codex, Claude Code, GitHub PR.
- Plan-vs-Actual может стать реальным moat, если сделать его рано.

### Главные проблемы текущего плана

1. MVP слишком широкий: web/Mac, GitHub, IDE, mobile cockpit, templates, diagram editor и plan-vs-actual.
2. "Visual plan" сам по себе легко копируется крупными игроками.
3. Pasted repo tree даст слишком много правдоподобных, но неточных карт.
4. Plan-vs-Actual назван killer feature, но отложен на позднюю стадию.
5. Privacy нельзя откладывать: разработчики осторожны с private repo context.
6. Валидационная метрика "5/10 хотели бы использовать" слишком слабая.

### Улучшенные метрики валидации

- Пользователь изменил scope/tests/constraints до запуска агента.
- Preflight нашёл риск, который пользователь признал реальным.
- Сократилось время понимания предполагаемого scope.
- Drift check после выполнения агента нашёл изменение вне approved scope.
- Пользователь повторно применил инструмент на новой задаче в течение недели.

## Рекомендуемый MVP

Не начинать с SaaS-only web app. Лучший solo MVP - local-first web/CLI hybrid.

### MVP flow

1. Пользователь запускает локально `agent-preflight` в корне репозитория.
2. Tool строит repo manifest: git files, package manifests, test folders, framework hints, optional selected files.
3. Пользователь вводит task/issue и project type.
4. LLM возвращает structured plan JSON.
5. UI показывает impact map, risks, assumptions, tests, forbidden scope.
6. Пользователь редактирует и approves plan.
7. Tool экспортирует prompt для Codex/Cursor/Claude.
8. После работы агента tool читает `git diff --name-only` и показывает scope drift.

### Что включить в MVP

- Local repo scan без отправки полного кода по умолчанию.
- Structured JSON first, renderer second.
- Mermaid preview вместо сложного diagram editor.
- Editable scope: planned paths, forbidden paths, assumptions, tests.
- Prompt export для Codex/Cursor/Claude.
- Local Plan-vs-Actual через git diff.
- 2-3 mobile risk templates: iOS, Android/KMP, React Native.

### Что убрать из MVP

- Аккаунты и team workspace.
- GitHub App.
- iPhone/iPad cockpit.
- React Flow editor.
- Sharing links.
- Полноценный PR reviewer.
- Обещание absolute correctness.

## Solution Architect review

### Ключевой принцип

LLM не должен напрямую "рисовать диаграмму". Он должен вернуть валидный structured artifact. Диаграммы, markdown, prompts и checks строятся детерминированно поверх JSON.

### Базовый pipeline

```text
Repo Scanner
  -> Repo Manifest
  -> LLM Planner
  -> JSON Schema Validation
  -> Deterministic Risk Rules
  -> Visual Renderers
  -> Approved Plan Artifact
  -> Diff Checker
```

### Core data model

```json
{
  "task": "Add happy hours to venue details screen",
  "projectType": "iOS + KMP",
  "scope": {
    "plannedPathPatterns": ["ios/App/Features/Venue/**", "shared/venue/**"],
    "forbiddenPathPatterns": ["AppDelegate.swift", "auth/**"],
    "layers": ["ui", "viewmodel", "repository", "tests"]
  },
  "nodes": [
    {
      "id": "venue_ui",
      "label": "Venue Details UI",
      "type": "ui",
      "paths": ["ios/App/Features/Venue/**"],
      "risk": "medium",
      "confidence": 0.72,
      "evidence": ["matching feature folder", "task mentions venue details"]
    }
  ],
  "risks": [
    {
      "level": "high",
      "reason": "Navigation/deep link state may be affected",
      "mitigation": "Do not modify routing without approval"
    }
  ],
  "tests": [
    {
      "type": "unit",
      "command": "./gradlew :shared:test",
      "required": true
    }
  ],
  "assumptions": [],
  "openQuestions": []
}
```

Обязательные поля для доверия: `paths`, `confidence`, `evidence`, `assumptions`, `openQuestions`.

### Plan-vs-Actual v1

Делать rule-based уже в MVP:

- changed outside planned path patterns;
- changed forbidden path;
- no test files changed;
- high-risk config files touched;
- migrations/build files touched;
- deleted files;
- snapshot/golden files changed.

LLM classifier можно добавить позже как fallback, но первая версия должна быть объяснимой.

### Рекомендуемый стек

- UI: Vite + React или Next.js.
- Local runner: Node CLI.
- Validation: Zod или JSON Schema.
- Renderer: Mermaid сначала.
- Storage: локальные JSON-файлы или SQLite.
- LLM layer: OpenAI/Anthropic/OpenRouter abstraction.
- Git integration: shell out to `git status`, `git ls-files`, `git diff --name-only`.
- Later GitHub: GitHub App, not OAuth-first, если нужны PR checks/webhooks.

## Roadmap

### Stage 0: concierge validation, 3-5 дней

- Сделать 10 ручных preflight-планов для реальных задач.
- Сравнить с обычным текстовым планом агента.
- Проверить: меняет ли пользователь scope/tests/constraints.

### Stage 1: local prototype, 7-10 дней

- CLI repo scan.
- Local browser UI.
- LLM JSON -> Mermaid -> prompt export.
- No accounts, no GitHub.

### Stage 2: real solo MVP, 2-4 недели

- Approved plan artifact.
- Edit flow.
- Local plan-vs-diff.
- Mobile templates.
- Reusable project rules.

### Stage 3: GitHub integration

- GitHub App.
- Issue/PR import.
- PR comments/checks.
- Plan-vs-Actual against changed files.

### Stage 4: IDE extension

- VS Code/Cursor command.
- Side panel.
- Copy approved prompt into agent.
- Local-only mode.

### Stage 5: mobile cockpit

- Notifications.
- View/edit approvals.
- Plan-vs-Actual warnings.
- Team inbox later.

## Product decisions to carry forward

- The product is a preflight control layer, not a coding agent.
- The moat is approved plan artifact + drift verification, not diagram generation.
- Local-first is strategically important for privacy and trust.
- Mobile-specific templates are a wedge, not the whole product.
- Visuals should support decisions: scope, risk, tests, assumptions, drift.
- Start with deterministic checks wherever possible; use LLMs for planning and classification, not for hidden authority.

## Open questions

- Should the first public package be CLI-first (`npx agent-preflight`) or local desktop app?
- How much code context can be safely sent by default?
- What is the minimum repo manifest that gives useful plans without leaking source?
- Should pricing start with BYOK/lifetime local plan instead of SaaS subscription?
- Which initial niche is sharper: mobile devs, solo AI coding users, or team leads reviewing AI PRs?
