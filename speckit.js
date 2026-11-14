const IMPLEMENT_MARKER = "## Team Mode (stsTeam plugin)"
const TASKS_MARKER = "## Parallel Slicing Pass (stsTeam plugin)"
const IMPLEMENT_END = "## Mandatory Post-Execution Hooks"
const TASKS_END_FALLBACK = "## Completion Report"
const IMPLEMENT_START = /^3\.\s+Load and analyze the implementation context:/m

function noop(text) {
  return { changed: false, kind: "none", text: text ?? "" }
}

function isClassic(text) {
  return /(^|\s)--classic(\s|$)/.test(text) || /\bTEAM_MODE=off\b/i.test(text) || /\bSTS_TEAM=off\b/i.test(text)
}

function looksLikeImplement(text) {
  return text.includes("before_implement") && text.includes("Execute implementation following the task plan")
}

function looksLikeTasks(text) {
  return text.includes("before_tasks") && text.includes("TASKS_TEMPLATE_CONTENT")
}

function handoffBlock() {
  return `3. **Team mode handoff (stsTeam plugin).** Do not execute the classic implementation steps 3–9. Invoke the
   skill \`stsTeamImpl\` with:
   - \`FEATURE_DIR\` from step 1;
   - the user input from the "User Input" section above (empty — all ready work items; \`US1 US3\` — only those);
   - \`specs/<feature>/spec.md\`, \`plan.md\`, \`tasks.md\` and the feature artifacts.

   The skill runs the slot scheduler: \`FOUNDATION\` → \`US…\` → \`POLISH\` → \`CONV…\`, each work item through
   Dev → QA → Lead → Analyst; \`QA_FAIL\` / \`LEAD_FAIL\` / \`ANALYST_FAIL\` return the item to Dev; it commits
   each work item after PASS. Do not implement tasks yourself.

   When the skill returns, continue with the "Mandatory Post-Execution Hooks" and "Completion Report" sections
   below.

`
}

function slicingBlock(slots) {
  const n = Number.isInteger(Number(slots)) && Number(slots) > 0 ? Number(slots) : 4
  return `## Parallel Slicing Pass (stsTeam plugin)

After \`tasks.md\` is generated and before the "Mandatory Post-Execution Hooks", invoke the skill \`stsTeamPlan\` with
\`FEATURE_DIR\` from step 1. The skill:
- adds \`**Статус:** OPEN\` under every phase (preserve existing \`DONE\` / \`IN_PROGRESS\`);
- adds \`**Дорожка**\`, \`**Параллель**\`, \`**Зависит от**\`, \`**Разблокирует**\`, \`**Папки (только эти)**\`,
  \`**Ресурсы**\`, \`**Приёмка**\`;
- adds \`**Эксклюзивные пути:**\` and \`## Фронт поставки\` with waves for ${n} slots and the bottleneck;
- must not change task IDs, descriptions, \`[P]\` / \`[US]\` labels, or phase order.

If the skill returns questions, ask the user before completing. Include the front width and bottleneck in the
Completion Report.
`
}

function warning(kind) {
  if (kind === "implement") {
    return `> **stsTeam plugin:** could not apply team mode to \`/speckit.implement\` because the command layout changed.
> The classic Spec Kit implementation will run. Use \`/stsTeamImpl\` for the team cycle.
`
  }
  return `> **stsTeam plugin:** could not insert the parallel slicing pass because the \`/speckit.tasks\` command layout
> changed. Run \`/stsTeamPlan\` manually after task generation.
`
}

function withCmdWrappers(text) {
  return text.replaceAll(/\.specify\/scripts\/powershell\/([\w-]+)\.ps1/g, ".specify/scripts/powershell/$1.cmd")
}

export function transformSpeckitPrompt({ text, slots, hasSpecKit = true, cmdWrappers = false } = {}) {
  if (!hasSpecKit || typeof text !== "string" || text.length === 0) return noop(text)
  if (isClassic(text)) return noop(text)
  const source = cmdWrappers ? withCmdWrappers(text) : text

  if (looksLikeImplement(source)) {
    if (source.includes(IMPLEMENT_MARKER)) return noop(text)

    const start = IMPLEMENT_START.exec(source)
    const end = start ? source.indexOf(IMPLEMENT_END, start.index) : -1
    if (!start || end === -1) {
      const prefix = warning("implement")
      return {
        changed: true,
        kind: "implement",
        text: `${prefix}\n${source}`,
        editStart: 0,
        editEnd: 0,
        replacementLength: prefix.length + 1,
      }
    }

    const block = `${IMPLEMENT_MARKER}\n\n${handoffBlock()}`
    return {
      changed: true,
      kind: "implement",
      text: `${source.slice(0, start.index)}${block}${source.slice(end)}`,
      editStart: start.index,
      editEnd: end,
      replacementLength: block.length,
    }
  }

  if (looksLikeTasks(source)) {
    if (source.includes(TASKS_MARKER)) return noop(text)

    const insertAt = source.indexOf(IMPLEMENT_END) !== -1 ? source.indexOf(IMPLEMENT_END) : source.indexOf(TASKS_END_FALLBACK)
    const block = `${slicingBlock(slots)}\n`
    if (insertAt === -1) {
      const prefix = warning("tasks")
      const tail = `\n\n${prefix}\n${block}`
      return {
        changed: true,
        kind: "tasks",
        text: `${source}${tail}`,
        editStart: source.length,
        editEnd: source.length,
        replacementLength: tail.length,
      }
    }

    return {
      changed: true,
      kind: "tasks",
      text: `${source.slice(0, insertAt)}${block}\n${source.slice(insertAt)}`,
      editStart: insertAt,
      editEnd: insertAt,
      replacementLength: block.length + 1,
    }
  }

  return noop(text)
}

function adjustList(list, edit, delta) {
  if (!Array.isArray(list)) return list
  return list.map((item) => {
    if (!item || typeof item !== "object" || !item.mention) return item
    const { start, end } = item.mention
    if (!Number.isFinite(start) || !Number.isFinite(end)) return item

    if (end <= edit.editStart) return item
    if (start >= edit.editEnd) {
      return {
        ...item,
        mention: { ...item.mention, start: start + delta, end: end + delta },
      }
    }

    const { mention, ...rest } = item
    return rest
  })
}

export function adjustMentions(prompt, edit) {
  if (!prompt || !edit?.changed) return prompt
  const delta = edit.replacementLength - (edit.editEnd - edit.editStart)
  if (!delta) return prompt

  for (const key of ["files", "agents", "skills"]) {
    if (prompt[key]) prompt[key] = adjustList(prompt[key], edit, delta)
  }
  return prompt
}
