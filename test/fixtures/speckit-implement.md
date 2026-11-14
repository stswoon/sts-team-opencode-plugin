## User Input

```text
$ARGUMENTS
```

## Pre-Execution Checks

**Check for extension hooks (before implementation)**:
- look for `hooks.before_implement`

## Outline

1. Run `.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks`.

2. **Check checklists status**.

3. Load and analyze the implementation context:
   - Read tasks.md, plan.md, spec.md.

4. Project Setup Verification.

5. Parse tasks.md structure.

6. Execute implementation following the task plan:
   - Phase-by-phase execution.

7. Implementation execution rules.

8. Progress tracking and error handling.

9. Completion validation.

## Mandatory Post-Execution Hooks

Check `hooks.after_implement`.

## Completion Report

Report final status.
