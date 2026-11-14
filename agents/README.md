# Субагенты

Плагин регистрирует четыре субагента через `ctx.agent.transform` (`mode: subagent`). Форк работает только со Spec Kit:
`specs/<NNN>-<short-name>/` (`spec.md`, `plan.md`, `tasks.md`).

| Субагент | Роль | Пишет код | Пишет отчёт | Когда |
|---|---|---|---|---|
| **analyst** | Нарезка `tasks.md` и приёмка по `spec.md` | нет | `tasks.md`, `acceptance-<item>.md` | `stsTeamPlan`; `stsTeamImpl` после Lead |
| **dev** | Разработчик работы | да (код + тесты) | отчёт в ответе | `stsTeamImpl`; после QA/Lead/Analyst |
| **qa** | Независимый QA | production-код нет; тесты — если дыра в проверке | `bug-report-<item>.md` | после Dev |
| **lead** | Ревьюер | нет | `review-notes-<item>.md` | после доказательного `QA_PASS` |

Статусы работ (`OPEN` / `IN_PROGRESS` / `DONE` / `CANCELLED`) меняет **оркестратор** `stsTeamImpl`: `IN_PROGRESS` — при
взятии в слот, `DONE` — после `ANALYST_PASS`; `CANCELLED` ставит только пользователь или analyst. Эти агенты статус не
меняют.

- `stsTeamPlan` любые допущения и нестыковки выносит вопросами пользователю.
- `stsTeamImpl` допущения закрывает сам (решения `D…` в `specs/<feature>/artifacts/decisions-<item>.md`), а нестыковки и
  расхождения со спекой выносит пользователю.

Субагент не видит историю родительского чата: в промпт `subagent` передавай `FEATURE_DIR`, ID работы, тело фазы, пути к
`spec.md` / `plan.md` / `tasks.md`, решения `D…` и пути к отчётам предыдущего шага с выжимкой активных блокеров — файлы
субагент читает сам, полные тексты не копируй.

Без плагина роли можно описать в секции `agents` конфига или положить файлами в `.opencode/agents/`. Формат V2:
frontmatter `description` / `mode`, тело — системный промпт; ID агента берётся из имени файла (`analyst.md` →
`analyst`), поле `name` не нужно. В этом случае замени в `analyst.md` плейсхолдер `{{PACKAGE_DIR}}` на путь к пакету.
