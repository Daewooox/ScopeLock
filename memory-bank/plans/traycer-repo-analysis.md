# Анализ репозитория Traycer для инфраструктуры ScopeLock

> Дата: 2026-07-05. Проект переименован в **ScopeLock**.
> Источник: клон `https://github.com/traycerai/traycer` (Apache 2.0), анализ структуры.
> Связано с: `plans/strategy-review-round2-market-corrections.md`.
>
> **Дополняет** `plans/traycer-infrastructure-lessons.md` (задача #0003, codex): тот документ
> покрывает инженерные практики (CLI runner, storage layout, doctor, CI, repo shape, стек).
> Этот документ (задача #0004) покрывает глубокие архитектурные паттерны: protocol,
> git-схемы как эталон drift check, harness abstraction, hook-адаптеры.
> **По стеку/monorepo источник истины - `traycer-infrastructure-lessons.md`**
> (pnpm/Node/tsup, без Bun/Nx на старте). Здесь версии библиотек приводятся только
> как справка о том, что использует Traycer.

## Главный вывод

Открытый репозиторий Traycer - это **НЕ "мозг" продукта**. Открыты только:
клиенты (CLI, GUI, Electron desktop) и wire-протокол между клиентом и host.
Планирование, spec-generation и verification живут в **закрытом host-бинарнике
(GitHub Releases) и облаке** - их в репо нет.

Из AGENTS.md дословно: *"The Traycer Host and cloud backend are not part of this
repo: the CLI provisions a signed host binary from GitHub Releases, and the clients
run against the production cloud."*

Практический смысл для ScopeLock: скопировать бизнес-логику конкурента нельзя,
её тут нет. Но можно взять зрелые **инфраструктурные паттерны** и не изобретать их.

Лицензия Apache 2.0 - паттерны можно свободно перенимать (не копипастить файлы
целиком без указания авторства, но учиться на архитектуре - да).

## Что за структура (monorepo, Bun workspaces + Nx)

| Путь | Назначение | Полезно для ScopeLock |
|---|---|---|
| `protocol/` | Versioned client-host wire contract (Zod schemas, RPC) | Паттерн, не код напрямую |
| `clients/traycer-cli/` | CLI: provision host, auth, agent/workspace команды | Высоко: модель CLI |
| `clients/shared/` | Transport (WS/RPC), auth (PKCE/bearer), форматирование | Средне |
| `clients/gui-app/` | React + Vite + TanStack Router/Query + Zustand + shadcn/ui | Позже, для UI |
| `clients/desktop/` | Electron-оболочка вокруг gui-app | Позже, если нужен desktop |

Версии библиотек Traycer (справочно, июль 2026): Zod 4, TypeScript strict,
commander 15, Vite 8 + React 19, Zustand 5, Bun + Nx. ВАЖНО: их monorepo-стек
(Bun+Nx) для ScopeLock НЕ рекомендуется на старте - см. `traycer-infrastructure-lessons.md`
(pnpm/Node/tsup). Зеркалить стоит только версии Zod/commander и, при появлении UI,
Vite/React.

## Что реально полезно взять (паттерны, не файлы)

### 1. Harness abstraction - самый ценный паттерн
`protocol/src/host/agent/shared.ts`: единый enum `harnessIdSchema` для всех агентов
(claude, codex, cursor, opencode, copilot, kiro, droid, grok, qwen, kimi, kilocode,
openrouter). Два подмножества: `guiHarnessId` (agent в чат-табе через SDK) и
`tuiHarnessId` (agent в реальном PTY-терминале). Добавление вендора в одну плоскость
без добавления в canonical enum = compile error (через `.extract()`).

Для ScopeLock: enforcement и prompt-export нужны под каждый агент. Нужна такая же
единая карта агентов + adapter-регистр (у каждого свой формат hooks, свой способ
запуска, свой prompt-стиль). Это ядро cross-tool value proposition.

### 2. Git status/diff схема - почти готовый чертёж для drift check
`protocol/src/host/git-schemas.ts`: продуманные Zod-схемы для `git status --porcelain=v2`:
- `gitFileStatus` (modified/added/deleted/renamed/copied/untracked/conflicted);
- `gitStage` (staged/unstaged/untracked/conflicted);
- `repoState` (clean/merge/rebase/cherry-pick/revert/am/bisect) - обработка того, что
  репо может быть в середине merge/rebase, а не только "чисто";
- `repoMode` (normal/degraded/refused) - деградация на больших репо (cap 5M файлов);
- per-file insertions/deletions/sizeBytes/isBinary/oid.

Для ScopeLock drift check это прямой эталон модели данных. Наш V1 (`git diff --name-only`
+ path rules из techContext §12) стоит сразу расширить до этой schema-детализации:
учитывать renamed (иначе rename читается как delete+add и даёт ложный scope drift),
binary/большие файлы, degraded mode на монорепо.

### 3. Layered instructions / agent selection guide
`protocol/src/agent/agent-selection-guide-format.ts`: как склеивать инструкции разного
scope (global + per-workspace) с правилом "specific overrides global, применяй все слои".
Живёт в `.traycer/agent-selection-guide.md` внутри репо.

Для ScopeLock: наш approved contract, вставляемый в `AGENTS.md`/`CLAUDE.md`, должен
следовать той же логике слоёв - глобальные правила проекта + scope конкретной задачи,
с явным приоритетом. Не изобретать формат с нуля.

### 4. Hook-команды как тонкие quiet-адаптеры
`clients/traycer-cli/src/commands/agent-activity-from-hook.ts` и `agent-title-from-hook.ts`:
CLI-команды, которые вызываются из lifecycle-хуков агента (start/stop turn). Ключевые
принципы, прямо релевантные нашему enforcement-слою:
- хуки **намеренно "тихие"** (не пишут в stdout лишнего): их вывод может попасть обратно
  в TUI агента и сломать сессию;
- graceful noop при отсутствии контекста / host unreachable / unknown provider - хук
  никогда не должен падать и ломать работу агента;
- фиксированный набор reason-кодов для noop (missing-context, unknown-event, ...).

Для ScopeLock (Claude Code PreToolUse deny, Cursor afterFileEdit audit) это точный
шаблон: хук должен быть быстрым, тихим, отказоустойчивым, с понятными кодами.

### 5. Versioned RPC / контракт с обратной совместимостью
`protocol/src/framework/versioned-rpc.ts`: per-method `{major, minor}` версии,
согласуемые на handshake, отдельно от npm semver пакета. Additivity rules.

Для ScopeLock это overkill для MVP (у нас нет client-host split), но паттерн держать
в голове на случай, когда появится MCP server / GitHub App и понадобится не ломать
старые версии контракта плана.

### 6. Signed binary provisioning + minisign
`clients/traycer-cli/src/registry/minisign.ts`, `host/provision.ts`: CLI скачивает
подписанный бинарь host, верифицирует по trust-ключу в коде. Релевантно, только если
ScopeLock будет дистрибутировать бинарь; для `npx`-first CLI не нужно на старте.

## Что НЕ брать / чего тут нет

- **Нет** planning-логики, spec-generation, verification-движка - это закрытый host.
- **Нет** LLM-промптов и pipeline генерации плана - ядро ценности не в репо.
- **Не** копировать Electron/desktop на старте: тяжело для solo MVP (см. round 1 - MVP
  должен быть local CLI + browser UI).
- **Не** тащить cloud sync / collaboration / Yjs CRDT - это для команд, не для MVP.
- **Не** повторять их масштаб протокола (2500+ файлов) - у нас нет client-host split.

## Прямые решения для старта разработки ScopeLock

1. **Monorepo-скелет:** pnpm workspaces + Node 22 + tsup/esbuild, TypeScript strict,
   Zod 4, commander для CLI. Bun/Nx не брать на старте; это оправдано для масштаба
   Traycer, но преждевременно для ScopeLock MVP.
2. **Domain-схемы на Zod first** (как их protocol): plan schema, git-change schema
   (взять их `git-schemas.ts` как эталон), drift-report schema. Renderer/логика поверх.
3. **Harness registry с первого дня:** абстракция агента (claude/cursor/codex) с полями
   "как экспортировать prompt", "как сгенерировать hooks", "как распознать сессию".
   Начать с claude + cursor + codex.
4. **Drift check по образцу их git-схемы:** rename-aware, binary-aware, repo-state-aware.
   Это может дать ScopeLock более объяснимый и детерминированный слой контроля, чем
   LLM-only verification.
5. **Hook-адаптеры по их шаблону:** тихие, отказоустойчивые, с reason-кодами.
6. **Contract в `.scopelock/` + инъекция в AGENTS.md/CLAUDE.md** по образцу их
   layered agent-selection-guide.

## Открытые вопросы

- Делать ли ScopeLock CLI-first (`npx scopelock`) - да, подтверждается их же моделью
  (CLI - точка входа, host отдельно). Наш "host" на MVP = локальный процесс, без облака.
- Нужен ли нам client-host split вообще на MVP? Скорее нет: один локальный процесс.
  Versioned RPC отложить до MCP/GitHub стадии.
- Копировать ли их git-schemas.ts дословно (Apache 2.0 позволяет с attribution) или
  написать свой упрощённый по мотивам? Для MVP - свой упрощённый, но с их полнотой полей.
