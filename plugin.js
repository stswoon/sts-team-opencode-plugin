import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const packageDirPosix = packageDir.replaceAll("\\", "/")
const skillsDir = path.join(packageDir, "skills")
const agentsDir = path.join(packageDir, "agents")
const commandsDir = path.join(packageDir, "commands")

const PLUGIN_ID = "sts-team.sdd"
const DEFAULTS = {
  skills: true,
  agents: true,
  commands: true,
  overwrite: true,
  slots: 4,
}

function normalizeSlots(value) {
  const slots = Number(value)
  return Number.isInteger(slots) && slots > 0 ? slots : DEFAULTS.slots
}

function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { data: {}, body: text.trim() }

  const data = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const entry = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(lines[i])
    if (!entry) continue
    const key = entry[1]
    let value = entry[2].trim()

    if (/^[>|][+-]?$/.test(value)) {
      const folded = value.startsWith(">")
      const block = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const next = lines[j]
        if (next.trim() !== "" && !/^\s/.test(next)) break
        block.push(next.trim())
      }
      i = j - 1
      value = (folded ? block.join(" ") : block.join("\n")).trim()
    } else if (value.length >= 2) {
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
      if (quoted) value = value.slice(1, -1)
    }

    data[key] = value
  }

  return { data, body: text.slice(match[0].length).trim() }
}

function readMarkdown(file) {
  return parseFrontmatter(fs.readFileSync(file, "utf8"))
}

function loadSkills(slots) {
  const slotsText = String(slots)
  const withSlots = (text) => text.replaceAll("{{N_SLOTS}}", slotsText)

  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(skillsDir, entry.name, "SKILL.md")
      if (!fs.existsSync(file)) return undefined

      const { data, body } = readMarkdown(file)
      if (!data.description) return undefined

      return {
        id: entry.name,
        name: data.name ?? entry.name,
        description: withSlots(data.description),
        // V2 keeps accepting disable-model-invocation as a portability field,
        // but embedded skills must map it to autoinvoke explicitly.
        ...(String(data["disable-model-invocation"]).toLowerCase() === "true" ? { autoinvoke: false } : {}),
        path: file,
        content: withSlots(body),
      }
    })
    .filter(Boolean)
}

function loadAgents() {
  return fs
    .readdirSync(agentsDir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .map((file) => {
      const name = path.basename(file, ".md")
      const { data, body } = readMarkdown(path.join(agentsDir, file))
      if (!data.description) return undefined

      return {
        name,
        description: data.description,
        mode: data.mode ?? "subagent",
        prompt: body.replaceAll("{{PACKAGE_DIR}}", () => packageDirPosix),
      }
    })
    .filter(Boolean)
}

function loadCommands() {
  return fs
    .readdirSync(commandsDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const name = path.basename(file, ".md")
      const { data, body } = readMarkdown(path.join(commandsDir, file))
      if (!data.description || !body) return undefined
      return { name, description: data.description, template: body }
    })
    .filter(Boolean)
}

function shiftMentions(prompt, offset) {
  if (!offset) return prompt

  const shift = (list) =>
    list?.map((item) =>
      item?.mention
        ? {
            ...item,
            mention: {
              ...item.mention,
              start: item.mention.start + offset,
              end: item.mention.end + offset,
            },
          }
        : item,
    )

  const shifted = { ...prompt }
  for (const key of ["files", "agents", "skills"]) {
    if (shifted[key]) shifted[key] = shift(shifted[key])
  }
  return shifted
}

function renderCommand(template, args) {
  const text = (args ?? "").trim()
  const marker = "$ARGUMENTS"
  const at = template.indexOf(marker)

  if (at === -1) {
    const prefix = template.trimEnd()
    return { text: text ? `${prefix}\n\n${text}` : prefix, offset: text ? prefix.length + 2 : 0 }
  }

  return { text: template.replaceAll(marker, () => text), offset: at }
}

async function existingSkillIds(ctx) {
  try {
    const result = await ctx.skill.list()
    return new Set((result?.data ?? []).map((skill) => skill.id))
  } catch {
    return new Set()
  }
}

async function existingAgentIds(ctx) {
  try {
    const result = await ctx.agent.list()
    return new Set((result?.data ?? []).map((agent) => agent.id))
  } catch {
    return new Set()
  }
}

async function existingCommandNames(ctx) {
  try {
    const result = await ctx.command.list()
    return new Set((result?.data ?? []).map((command) => command.name))
  } catch {
    return new Set()
  }
}

async function registerSkills(ctx, overwrite, slots) {
  const existing = overwrite ? new Set() : await existingSkillIds(ctx)
  const skills = loadSkills(slots).filter((skill) => !existing.has(skill.id))
  if (skills.length === 0) return

  await ctx.skill.transform((editor) => {
    for (const skill of skills) editor.add(skill)
  })
}

async function registerAgents(ctx, overwrite) {
  const existing = overwrite ? new Set() : await existingAgentIds(ctx)
  const agents = loadAgents().filter((agent) => !existing.has(agent.name))
  if (agents.length === 0) return

  await ctx.agent.transform((editor) => {
    for (const agent of agents) {
      // AgentEditor.update() upserts: OpenCode creates the agent from
      // Agent.Info.default(id) when the ID is not registered yet.
      editor.update(agent.name, (item) => {
        item.name = agent.name
        item.description = agent.description
        item.mode = agent.mode
        item.system = agent.prompt
      })
    }
  })
}

async function registerCommands(ctx, overwrite) {
  const existing = overwrite ? new Set() : await existingCommandNames(ctx)
  const commands = loadCommands().filter((command) => !existing.has(command.name))
  if (commands.length === 0) return

  await ctx.command.transform((editor) => {
    for (const command of commands) {
      editor.add({
        name: command.name,
        description: command.description,
        execute: async ({ sessionID, prompt, delivery }) => {
          const { text, offset } = renderCommand(command.template, prompt.text)
          await ctx.session.prompt({
            ...shiftMentions(prompt, offset),
            sessionID,
            text,
            delivery,
          })
        },
      })
    }
  })
}

// The exact shape returned by Plugin.define() from @opencode/plugin. Inlined so
// a local plugin directory does not need its own node_modules with that package.
export default {
  id: PLUGIN_ID,
  async setup(ctx) {
    const settings = { ...DEFAULTS, ...(ctx.options && typeof ctx.options === "object" ? ctx.options : {}) }
    const slots = normalizeSlots(settings.slots)

    if (settings.agents) await registerAgents(ctx, settings.overwrite)
    if (settings.skills) await registerSkills(ctx, settings.overwrite, slots)
    if (settings.commands) await registerCommands(ctx, settings.overwrite)
  },
}
