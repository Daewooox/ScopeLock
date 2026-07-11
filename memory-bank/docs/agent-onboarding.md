# Agent Onboarding: первоначальный сетап на проекте ScopeLock

> Отдай этот файл (или ссылку на него) агенту как первый промпт. Инструкция
> самодостаточна: порядок чтения, дисциплина контракта, команды и текущая задача.
> При расхождении с более ранними документами - верить авторитетному плану (Шаг 1.5).

Проект: **ScopeLock** - local-first Flight Control для AI coding agents:
scope contracts, conflict-aware scheduling, runtime hooks, drift verification и
bounded run receipts. Стек: TypeScript, pnpm monorepo (`packages/core` +
`packages/cli` + `packages/mcp`), Zod, commander, Node >= 22, `node:test`.

---

## Шаг 1. Прочитай контекст (в этом порядке, не пропуская)

1. `AGENTS.md` (корень) - workflow Memory Bank и дисциплина: Edit (не Write) для
   shared-файлов; чужие блоки `<!-- TASK #NNNN ... -->` не трогать.
2. `memory-bank/README.md` - как устроена память проекта (один раз за сессию).
3. `memory-bank/tasks.md` - активные задачи. Смотри последний блок - там текущий фронт работ.
4. `memory-bank/activeContext.md` - текущий фокус одним абзацем.
5. **Авторитетный план:** `memory-bank/plans/scopelock-implementation-plan.md` →
   раздел **«АКТУАЛЬНЫЙ ПЛАН И СЛЕДУЮЩИЙ ШАГ»** (внизу файла).
6. Детали следующей задачи:
   `memory-bank/plans/agent-environment-preflight-plan.md` → **Step 0**.
   Не переходи к Steps 1-5, пока Step 0 не дал письменный GO.
7. Перед любым поиском/чтением по `packages/**` - сначала `memory-bank/docs/component-map.md`.

## Шаг 2. Правила проекта (нарушение = ошибка ревью)

- **Exit-code контракт CLI:** `0` clean, `1` violations, `2` error. Других не выдумывать.
- **Все boundaries через Zod;** JSON пишем только через `writeJsonAtomic`; пути
  `.scopelock/` только через `scopelockPaths()`.
- **core не знает про CLI** (в `packages/core` нет `process.exit`/`console.log`/commander).
- **Бизнес-логика в core, CLI-команда - тонкий адаптер** (`CommandResult { data, human, exitCode }`).
- **Дисциплина контракта ScopeLock (главное):** в репозитории активен guardrail.
  Прежде чем менять `packages/**`, заведи и заапрувь контракт с нужным scope.
  strict ради обхода не отключать - дожимай workflow. Это dogfood: проверяем продукт на себе.
- **Git flow (с 2026-07-12): `main` защищён GitHub Ruleset, прямой push запрещён
  всем, включая владельца и агентов.** Работать только так: `git checkout -b
  <branch>` → коммиты → `git push -u origin <branch>` → `gh pr create` →
  дождаться зелёных обязательных чеков (`analyze`, `gitleaks`, все 6 вариантов
  `test (os, node)`) → `gh pr merge --squash --delete-branch`. Approvals не
  требуются (solo maintainer), но сам PR обязателен - `git push origin main`
  будет отклонён GitHub. Merge commit и rebase merge отключены на уровне
  репозитория - доступен только squash. Подробности и мотивация:
  `memory-bank/techContext.md` → раздел 13, «Git workflow and branch protection».

## Шаг 3. Собери и убедись, что всё зелёное

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm typecheck
node packages/cli/dist/index.js doctor
```

CLI вызывается как `node packages/cli/dist/index.js <команда>` (глобального `scopelock`
в PATH нет до npm publish).

## Шаг 4. Текущая задача - Agent Environment Preflight Step 0

Цель: проверить на реальном scratch fixture, решают ли Ruler и open `skills` CLI
проблему переноса rules/skills между Claude Code, Cursor и Codex. Это
buy-vs-build gate, а не production implementation.

1. Работай во внешнем temp git repository, не в ScopeLock repo.
2. Создай canonical rule и Agent Skill с уникальными sentinels.
3. Проверь `vercel-labs/skills --copy`: physical files без symlink, target
   locations, update/remove, SHA-256 parity и idempotence.
4. Проверь Ruler: rules/skills/config materialization, foreign-entry
   preservation, repeated apply и cleanup behavior.
5. Для реально установленных Claude/Cursor/Codex выполни live rule/skill/hook
   probes. Неустановленный target пометь `blocked`, не `failed`.
6. Ничего не меняй в `packages/**`.
7. Запиши evidence и два независимых GO/NO-GO в
   `memory-bank/plans/agent-environment-preflight-spike-verdict.md`:
   static materializer и ScopeLock environment attestation.

Точная fixture structure, команды, таблица измерений и kill-criteria находятся
в `memory-bank/plans/agent-environment-preflight-plan.md` → Step 0.

## Шаг 5. Definition of Done Step 0

- [ ] Ruler и `skills --copy` реально запущены, а не оценены только по README.
- [ ] `lstat`/`readlink` подтверждают physical-copy поведение.
- [ ] Hash parity, update/remove и repeated apply проверены.
- [ ] Foreign config entries не потеряны.
- [ ] Live capability claims разделены по harness/version/tool type.
- [ ] `packages/**` не изменены.
- [ ] Вердикт содержит письменный GO/NO-GO по обоим decision gates.

## Стоп-условия (не продолжай молча)

- Ruler + skills CLI покрывают >=90% static distribution - **СТОП**, не создавай
  собственный `agents apply`; рекомендуй integration/doctor.
- Environment preflight не находит meaningful mismatch или unverifiable
  capability - **СТОП**, не начинай Steps 1-5.
- Для live probe нужен логин, разрешение или установленный harness, которого нет -
  пометь target `blocked` и продолжай с доступными targets; не подделывай evidence.
- Правка требует файла вне твоего scope - не обходи guardrail: заведи/расширь контракт,
  при сомнении спроси.
- `git config`, force-push, коммиты без явной просьбы - запрещены.
