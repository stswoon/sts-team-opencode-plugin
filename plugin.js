import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const packageDirPosix = packageDir.replaceAll("\\", "/")
const skillsDir = path.join(packageDir, "skills")
const agentsDir = path.join(packageDir, "agents")
const commandsDir = path.join(packageDir, "commands")

const DEFAULTS = {
  skills: true,
  agents: true,
  commands: true,
  overwrite: true,
}

const commandNames = fs.existsSync(commandsDir)
  ? fs
      .readdirSync(commandsDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3))
      .sort()
  : []

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

function loadAgents() {
  const agents = []
  for (const file of fs.readdirSync(agentsDir)) {
    if (!file.endsWith(".md")) continue
    const { data, body } = readMarkdown(path.join(agentsDir, file))
    if (!data.name || !data.description) continue
    agents.push({
      name: data.name,
      description: data.description,
      mode: data.mode ?? "subagent",
      prompt: body.replaceAll("{{PACKAGE_DIR}}", packageDirPosix),
    })
  }
  return agents
}

function loadCommand(name) {
  const file = path.join(commandsDir, `${name}.md`)
  if (!fs.existsSync(file)) return undefined
  const { data, body } = readMarkdown(file)
  return {
    description: data.description,
    template: body.replaceAll("{{PACKAGE_DIR}}", packageDirPosix),
  }
}

export default async function WorkflowPlugin(_input, options = {}) {
  const settings = { ...DEFAULTS, ...(options && typeof options === "object" ? options : {}) }
  const agents = settings.agents ? loadAgents() : []

  return {
    config: async (cfg) => {
      if (settings.skills) {
        if (Array.isArray(cfg.skills)) {
          if (!cfg.skills.includes(skillsDir)) cfg.skills.push(skillsDir)
        } else {
          const skills = (cfg.skills ??= {})
          const paths = (skills.paths ??= [])
          if (!paths.includes(skillsDir)) paths.push(skillsDir)
        }
      }

      if (settings.agents) {
        cfg.agent ??= {}
        for (const agent of agents) {
          if (!settings.overwrite && cfg.agent[agent.name]) continue
          cfg.agent[agent.name] = {
            name: agent.name,
            description: agent.description,
            mode: agent.mode,
            prompt: agent.prompt,
          }
        }
      }

      if (settings.commands) {
        cfg.command ??= {}
        for (const name of commandNames) {
          if (!settings.overwrite && cfg.command[name]) continue
          const command = loadCommand(name)
          if (command) cfg.command[name] = command
        }
      }
    },
  }
}
