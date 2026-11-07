# sts-team-opencode-plugin

Плагин для [OpenCode](https://opencode.ai) **V2**: рабочий цикл **спека → стори → dev → QA → Lead** .

Плагин не зависит от стека и предметной области: цикл работает в любом проекте, где есть `AGENTS.md`, `docs/spec/`,
`docs/plan/`, код и тесты. Источник правды — `AGENTS.md`, `docs/spec/`, код и тесты проекта; роли читают оттуда стек,
команды запуска и границы модулей.

## Что внутри

| Путь                    | Что это                                                                                                                                                          |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `plugin.js`             | Плагин OpenCode V2: регистрирует скилы, агентов и команды                                                                                                        |
| `skills/sts-team-plan/` | Скил планирования: спека + нарезка сторей (`SKILL.md`, `prompt-analyst.md`, `story-template.md`)                                                                 |
| `skills/sts-team-impl/` | Скил реализации: планировщик слотов (до N_SLOTS стори в работе, по умолчанию 4), Dev → QA → Lead (`SKILL.md`, `prompt-dev.md`, `prompt-qa.md`, `prompt-lead.md`) |
| `agents/`               | Роли `analyst`, `dev`, `qa`, `lead` (тело файла — системный промпт)                                                                                              |
| `commands/`             | Шаблоны `/stsTeamPlan`, `/stsTeamImpl` с `$ARGUMENTS`                                                                                                            |

Свои скилы добавляй копированием: `skills/<имя>/` + при необходимости `agents/<роль>.md`.

## Что делает плагин

![ag.drawio.png](ag.drawio.png)

При загрузке, в `setup` V2-плагина:

1. регистрирует субагентов `analyst`, `dev`, `qa`, `lead` через `ctx.agent.transform` (`editor.update` создаёт агента,
   если его ещё нет);
2. регистрирует скилы через `ctx.skill.transform` — они доступны как `sts-team-plan`, `sts-team-impl` без
   копирования в проект;
3. регистрирует команды `/stsTeamPlan`, `/stsTeamImpl` через `ctx.command.transform`; `$ARGUMENTS` заменяется
   аргументами, а если плейсхолдера нет — аргументы дописываются в конец.

## Требования

- OpenCode **2.x** (V2 plugin API; код совместим с `@opencode/plugin` 2.2.x).
- Проект со структурой `AGENTS.md` + `docs/spec/` + `docs/plan/`; `stsTeamPlan` создаёт недостающие файлы при первом
  запуске. Стек, команды сборки/тестов/запуска и границы модулей проект описывает в `AGENTS.md` — плагин их не
  навязывает.

## Подключение

`opencode.json` — в проекте или глобальный `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///D:/mycode/sts-team-opencode-plugin"
  ]
}
```

С опциями:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///D:/mycode/sts-team-opencode-plugin",
      "options": {
        "overwrite": true
      }
    }
  ]
}
```

Путь указывается на **каталог** пакета (в нём `package.json` → `exports`). V2 пропускает локальный плагин, заданный
отдельным файлом.

| Опция       | По умолчанию | Смысл                                                                                |
|-------------|--------------|--------------------------------------------------------------------------------------|
| `skills`    | `true`       | регистрировать встроенные скилы                                                      |
| `agents`    | `true`       | регистрировать `analyst` / `dev` / `qa` / `lead`                                     |
| `commands`  | `true`       | регистрировать `/stsTeamPlan`, `/stsTeamImpl`                                        |
| `overwrite` | `true`       | перекрывать скилы, команды и агентов с теми же ID; `false` — существующие не трогать |
| `slots`     | `4`          | максимум стори «в работе»; подставляется в скил вместо `{{N_SLOTS}}`                 |

Конфиг в V2 перечитывается без перезапуска. Если менялся код локального плагина, может понадобиться `/reload` или
`opencode service restart`.

## Использование

```
/stsTeamPlan <задача>        — analyst: спека + стори со статусами
/stsTeamImpl <Sxx …>         — планировщик слотов: до N_SLOTS в работе (по умолчанию 4), новая берётся по освобождению,
                                   Dev → QA → Lead, статус «сделано» после LEAD_PASS
/stsTeamImpl без аргументов  — все готовые стори подряд, пока есть готовые
```

## Артефакты

Скилы и роли пишут в проект в:

- `docs/plan/` - список задач 
- `docs/spec/` - спецификацию через 
- `.temp` - временные файлы

A также в `docs/plan/artifacts/`:

- `decisions.md` — журнал допущений `D…` (ведёт оркестратор `stsTeamImpl`);
- `bug-report-Sxx.md` — отчёт QA;
- `review-notes-Sxx.md` — замечания Lead;
- `scheduler.md` — статусборд `stsTeamImpl`.

## Тест

```
node --test
```
