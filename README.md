# sts-team-opencode-plugin — Spec Kit edition

Плагин для [OpenCode](https://opencode.ai) **V2**: Spec Kit-фича проходит **Dev → QA → Lead → Analyst** с
параллельной разработкой в субагентах, а не одним большим агентом.

Плагин не зависит от стека и предметной области. Источник правды — Spec Kit-фича `specs/<NNN>-<short-name>/`
(`spec.md`, `plan.md`, `tasks.md`), `AGENTS.md` проекта и его документы. Старый режим `docs/spec` + `docs/plan` в этом
форке удалён.

## Поток

```text
/speckit.specify → /speckit.clarify → /speckit.plan → /speckit.tasks
                                                          │
                                          пасс параллельности (stsTeamPlan)
                                                          ▼
/speckit.implement ──► stsTeamImpl
                         ├─ FOUNDATION  (Phase 1 Setup + Phase 2 Foundational)
                         ├─ US1 … USn   (параллельно, до N слотов)
                         ├─ POLISH      (полный suite, build, quickstart)
                         └─ CONV1 … N   (фазы после /speckit.converge)
                              Dev → QA → Lead → Analyst
                              QA_FAIL / LEAD_FAIL / ANALYST_FAIL → Dev
                         ▼
/speckit.converge → Phase N: Convergence → снова /speckit.implement
```

## Что внутри

| Путь | Что это |
|---|---|
| `plugin.js` | V2-плагин: регистрирует скилы, агентов, команды и prompt hook |
| `speckit.js` | Чистая трансформация prompt для `/speckit.implement` и `/speckit.tasks` |
| `skills/stsTeamImpl/` | Планировщик слотов: работы, статусы, Dev → QA → Lead → Analyst, решения, коммиты |
| `skills/stsTeamPlan/` | Пасс параллельности `tasks.md`: папки, зависимости, ресурсы, фронт поставки |
| `agents/` | Роли `analyst`, `dev`, `qa`, `lead` |
| `commands/` | `/stsTeamImpl`, `/stsTeamPlan` для ручного запуска |

## Как это подключается к Spec Kit

Core-файлы Spec Kit **не редактируются**. Плагин регистрирует `ctx.session.hook("prompt", ...)`:

- для `/speckit.implement` hook в памяти заменяет классические шаги 3–9 на handoff в `stsTeamImpl`; pre-checks,
  checklist gate, pre/post hooks и Completion Report остаются;
- для `/speckit.tasks` hook вставляет пасс `stsTeamPlan` перед post-hooks;
- файлы `.opencode/commands/speckit.*`, `.specify/scripts/**` и core-шаблоны остаются byte-for-byte неизменными.

Если layout core-команды изменится, hook вставит видимое предупреждение и не сломает классический запуск. Отключить
трансформацию можно опцией `speckit: false` или флагом `--classic` в аргументах команды.

На Windows hook заменяет вызовы `.specify/scripts/powershell/*.ps1` на `.cmd`-обёртки, если они есть в проекте
(`check-prerequisites.cmd`, `setup-tasks.cmd` и т.д.). Это обходит ExecutionPolicy и сохраняет UTF-8.

## Требования

- OpenCode **2.x** с prompt hooks.
- Spec Kit **1.4.x**, установленный в проект (`.specify/`, `.opencode/commands/speckit.*`).
- Проект с `AGENTS.md`, `specs/` и кодом/тестами; команды проверок — в `AGENTS.md` / `README.md`.
- Windows: скрипты Spec Kit запускаются через `.cmd`-обёртки, если они есть в проекте.

## Подключение

`opencode.json` проекта:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///D:/mycode/sts-team-opencode-plugin-speckit-adopt",
      "options": {
        "slots": 4,
        "speckit": true
      }
    }
  ]
}
```

Если плагин лежит рядом с проектом, можно указать относительный путь: `"package": "../sts-team-opencode-plugin-speckit-adopt"`.

| Опция | По умолчанию | Смысл |
|---|---|---|
| `slots` | `4` | максимум работ «в работе»; подставляется в скилы и в пасс параллельности |
| `speckit` | `true` | включает prompt hook для `/speckit.implement` и `/speckit.tasks` |
| `overwrite` | `true` | перекрывать одноимённые скилы/агенты/команды плагина |
| `skills` / `agents` / `commands` | `true` | регистрировать соответствующую часть |

После изменения локального плагина может понадобиться `/reload` или `opencode service restart`.

## Использование

Обычный поток — только команды Spec Kit:

```text
/speckit.specify <описание фичи>
/speckit.clarify
/speckit.plan
/speckit.tasks
/speckit.implement
/speckit.converge
/speckit.implement        # если converge добавил задачи
```

`/speckit.tasks` автоматически добавляет статусы, папки, зависимости, ресурсы и фронт поставки. `/speckit.implement`
автоматически запускает team-цикл.

Фильтры:

```text
/speckit.implement US1 US3
/speckit.implement specs/003-gedcom-export
/speckit.implement --classic          # классический Spec Kit implement
```

Ручной запуск team-скилов:

```text
/stsTeamPlan specs/003-gedcom-export  # пересчитать фронт/метаданные
/stsTeamImpl specs/003-gedcom-export  # запустить/продолжить работы
/stsTeamImpl US1 US3                  # только выбранные работы
```

## Работы и статусы

| ID | Источник | Особенности |
|---|---|---|
| `FOUNDATION` | Phase 1 Setup + Phase 2 Foundational | первым, один слот, блокирует истории |
| `US1..USn` | Phase истории / задачи с `[USn]` | параллельно до `slots`, если пути/ресурсы не пересекаются |
| `POLISH` | Phase «Полировка/Polish» | полный suite, build, quickstart |
| `CONV1..N` | Phase N: Convergence | после всех не-Convergence фаз, последовательно |

В `tasks.md` после заголовка фазы:

```markdown
**Статус:** OPEN
**Дорожка:** api, web
**Параллель:** US2 — по файлам; не параллелить: —
**Зависит от:** FOUNDATION
**Разблокирует:** US3
**Папки (только эти):**
```
apps/api/src/modules/users
apps/web/src/pages/users
```
**Ресурсы:** ui
**Приёмка:** US1 acceptance 1–3; FR-001..FR-004
```

`DONE` ставится после `ANALYST_PASS`, все задачи фазы помечаются `[X]`, работа коммитится
(`US1: <краткое> (ANALYST_PASS)`).

## Параллельность

- Пересечение путей — по `**Папки (только эти)**`; если путей нет — работа идёт одна.
- Эксклюзивные пути (`packages/contracts/openapi.json`, миграции, локали, корневые манифесты, entry points) — максимум
  одна работа одновременно.
- Ресурсы `ui`, `db`, `build`, `codegen` сериализуются: один UI-сценарий/БД/полный build за раз.
- Per-story QA гоняет профильные тесты и сборку затронутых пакетов; полный `check/test/build` — на `POLISH` или финальном
  гейте.
- `[P]` внутри истории — подсказка Dev; кросс-историйная параллельность определяется путями, зависимостями и ресурсами.

## Артефакты

```text
specs/<NNN-feature>/
  spec.md, plan.md, tasks.md, data-model.md, contracts/, quickstart.md, checklists/
  artifacts/
    decisions-<item>.md
    bug-report-<item>.md
    review-notes-<item>.md
    acceptance-<item>.md

.temp/speckit-<feature>/
  scheduler.md
  qa-<item>/          # свидетельства QA, не в git
```

`<item>` = `FOUNDATION`, `US1`, `US2`, `POLISH`, `CONV1`.

Решения `D…` принимает оркестратор: допущение — сам по рекомендованному варианту, нестыковку — вопросом пользователю.
ID глобальные по фиче, журнал ведёт только оркестратор.

## Ограничения

- Это Spec Kit-форк: `docs/spec` + `docs/plan` не поддерживаются.
- `/speckit.tasks` нельзя перезапускать после начала реализации: он перегенерирует `tasks.md` и потеряет статусы. Для
  новых задач — `/speckit.converge`.
- Пасс `stsTeamPlan` не меняет ID, описания и границы историй; если для параллельности нужны изменения спеки — это вопрос
  пользователю.
- Prompt hook — единственная точка интеграции с core-командами; при обновлении Spec Kit проверь маркеры в `speckit.js`.

## Тест

```text
node --test
```
