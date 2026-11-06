import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import plugin from "../plugin.js"

const packageDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const packageDirPosix = packageDir.replaceAll("\\", "/")
const skillsDir = path.join(packageDir, "skills")
const agentsDir = path.join(packageDir, "agents")
const commandsDir = path.join(packageDir, "commands")

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function frontmatterName(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const name = match && /^name:\s*(\S+)\s*$/m.exec(match[1])
  return name ? name[1] : undefined
}

function makeContext({ options = {}, skills = [], agents = [], commands = [] } = {}) {
  const skillMap = new Map(skills.map((skill) => [skill.id, skill]))
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]))
  const commandMap = new Map(commands.map((command) => [command.name, command]))
  const prompts = []

  const ctx = {
    options,
    location: { directory: "/project" },
    skill: {
      list: async () => ({ location: {}, data: [...skillMap.values()] }),
      transform: async (callback) => {
        callback({
          list: () => [...skillMap.values()],
          get: (id) => skillMap.get(id),
          add: (skill) => skillMap.set(skill.id, skill),
          update: () => {},
          remove: (id) => skillMap.delete(id),
        })
      },
    },
    agent: {
      list: async () => ({ location: {}, data: [...agentMap.values()] }),
      transform: async (callback) => {
        callback({
          list: () => [...agentMap.values()],
          get: (id) => agentMap.get(id),
          default: () => {},
          update: (id, update) => {
            const current = agentMap.get(id) ?? {
              id,
              name: id,
              request: { settings: {}, headers: {}, body: {} },
              mode: "primary",
              hidden: false,
              permissions: [],
            }
            if (!agentMap.has(id)) agentMap.set(id, current)
            update(current)
            current.id = id
          },
          remove: (id) => agentMap.delete(id),
        })
      },
    },
    command: {
      list: async () => ({ location: {}, data: [...commandMap.values()] }),
      transform: async (callback) => {
        callback({ add: (command) => commandMap.set(command.name, command) })
      },
    },
    session: {
      prompt: async (input) => {
        prompts.push(input)
      },
    },
  }

  return { ctx, skills: skillMap, agents: agentMap, commands: commandMap, prompts }
}

test("exports a V2 plugin definition", () => {
  assert.equal(plugin.id, "sts-team.sdd")
  assert.equal(typeof plugin.setup, "function")
})

test("registers embedded skills", async () => {
  const { ctx, skills } = makeContext()
  await plugin.setup(ctx)

  assert.deepEqual([...skills.keys()].sort(), ["sts-team-impl", "sts-team-plan"])
  for (const skill of skills.values()) {
    assert.equal(skill.autoinvoke, false)
    assert.equal(skill.id, skill.name)
    assert.ok(skill.description.length > 20)
    assert.ok(skill.path.startsWith(packageDir))
    assert.ok(skill.path.endsWith(path.join(skill.id, "SKILL.md")))
    assert.ok(skill.content.length > 200)
    assert.ok(!skill.content.startsWith("---"))
    assert.ok(!skill.description.includes("{{N_SLOTS}}"))
    assert.ok(!skill.content.includes("{{N_SLOTS}}"))
  }
})

test("substitutes N_SLOTS into embedded skills", async () => {
  const fallback = makeContext({ options: { slots: 0 } })
  await plugin.setup(fallback.ctx)
  assert.match(fallback.skills.get("sts-team-impl").description, /до 4 стори/)
  assert.match(fallback.skills.get("sts-team-impl").content, /Максимум \*\*4\*\*/)

  const custom = makeContext({ options: { slots: 2 } })
  await plugin.setup(custom.ctx)
  assert.match(custom.skills.get("sts-team-impl").description, /до 2 стори/)
  assert.match(custom.skills.get("sts-team-impl").content, /Максимум \*\*2\*\*/)
  assert.ok(!custom.skills.get("sts-team-impl").content.includes("{{N_SLOTS}}"))
})

test("registers four subagents through the agent transform", async () => {
  const { ctx, agents } = makeContext()
  await plugin.setup(ctx)

  assert.deepEqual([...agents.keys()].sort(), ["analyst", "dev", "lead", "qa"])
  for (const agent of agents.values()) {
    assert.equal(agent.mode, "subagent")
    assert.ok(agent.description.length > 20)
    assert.ok(agent.system.length > 200)
    assert.ok(!agent.system.includes("{{PACKAGE_DIR}}"))
  }

  assert.ok(agents.get("analyst").system.includes(`${packageDirPosix}/skills/sts-team-plan/story-template.md`))
  assert.match(agents.get("dev").description, /Разработчик стори: пишет код/)
})

