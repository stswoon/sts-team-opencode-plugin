# opencode-plugin

Пакет для [OpenCode](https://opencode.ai): рабочий цикл **спека → стори → dev → QA → Lead** подключается одним плагином.

Копия `.cursor/skills/{multi-plan,multi-impl,multi-impl2,multi-impl-v3}` и `.cursor/agents/{analyst,dev,qa,lead}` из проекта `asteroid-defense-game`, приспособленная для переноса в другие проекты. Формулировки проект-агностик: источник правды — `AGENTS.md`, `docs/spec/`, код и тесты проекта.

## Что внутри

| Путь | Что это |
|------|---------|
| `plugin.js` | Плагин OpenCode: регистрирует скилы, субагентов и команды |
| `skills/multi-plan/` | Скил планирования: спека + нарезка сторей (`SKILL.md`, `prompt-analyst.md`, `story-template.md`) |
| `skills/multi-impl/` | Скил реализации: волна Dev → QA → Lead (`SKILL.md`, `prompt-dev.md`, `prompt-qa.md`, `prompt-lead.md`) |
| `skills/multi-impl2/` | Скил непрерывного цикла: волна за волной через `multi-impl`, пока есть готовые стори и нет блокеров |
| `skills/multi-impl-v3/` | Скил-планировщик слотов: 4 стори в работе, без волн |
| `agents/` | Роли `analyst`, `dev`, `qa`, `lead` (тело файла — системный промпт) |
| `commands/` | Обёртки `/multi-plan`, `/multi-impl`, `/multi-impl2`, `/multi-impl-v3` с передачей `$ARGUMENTS` |

Скил `mymarket` в пакет не входит — добавь копированием, если понадобится: `skills/<имя>/` + `agents/<роль>.md`.

## Что делает плагин

![ag.drawio.png](ag.drawio.png)

Один раз за инстанс, в config-hook (OpenCode применяет его до инициализации агентов и скилов — `InstanceBootstrap`: «Plugin can mutate config so it has to be initialized before anything else»):

1. добавляет `<пакет>/skills` в `skills.paths` — скилы видны как `/multi-plan`, `/multi-impl`, `/multi-impl2`, `/multi-impl-v3`;
2. регистрирует субагентов `analyst`, `dev`, `qa`, `lead` (промпт — тело `agents/*.md`);
3. регистрирует команды `/multi-plan`, `/multi-impl`, `/multi-impl2`, `/multi-impl-v3` (шаблоны — `commands/*.md`).

## Требования

- OpenCode **>= 1.18.30** (config-hook с мутацией `cfg.skills`, `cfg.agent`, `cfg.command`). Проверено на desktop 1.18.31.
- Проект со структурой `AGENTS.md` + `docs/spec/` + `docs/plan/` — как в `asteroid-defense-game`. `multi-plan` создаёт недостающие файлы при первом запуске.

## Подключение

![img.png](img.png)

### A. Плагином (рекомендуется)

`opencode.json` — в проекте или глобальный `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///D:/mycode/opencode-plugin"]
}
```

Путь указывается на каталог пакета (`package.json` → `main`) или на файл:

```json
"plugin": ["file:///D:/mycode/opencode-plugin/plugin.js"]
```

Плагин локальный, поэтому путь чувствителен к переносу пакета. Для нескольких проектов сразу — глобальный конфиг.

Опции передаются tuple-формой:

```json
"plugin": [["file:///D:/mycode/opencode-plugin", { "overwrite": false }]]
```

| Опция | По умолчанию | Смысл |
|-------|--------------|-------|
| `skills` | `true` | добавлять `<пакет>/skills` в `skills.paths` |
| `agents` | `true` | регистрировать `analyst` / `dev` / `qa` / `lead` |
| `commands` | `true` | регистрировать `/multi-plan`, `/multi-impl`, `/multi-impl-v3` |
| `overwrite` | `true` | перекрывать одноимённых агентов и команды, объявленные в конфиге проекта; `false` — существующие не трогать |

После правки конфига **перезапустить OpenCode** — конфиг читается один раз при старте.

### B. Без плагина

- Скилы: `"skills": { "paths": ["D:/mycode/opencode-plugin/skills"] }`.
- Агенты: скопировать `agents/*.md` в `.opencode/agents/` (или `~/.config/opencode/agents/`) и заменить в `analyst.md` плейсхолдер `{{PACKAGE_DIR}}` на путь к пакету.
- Команды: можно не копировать — каждый скил автоматически становится командой, а аргументы при отсутствии `$ARGUMENTS` дописываются в конец промпта. `commands/*.md` нужны, только если хочется явный шаблон.

## Использование

```
/multi-plan <задача>        — analyst: спека + стори со статусами
/multi-impl <Sxx …>         — одна волна: Dev → QA → Lead, статус «сделано» после LEAD_PASS
/multi-impl2 <Sxx …>        — волны подряд, пока есть готовые стори и нет блокирующих замечаний
/multi-impl-v3 <Sxx …>      — планировщик слотов: 4 стори в работе, новая берётся по освобождению
/multi-impl без аргументов  — все готовые стори одной волной
```

Субагентов оркестратор запускает сам (Task); вручную — `/analyst`, `/dev`, `/qa`, `/lead`.

## Артефакты

Скилы и роли пишут в проект, в `.cursor/artifacts/`:

- `decisions.md` — журнал допущений `D…` (ведёт оркестратор `multi-impl`);
- `bug-report-Sxx.md` — отчёт QA;
- `review-notes-Sxx.md` — замечания Lead;
- `scheduler.md` — статусборд `multi-impl-v3`.

Путь оставлен от Cursor-версии, чтобы файлы не разъезжались между инструментами. Если `.cursor/` не нужен — замени путь в скилах и агентах на удобный.

## Отличия копии от `.cursor`-версии

- Ссылки вида `.cursor/agents/*.md` заменены на имена агентов, которые регистрирует плагин.
- Формулировки проект-агностик: «The Space Game», `remake.md`, `original/decompiled/**` и «декомпил» убраны; источник правды — `AGENTS.md`, `docs/spec/`, код и тесты проекта.
- В `agents/analyst.md` путь к шаблону стори — плейсхолдер `{{PACKAGE_DIR}}`, плагин подставляет абсолютный путь пакета.
- Роли в frontmatter: `name` / `description` / `mode: subagent` (OpenCode-совместимо; вручную копируемые файлы тоже работают).
- Остальной текст скилов и ролей — как в исходном проекте, кроме проект-агностик замен выше; при изменениях там синхронизируй копию вручную.

## Тест

```
node --test
```
