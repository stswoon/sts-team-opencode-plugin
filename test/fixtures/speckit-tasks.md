## User Input

```text
$ARGUMENTS
```

## Pre-Execution Checks

**Check for extension hooks (before tasks generation)**:
- look for `hooks.before_tasks`

## Outline

1. **Setup**: Run `.specify/scripts/powershell/setup-tasks.ps1 -Json` and parse `TASKS_TEMPLATE_CONTENT`.

2. **Load design documents**.

3. **Execute task generation workflow**.

4. **Generate tasks.md**.

## Mandatory Post-Execution Hooks

Check `hooks.after_tasks`.

## Completion Report

Output path to generated tasks.md and summary.

## Task Generation Rules

Every task MUST follow the checklist format.