test("registers commands and renders $ARGUMENTS", async () => {
  const { ctx, commands, prompts } = makeContext()
  await plugin.setup(ctx)

  assert.deepEqual([...commands.keys()].sort(), ["sts-team-impl", "sts-team-plan"])

  const file = { uri: "file:///spec.md", mention: { start: 0, end: 3, text: "S01" } }
  await commands.get("sts-team-plan").execute({
    sessionID: "ses_test",
    prompt: { text: "S01 $& $1", files: [file] },
    delivery: "queue",
  })

  assert.equal(prompts.length, 1)
  const sent = prompts[0]
  assert.equal(sent.sessionID, "ses_test")
  assert.equal(sent.delivery, "queue")
  assert.ok(sent.text.includes('id: "sts-team-plan"'))
  assert.ok(sent.text.includes("S01 $& $1"))
  assert.ok(!sent.text.includes("$ARGUMENTS"))

  const at = sent.text.indexOf("S01 $& $1")
  assert.ok(at > 0)
  assert.deepEqual(sent.files[0].mention, { start: at, end: at + 3, text: "S01" })
})

test("overwrite: false keeps existing skills, agents and commands", async () => {
  const existingSkill = { id: "sts-team-plan", name: "Custom", description: "custom", path: "/x", content: "custom" }
  const existingAgent = { id: "dev", name: "dev", description: "custom", mode: "subagent", system: "custom" }
  const existingCommand = { name: "sts-team-plan", description: "custom" }
  const { ctx, skills, agents, commands } = makeContext({
    options: { overwrite: false },
    skills: [existingSkill],
    agents: [existingAgent],
    commands: [existingCommand],
  })
  await plugin.setup(ctx)

  assert.equal(skills.get("sts-team-plan"), existingSkill)
  assert.equal(agents.get("dev"), existingAgent)
  assert.equal(agents.get("dev").description, "custom")
  assert.equal(commands.get("sts-team-plan"), existingCommand)
  assert.ok(skills.has("sts-team-impl"))
  assert.ok(agents.has("qa"))
  assert.ok(commands.has("sts-team-impl"))
})

test("overwrite: true replaces changed skills and agents", async () => {
  const existingSkill = { id: "sts-team-plan", name: "Custom", description: "custom", path: "/x", content: "custom" }
  const existingAgent = { id: "dev", name: "dev", description: "custom", mode: "subagent", system: "custom" }
  const { ctx, skills, agents } = makeContext({ skills: [existingSkill], agents: [existingAgent] })
  await plugin.setup(ctx)

  assert.notEqual(skills.get("sts-team-plan").content, "custom")
  assert.notEqual(agents.get("dev").description, "custom")
  assert.ok(agents.get("dev").system.length > 200)
})

test("options disable parts of the registration", async () => {
  const { ctx, skills, agents, commands } = makeContext({
    options: { skills: false, agents: false, commands: false },
  })
  await plugin.setup(ctx)

  assert.equal(skills.size, 0)
  assert.equal(agents.size, 0)
  assert.equal(commands.size, 0)
})

test("every skill directory matches its frontmatter name", () => {
  const dirs = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  assert.ok(dirs.length > 0)
  for (const dir of dirs) {
    const file = path.join(skillsDir, dir, "SKILL.md")
    assert.ok(fs.existsSync(file), `${dir} has SKILL.md`)
    assert.equal(frontmatterName(fs.readFileSync(file, "utf8")), dir, `${dir} frontmatter name matches directory`)
  }
})

test("no mentions of the source project or its skill names", () => {
  const stale = /\b(myimpl|myimpl2|myimpl3|myplan|mymarket)\b|asteroid-defense-game/
  const files = [path.join(packageDir, "README.md"), ...walk(skillsDir), ...walk(agentsDir), ...walk(commandsDir)]

  for (const file of files) {
    assert.ok(!stale.test(fs.readFileSync(file, "utf8")), `${file} mentions the source project`)
  }
})
