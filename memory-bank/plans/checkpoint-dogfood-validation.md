# ScopeLock CHECKPOINT: dogfood + Stage 0 validation

> Дата старта: 2026-07-05. Статус: local dogfood и self-dogfood на ScopeLock repo
> пройдены; внешняя validation pending. Этот checkpoint обязателен перед Phase 4-6.

## Цель checkpoint

Проверить, что ScopeLock уже полезен без LLM-слоя:

1. manual contract -> `approve`;
2. contract -> agent prompt;
3. hook gate/audit ловит выход за scope;
4. `check-drift` видит baseline..HEAD + worktree нарушения;
5. пользователь понимает, зачем это нужно, несмотря на Spec Kit / Traycer.

## Local dogfood result

Проверка выполнена в отдельном temp git repo, потому что текущий рабочий репозиторий
ещё не имеет `HEAD`, а `approve` корректно требует baseline commit.

Сценарий:

1. `scopelock init`
2. manual contract: planned `src/checkout/**`, `tests/**`; forbidden `src/auth/**`
3. `scopelock approve contract.json`
4. `scopelock export-prompt --target codex`
5. `scopelock inject-contract --target codex`
6. `scopelock hooks install --target claude --mode strict`
7. `scopelock hook gate` на `src/auth/session.ts`
8. `scopelock hooks install --target claude --mode warn`
9. `scopelock hook gate` на `src/other.ts`
10. manual drift: `src/other.ts` + `src/auth/new-session.ts`
11. `scopelock check-drift --json`

Результат:

- strict gate: exit `2`, forbidden edit blocked;
- prompt export: содержит expected sections (`## Approved Scope`);
- warn gate: пишет `audit.ndjson`;
- drift check: exit `1`, violations found;
- CLI stdout для hook gate остаётся тихим.

## Self-dogfood on ScopeLock repo

После первого baseline commit (`47d2a8802b10903fe767fb3319d4adf79d24f337`) checkpoint
пройден на самом ScopeLock repo.

Сценарий:

1. manual contract `self-dogfood-docs-config-2026-07-05`;
2. planned scope: `AGENTS.md`, `.claude/settings.json`, `.cursor/hooks.json`,
   checkpoint docs in `memory-bank/`;
3. forbidden scope: runtime hook/core schemas files;
4. `approve` от реального `HEAD`;
5. `export-prompt --target codex`;
6. `inject-contract --target codex`;
7. `hooks install --target claude --mode strict`;
8. `hooks install --target cursor --mode warn`;
9. `doctor --json`;
10. `hook gate` на forbidden path;
11. `hook audit` на outside path;
12. `check-drift --json`.

Результат:

- `approve` stamped baseline `47d2a8802b10903fe767fb3319d4adf79d24f337`;
- `doctor` видит active contract, active baseline, Claude hooks и Cursor hooks;
- strict `hook gate` на `packages/core/src/schemas/contract.ts`: exit `2`,
  stdout `0 bytes`, stderr `ScopeLock: forbidden path changed...`;
- planned path через `hook gate`: exit `0`, stdout/stderr пустые;
- `hook audit` пишет `reports/audit.ndjson` и не блокирует;
- `check-drift --json`: exit `0`, violations `0`, changed files только
  `AGENTS.md`, `.claude/settings.json`, `.cursor/hooks.json`.

Dogfood findings:

- `mode` сейчас глобальный в `.scopelock/config.json`, а не per-target. Поэтому
  `hooks install --target cursor --mode warn` меняет поведение Claude gate тоже.
  Для v1 это приемлемо как простой global mode, но UX надо явно документировать
  или позже разделить mode per harness.
- Контракт с required tests для docs/config-only checkpoint дал `missing_tests`.
  Это корректное поведение engine, но contract authoring должен подсказывать:
  docs/config-only изменениям не нужны required tests.
- Installed hook command использует `scopelock` из PATH. До npm distribution
  dogfood требует `pnpm link`/local wrapper или ручной CLI invocation.

## Live dogfood checklist

Нужно дополнительно пройти в настоящих agent UI:

- Claude Code strict: forbidden edit блокируется через PreToolUse;
- Claude Code warn: outside edit не блокируется, но пишет `reports/audit.ndjson`;
- Cursor audit: afterFileEdit вызывает audit command и пишет событие;
- `doctor` видит installed hooks и active baseline;
- `check-drift` в конце агентской задачи показывает actionable messages;
- prompt section в `AGENTS.md`/`CLAUDE.md` не ломает существующие инструкции.

## Stage 0 external validation script

Для 10-15 разработчиков или агентных power users:

1. "Каким AI coding agent ты пользуешься чаще всего?"
2. "Была ли ситуация, когда агент полез не туда или изменил лишние файлы?"
3. "Как ты сейчас ограничиваешь scope: prompt, review, git diff, Spec Kit, Traycer, Kiro?"
4. "Почему ты не используешь Spec Kit / Traycer для этой задачи?"
5. "Что ценнее: план до старта или deterministic проверка после/во время работы?"
6. "Готов ли ты поставить local CLI/hook ради защиты от scope drift?"
7. "Что должно случиться при нарушении: warn, block, PR comment, CI fail?"
8. "Какие false positives заставят тебя удалить tool?"

## Gate criteria before Phase 4

Go:

- 7+ из 10 пользователей узнают проблему scope drift из личного опыта;
- 5+ готовы поставить local CLI/hook для warn-only режима;
- 3+ хотят strict/blocking mode хотя бы для sensitive paths;
- вопрос "почему не Spec Kit / Traycer" имеет ясный ответ: ScopeLock проверяет и
  enforce-ит contract deterministically, а не продаёт генерацию плана;
- live dogfood не выявляет критичных false positives в базовом workflow.

No-go / revise:

- пользователи хотят только better planning, а enforcement им не нужен;
- hooks воспринимаются как слишком рискованные/ломающие workflow даже в warn mode;
- Spec Kit/Traycer закрывает кейс для большинства интервьюируемых;
- check-drift messages не помогают быстро принять действие.

## Решение на сейчас

Phase 4-6 пока не начинать как "автоматический next". Сначала:

1. проверить live hook invocation в настоящих Claude Code и Cursor UI;
2. собрать минимум 5 быстрых интервью, затем добить до 10-15;
3. обновить этот документ выводами и принять go/no-go.
