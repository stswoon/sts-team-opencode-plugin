# sts-team-opencode-plugin

Плагин для [OpenCode](https://opencode.ai) **V2**: рабочий цикл **спека → стори → dev → QA → Lead**.

Плагин не зависит от стека и предметной области: цикл работает в любом проекте, где есть `AGENTS.md`, `docs/spec/`,
`docs/plan/`, код и тесты. Источник правды — `AGENTS.md`, `docs/spec/`, код и тесты проекта; роли читают оттуда стек,
команды запуска и границы модулей.

## Что внутри

| Путь                  | Что это                                                                                                                                                          |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `plugin.js`           | Плагин OpenCode V2: регистрирует скилы, агентов и команды                                                                                                        |
| `skills/stsTeamPlan/` | Скил планирования: спека + нарезка сторей (`SKILL.md`, `prompt-analyst.md`, `story-template.md`)                                                                 |
| `skills/stsTeamImpl/` | Скил реализации: планировщик слотов (до N_SLOTS, опция `slots`, по умолчанию 4), Dev → QA → Lead (`SKILL.md`, `prompt-dev.md`, `prompt-qa.md`, `prompt-lead.md`) |
| `agents/`             | Роли `analyst`, `dev`, `qa`, `lead` (тело файла — системный промпт)                                                                                              |
| `commands/`           | Шаблоны `/stsTeamPlan`, `/stsTeamImpl` с `$ARGUMENTS`                                                                                                            |

Свои скилы добавляй копированием: `skills/<имя>/` + при необходимости `agents/<роль>.md`.

## Что делает плагин

![ag.drawio.png](ag.drawio.png)

При загрузке, в `setup` V2-плагина:

1. регистрирует субагентов `analyst`, `dev`, `qa`, `lead` через `ctx.agent.transform` (`editor.update` создаёт агента,
   если его ещё нет);
2. регистрирует скилы через `ctx.skill.transform` — они доступны как `stsTeamPlan`, `stsTeamImpl` без
   копирования в проект;
3. регистрирует команды `/stsTeamPlan`, `/stsTeamImpl` через `ctx.command.transform`; `$ARGUMENTS` заменяется
   аргументами, а если плейсхолдера нет — аргументы дописываются в конец.

## Требования

- OpenCode **2.x** (V2 plugin API; код совместим с `@opencode/plugin` 2.2.x).
- Проект со структурой `AGENTS.md` + `docs/spec/` + `docs/plan/`; `stsTeamPlan` создаёт недостающие
  `docs/spec/README.md` и `docs/plan/README.md` при первом запуске. Стек, команды сборки/тестов/запуска и границы
  модулей проект описывает в `AGENTS.md` — плагин их не навязывает.

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

Или с опциями:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///D:/mycode/sts-team-opencode-plugin",
      "options": {
        "slots": 2
      }
    }
  ]
}
```

| Опция   | По умолчанию | Смысл                                                                                                                       |
|---------|--------------|-----------------------------------------------------------------------------------------------------------------------------|
| `slots` | `4`          | максимум стори «в работе»; подставляется в скил вместо `{{N_SLOTS}}` (если выбрать `1` — будет последовательное выполнение) |

Если менялся код локального плагина, может понадобиться `/reload` или `opencode service restart`.

## Использование

```
/stsTeamPlan <задача>        — analyst: спека + стори со статусами OPEN / IN_PROGRESS / DONE / CANCELLED
/stsTeamImpl <Sxx …>         — планировщик слотов: до N_SLOTS в работе (опция `slots`, по умолчанию 4), новая берётся
                               по освобождению, Dev → QA → Lead, статус DONE после LEAD_PASS
/stsTeamImpl без аргументов  — все готовые стори подряд, пока есть готовые
```

## Артефакты

Скилы и роли пишут в проект:

- `docs/spec/` — спецификацию (ведёт analyst);
- `docs/plan/` — стори и `README.md` со статусами (ведёт analyst);
- `docs/plan/artifacts/` — отчёты и решения по стори:
    - `decisions-Sxx.md` — журнал допущений `D…` этой стори (ведёт только оркестратор `stsTeamImpl`);
    - `bug-report-Sxx.md` — отчёт QA;
    - `review-notes-Sxx.md` — замечания Lead;
- `.temp/` — временные файлы, свидетельства QA (`.temp/qa-Sxx/`) и статусборд `.temp/scheduler.md`; в git не попадает,
  добавь `.temp/` в `.gitignore` проекта.

`decisions-Sxx.md` коммитится вместе со стори; файлы разных сторей не пересекаются. Старый общий `decisions.md`, если он
остался от прежних прогонов, не перезаписывается: новые решения идут в `decisions-Sxx.md`, а старые блоки читаются по
метке стори.

## Тест

```
node --test
```
