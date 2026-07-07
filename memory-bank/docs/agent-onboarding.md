# Agent Onboarding: первоначальный сетап на проекте ScopeLock

> Отдай этот файл (или ссылку на него) агенту как первый промпт. Инструкция
> самодостаточна: порядок чтения, дисциплина контракта, команды и текущая задача.
> При расхождении с более ранними документами - верить авторитетному плану (Шаг 1.5).

Проект: **ScopeLock** - локальные детерминированные guardrails для AI-агентов
(approve scope-контракта → export/inject в агента → runtime hooks → drift check).
Стек: TypeScript, pnpm monorepo (`packages/core` + `packages/cli`), Zod, commander,
Node >= 22, `node:test`.

---

## Шаг 1. Прочитай контекст (в этом порядке, не пропуская)

1. `AGENTS.md` (корень) - workflow Memory Bank и дисциплина: Edit (не Write) для
   shared-файлов; чужие блоки `<!-- TASK #NNNN ... -->` не трогать.
2. `memory-bank/README.md` - как устроена память проекта (один раз за сессию).
3. `memory-bank/tasks.md` - активные задачи. Смотри последний блок - там текущий фронт работ.
4. `memory-bank/activeContext.md` - текущий фокус одним абзацем.
5. **Авторитетный план:** `memory-bank/plans/scopelock-implementation-plan.md` →
   раздел **«АКТУАЛЬНЫЙ ПЛАН И СЛЕДУЮЩИЙ ШАГ»** (внизу файла).
6. Детали следующей задачи: `memory-bank/plans/orchestration-implementation-plan.md`
   (§2 алгоритм, §5 CLI, §8 shape контракта); теория -
   `memory-bank/plans/orchestration-scope-algebra.md`.
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

## Шаг 3. Собери и убедись, что всё зелёное

```bash
pnpm install
pnpm -r build
node --test packages/core/dist/*.test.js   # ожидание: core 34/34
node --test packages/cli/dist/*.test.js     # ожидание: cli 3/3
node packages/cli/dist/index.js doctor
```

CLI вызывается как `node packages/cli/dist/index.js <команда>` (глобального `scopelock`
в PATH нет до npm publish).

## Шаг 4. Текущая задача - M1-spike `globsIntersect`

Цель: честная консервативная функция «пересекаются ли два glob'а» + property-тесты.
Единственный рискованный кусок Идеи A; всё остальное - тривиальная надстройка.
Полные шаги и DoD - в `scopelock-implementation-plan.md` → «СЛЕДУЮЩАЯ ЗАДАЧА
(делегируемая): M1-spike». Кратко:

1. **Заведи контракт.** Возьми shape из `orchestration-implementation-plan.md` §8,
   сохрани как staging JSON в `.scopelock/`, затем:
   `node packages/cli/dist/index.js approve .scopelock/<staging>.json`.
   planned: `packages/core/src/schedule/**`, `packages/core/src/schedule.test.ts`,
   `packages/core/src/index.ts`; forbidden: остальное ядро и `packages/cli/**`.
2. **Реализуй** `packages/core/src/schedule/glob-intersect.ts` по §2.3-2.4:
   `globsIntersect`, `globSetsIntersect`, `intersectionWitness`; директорный prefix
   fast-path; general путь glob→regex→NFA (char-предикаты)→product-BFS emptiness;
   неподдержанный конструкт → `true` (консервативно = конфликт).
3. **Экспорт**: одна строка re-export в `packages/core/src/index.ts`.
4. **Тесты** `packages/core/src/schedule.test.ts` по §2.5: известные пары +
   property-soundness + property-consistency с `picomatch({dot:true})` на ≥10k случаев.
5. **Проверь:**
   ```bash
   pnpm -r build
   node --test packages/core/dist/schedule.test.js
   node packages/cli/dist/index.js check-drift   # ожидание: 0 нарушений scope
   ```
6. **Зафиксируй:** новый блок задачи в `tasks.md`, обнови `activeContext.md` и
   `component-map.md`; commit (push - только если попросят).

## Шаг 5. Definition of Done M1 (gate перехода к M2)

- [ ] property-soundness зелёный на ≥10k случаев (ни одного контрпримера);
- [ ] property-consistency с picomatch зелёный;
- [ ] `globsIntersect` без внешних зависимостей, typecheck чист;
- [ ] `check-drift` под M1-контрактом = 0 нарушений scope.

## Стоп-условия (не продолжай молча)

- M1 не сходится (soundness/consistency недостижимы дёшево) - **СТОП**, не начинай M2+,
  доложи: вся гарантия Идеи A держится на этом примитиве.
- Правка требует файла вне твоего scope - не обходи guardrail: заведи/расширь контракт,
  при сомнении спроси.
- `git config`, force-push, коммиты без явной просьбы - запрещены.
