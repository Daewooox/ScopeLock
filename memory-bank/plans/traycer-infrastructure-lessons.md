# Traycer Infrastructure Lessons for ScopeLock

> Дата: 2026-07-05. Источник: анализ `traycerai/traycer` на HEAD `78d5f30`.

## Короткий вывод

Traycer полезен как инженерный reference, но не как продуктовый шаблон. Он строит большую платформу: desktop app, CLI, protocol package, host lifecycle, auth, sync, collaboration, agent orchestration. ScopeLock должен быть меньше и острее:

> small, local-first, scriptable guardrails tool: approved contract -> enforcement/drift report.

## Что взять из Traycer

### 1. CLI runner pattern

Команды должны быть тонкими builders, а общий runner отвечает за:

- human output;
- machine-readable `--json`;
- progress events;
- стабильные exit codes;
- нормализацию ошибок.

Для ScopeLock:

```ts
type CommandResult = {
  data: unknown;
  human: string | null;
  exitCode: number;
}
```

### 2. Machine-readable mode

Каждая ключевая команда должна иметь JSON/NDJSON mode, чтобы ей могли пользоваться агенты, MCP, CI и shell scripts.

Пример:

```bash
scopelock check-drift --json
```

Минимальный result shape:

```json
{
  "status": "error",
  "violations": [
    {
      "type": "outside_scope",
      "path": "src/auth/session.ts"
    }
  ]
}
```

### 3. Core/protocol package

Traycer держит `protocol/` как единый источник схем и контрактов. Для ScopeLock нужен `packages/core`, который импортируют CLI, MCP и будущий UI:

```text
packages/core/
├── contract.schema.ts
├── drift.schema.ts
├── repo-manifest.schema.ts
├── risk-rule.schema.ts
└── index.ts
```

### 4. Zod everywhere

Все внешние и on-disk boundaries валидируются через Zod:

- approved contract JSON;
- local config;
- hook config input;
- drift report;
- repo manifest;
- MCP tool input/output.

Approved contract нельзя читать как trusted JSON.

### 5. Versioned on-disk files

Каждый persisted artifact должен иметь версию:

```json
{
  "schemaVersion": 1,
  "scope": {
    "plannedPathPatterns": [],
    "forbiddenPathPatterns": []
  }
}
```

В v1 миграций может не быть, но место под миграции надо заложить сразу.

### 6. Local storage layout

Глобальное и repo-local состояние должны быть разделены:

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

Глобально: пользовательские настройки и defaults. В репозитории: approved contracts, reports, generated hooks.

### 7. Atomic writes

Config, approved contracts и drift reports писать через temp file + rename. Это защищает от битых JSON при прерванной записи.

### 8. Doctor command

Нужна команда:

```bash
scopelock doctor
```

Проверяет:

- текущая директория внутри git repo;
- найден `.scopelock/config.json`;
- approved contract существует и валиден;
- hooks установлены и не конфликтуют;
- пользовательские hooks не будут перезатёрты;
- есть changed files для `check-drift`;
- git доступен;
- LLM config задан, если команда требует planning.

### 9. Security/CI hygiene

Минимальный набор:

- Vitest для unit tests;
- GitHub Actions: test/lint/build;
- CodeQL для TypeScript;
- gitleaks/secret scan;
- PR template с checklist;
- npm publish позже.

### 10. Release discipline later

После доказанного спроса:

- npm package: `npx scopelock`;
- Homebrew formula;
- signed standalone binaries только если появится desktop/enterprise need.

## Что НЕ брать из Traycer

- Electron desktop app.
- Host daemon.
- Auth/login.
- Cloud sync.
- Collaboration/boards.
- Agent-to-agent orchestration.
- Workspaces as a product surface.
- Nx/Bun monorepo complexity на старте.
- Desktop auto-update/signing pipeline.
- Большой protocol compatibility framework.

Эти элементы решают задачи Traycer как платформы. Для ScopeLock они будут premature complexity.

## Recommended ScopeLock repo shape

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
│   └── sample-repo/
├── .github/workflows/
│   ├── test.yml
│   └── codeql.yml
└── package.json
```

## Recommended stack

- TypeScript.
- Node 22+.
- pnpm.
- commander for CLI.
- zod for schemas.
- minimatch or picomatch for path rules.
- vitest.
- eslint/prettier.
- tsup or esbuild for CLI bundle.

Avoid Bun/Nx until the repo actually needs monorepo caching or Bun-specific speed.

## First CLI commands

```bash
scopelock init
scopelock plan "..."
scopelock approve
scopelock check-drift
scopelock hooks install --target claude --mode warn
scopelock doctor
```

## Design principle

Traycer built a platform shell. ScopeLock should build a small, scriptable, agent-readable devtool.

Take their maturity:

- typed contracts;
- schema validation;
- machine-readable CLI;
- clean local storage;
- doctor diagnostics;
- security CI;
- no silent corruption.

Do not take their scale.
