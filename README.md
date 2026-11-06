# sts-team-opencode-plugin

Пакет для [OpenCode](https://opencode.ai) **V2**: рабочий цикл **спека → стори → dev → QA → Lead** подключается одним
плагином.

Копия `.cursor/skills/{multi-plan,multi-impl}` и `.cursor/agents/{analyst,dev,qa,lead}` из проекта
`asteroid-defense-game`, приспособленная для переноса в другие проекты. Источник правды — `AGENTS.md`, `docs/spec/`, код
и тесты проекта.

## Что внутри

| Путь                 | Что это                                                                                                                                                          |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `plugin.js`          | Плагин OpenCode V2: регистрирует скилы, агентов и команды                                                                                                        |
| `skills/multi-plan/` | Скил планирования: спека + нарезка сторей (`SKILL.md`, `prompt-analyst.md`, `story-template.md`)                                                                 |
| `skills/multi-impl/` | Скил реализации: планировщик слотов (до N_SLOTS стори в работе, по умолчанию 4), Dev → QA → Lead (`SKILL.md`, `prompt-dev.md`, `prompt-qa.md`, `prompt-lead.md`) |
| `agents/`            | Роли `analyst`, `dev`, `qa`, `lead` (тело файла — системный промпт)                                                                                              |
| `commands/`          | Шаблоны `/multi-plan`, `/multi-impl` с `$ARGUMENTS`                                                                                                              |

Скил `mymarket` в пакет не входит — добавь копированием, если понадобится: `skills/<имя>/` + `agents/<роль>.md`.

## Что делает плагин

![ag.drawio.png](ag.drawio.png)

При загрузке, в `setup` V2-плагина:

1. регистрирует субагентов `analyst`, `dev`, `qa`, `lead` через `ctx.agent.transform` (`editor.update` создаёт агента,
   если его ещё нет);
2. регистрирует скилы через `ctx.skill.transform` — они доступны как `multi-plan`, `multi-impl` без копирования в
   проект;
3. регистрирует команды `/multi-plan`, `/multi-impl` через `ctx.command.transform`; `$ARGUMENTS` заменяется аргументами,
   а если плейсхолдера нет — аргументы дописываются в конец.

## Требования

- OpenCode **2.x** (V2 plugin API; код совместим с `@opencode/plugin` 2.2.x).
- Проект со структурой `AGENTS.md` + `docs/spec/` + `docs/plan/` — как в `asteroid-defense-game`. `multi-plan` создаёт
  недостающие файлы при первом запуске.

## Подключение

![img.png](img.png)

### A. Плагином (рекомендуется)

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
| `commands`  | `true`       | регистрировать `/multi-plan`, `/multi-impl`                                          |
| `overwrite` | `true`       | перекрывать скилы, команды и агентов с теми же ID; `false` — существующие не трогать |
| `slots`     | `4`          | максимум стори «в работе»; подставляется в скил вместо `{{N_SLOTS}}`                 |

Конфиг в V2 перечитывается без перезапуска. Если менялся код локального плагина, может понадобиться `/reload` или
`opencode service restart`.

### B. Без плагина

- Скилы: `"skills": ["D:/mycode/sts-team-opencode-plugin/skills"]`; замени `{{N_SLOTS}}` в `skills/multi-impl/SKILL.md`
  на нужное число (по умолчанию 4).
- Агенты: скопировать `agents/*.md` в `.opencode/agents/` и заменить `{{PACKAGE_DIR}}` в `analyst.md` на путь к пакету.
  Либо описать роли в секции `agents` конфига.
- Команды: скопировать `commands/*.md` в `.opencode/commands/` или вызывать скилы через `@multi-plan` / инструмент
  `skill` с `id: "multi-plan"`.

## Использование

```
/multi-plan <задача>        — analyst: спека + стори со статусами
/multi-impl <Sxx …>         — планировщик слотов: до N_SLOTS в работе (по умолчанию 4), новая берётся по освобождению,
                              Dev → QA → Lead, статус «сделано» после LEAD_PASS
/multi-impl без аргументов  — все готовые стори подряд, пока есть готовые
```

Поведение бывшего `/multi-impl-v3` стало основным `/multi-impl`; отдельные команда и скил `multi-impl-v3` больше не
нужны.

Субагентов оркестратор запускает сам (инструмент `subagent`); вручную — тем же инструментом с `agent: "analyst"` /
`"dev"` / `"qa"` / `"lead"`.

## Артефакты

Скилы и роли пишут в проект, в `.cursor/artifacts/`:

- `decisions.md` — журнал допущений `D…` (ведёт оркестратор `multi-impl`);
- `bug-report-Sxx.md` — отчёт QA;
- `review-notes-Sxx.md` — замечания Lead;
- `scheduler.md` — статусборд `multi-impl`.

Путь оставлен от Cursor-версии, чтобы файлы не разъезжались между инструментами. Если `.cursor/` не нужен — замени путь
в скилах и агентах на удобный.

## Отличия V2-версии

- Плагин больше не использует V1 `config`-хук и мутацию `cfg.skills` / `cfg.agent` / `cfg.command`: скилы, агенты и
  команды регистрируются через `ctx.skill.transform` / `ctx.agent.transform` / `ctx.command.transform`.
- Конфиг: `plugin` → `plugins`; tuple `[path, options]` → объект `{ package, options }`.
- В командах инструмент `skill` вызывается по `id`, а не по `name`.
- ID агента берётся из имени файла `agents/*.md`; frontmatter `name` в V2 не нужен.
- Ссылки вида `.cursor/agents/*.md` заменены на имена субагентов, которых регистрирует плагин.
- Формулировки привязаны к проекту через `AGENTS.md`, `docs/spec/`, код и тесты.

## Тест

```
node --test
```
