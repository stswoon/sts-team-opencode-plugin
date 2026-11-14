import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import plugin from "../plugin.js"
import { adjustMentions, transformSpeckitPrompt } from "../speckit.js"

const packageDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
const packageDirPosix = packageDir.replaceAll("\\", "/")
const skillsDir = path.join(packageDir, "skills")
const agentsDir = path.join(packageDir, "agents")
const commandsDir = path.join(packageDir, "commands")
const fixturesDir = path.join(packageDir, "test", "fixtures")
const speckitProjectDir = path.join(fixturesDir, "speckit-project")

const implementFixture = fs.readFileSync(path.join(fixturesDir, "speckit-implement.md"), "utf8")
const tasksFixture = fs.readFileSync(path.join(fixturesDir, "speckit-tasks.md"), "utf8")

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

function makeContext({ options = {}, skills = [], agents = [], commands = [], directory = "/project" } = {}) {
  const skillMap = new Map(skills.map((skill) => [skill.id, skill]))
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]))
  const commandMap = new Map(commands.map((command) => [command.name, command]))
  const prompts = []
  const hooks = []

  const ctx = {
    options,
    location: { directory },
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
      hook: async (name, callback) => {
        hooks.push({ name, fn: callback })
        return { dispose: async () => {} }
      },
      prompt: async (input) => {
        prompts.push(input)
      },
    },
  }

  return { ctx, skills: skillMap, agents: agentMap, commands: commandMap, prompts, hooks }
}

test("exports a V2 plugin definition", () => {
  assert.equal(plugin.id, "sts-team.sdd")
  assert.equal(typeof plugin.setup, "function")
})

test("registers embedded skills", async () => {
  const { ctx, skills } = makeContext()
  await plugin.setup(ctx)

  assert.deepEqual([...skills.keys()].sort(), ["stsTeamImpl", "stsTeamPlan"])
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
  assert.match(fallback.skills.get("stsTeamImpl").description, /до 4 работ/)
  assert.match(fallback.skills.get("stsTeamImpl").content, /слотов в работе: 4/)
  assert.match(fallback.skills.get("stsTeamPlan").description, /при 4 слотах/)

  const custom = makeContext({ options: { slots: 2 } })
  await plugin.setup(custom.ctx)
  assert.match(custom.skills.get("stsTeamImpl").description, /до 2 работ/)
  assert.match(custom.skills.get("stsTeamImpl").content, /слотов в работе: 2/)
  assert.match(custom.skills.get("stsTeamPlan").description, /при 2 слотах/)
  assert.ok(!custom.skills.get("stsTeamImpl").content.includes("{{N_SLOTS}}"))
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

  assert.ok(
    agents.get("analyst").system.includes(`${packageDirPosix}/skills/stsTeamPlan/tasks-metadata-template.md`),
  )
  assert.match(agents.get("dev").description, /Разработчик работы Spec Kit/)
})

test("registers commands and renders $ARGUMENTS", async () => {
  const { ctx, commands, prompts } = makeContext()
  await plugin.setup(ctx)

  assert.deepEqual([...commands.keys()].sort(), ["stsTeamImpl", "stsTeamPlan"])

  const file = { uri: "file:///spec.md", mention: { start: 0, end: 3, text: "S01" } }
  await commands.get("stsTeamPlan").execute({
    sessionID: "ses_test",
    prompt: { text: "S01 $& $1", files: [file] },
    delivery: "queue",
  })

  assert.equal(prompts.length, 1)
  const sent = prompts[0]
  assert.equal(sent.sessionID, "ses_test")
  assert.equal(sent.delivery, "queue")
  assert.ok(sent.text.includes('id: "stsTeamPlan"'))
  assert.ok(sent.text.includes("S01 $& $1"))
  assert.ok(!sent.text.includes("$ARGUMENTS"))

  const at = sent.text.indexOf("S01 $& $1")
  assert.ok(at > 0)
  assert.deepEqual(sent.files[0].mention, { start: at, end: at + 3, text: "S01" })
})

test("command templates reference registered skill ids", async () => {
  const { ctx, skills } = makeContext()
  await plugin.setup(ctx)

  for (const file of fs.readdirSync(commandsDir).filter((name) => name.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(commandsDir, file), "utf8")
    const ids = [...text.matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1])
    assert.ok(ids.length > 0, `${file} references a skill`)
    for (const id of ids) {
      assert.ok(skills.has(id), `${file} references missing skill ${id}`)
    }
  }
})

test("registers a Spec Kit prompt hook", async () => {
  const { ctx, hooks } = makeContext({ directory: speckitProjectDir })
  await plugin.setup(ctx)

  assert.equal(hooks.length, 1)
  assert.equal(hooks[0].name, "prompt")

  const prompt = {
    text: implementFixture,
    files: [{ mention: { start: implementFixture.length - 4, end: implementFixture.length, text: "file" } }],
  }
  hooks[0].fn({ prompt })

  assert.match(prompt.text, /Team Mode \(stsTeam plugin\)/)
  assert.ok(!prompt.text.includes("Execute implementation following the task plan"))
  assert.ok(prompt.text.includes("## Mandatory Post-Execution Hooks"))
  assert.ok(prompt.text.includes("## Completion Report"))
  assert.notEqual(prompt.files[0].mention.start, implementFixture.length - 4)
})

test("finds the Spec Kit root from a nested project directory", async () => {
  const { ctx, hooks } = makeContext({ directory: path.join(speckitProjectDir, "sub") })
  await plugin.setup(ctx)

  const prompt = { text: implementFixture }
  hooks[0].fn({ prompt })
  assert.match(prompt.text, /Team Mode \(stsTeam plugin\)/)
})

test("prompt hook does nothing outside Spec Kit projects", async () => {
  const { ctx, hooks } = makeContext({ directory: "/not-a-speckit-project" })
  await plugin.setup(ctx)

  const prompt = { text: implementFixture }
  hooks[0].fn({ prompt })
  assert.equal(prompt.text, implementFixture)
})

test("speckit: false disables the prompt hook", async () => {
  const { ctx, hooks } = makeContext({ options: { speckit: false }, directory: speckitProjectDir })
  await plugin.setup(ctx)
  assert.equal(hooks.length, 0)
})

test("transforms /speckit.implement into a team handoff", () => {
  const result = transformSpeckitPrompt({ text: implementFixture, slots: 4, hasSpecKit: true })

  assert.equal(result.changed, true)
  assert.equal(result.kind, "implement")
  assert.match(result.text, /Team Mode \(stsTeam plugin\)/)
  assert.match(result.text, /Invoke the\s+skill `stsTeamImpl`/)
  assert.ok(!result.text.includes("Execute implementation following the task plan"))
  assert.ok(result.text.includes("before_implement"))
  assert.ok(result.text.includes("## Mandatory Post-Execution Hooks"))
  assert.ok(result.text.includes("## Completion Report"))
})

test("transforms /speckit.tasks by inserting the parallel slicing pass", () => {
  const result = transformSpeckitPrompt({ text: tasksFixture, slots: 2, hasSpecKit: true })

  assert.equal(result.changed, true)
  assert.equal(result.kind, "tasks")
  assert.match(result.text, /Parallel Slicing Pass \(stsTeam plugin\)/)
  assert.match(result.text, /waves for 2 slots/)
  assert.ok(result.text.indexOf("Parallel Slicing Pass") < result.text.indexOf("## Mandatory Post-Execution Hooks"))
  assert.ok(result.text.includes("## Completion Report"))
})

test("switches Spec Kit scripts to .cmd wrappers when requested", () => {
  const implement = transformSpeckitPrompt({
    text: implementFixture,
    slots: 4,
    hasSpecKit: true,
    cmdWrappers: true,
  })
  assert.ok(implement.text.includes("check-prerequisites.cmd"))
  assert.ok(!implement.text.includes("check-prerequisites.ps1"))

  const tasks = transformSpeckitPrompt({ text: tasksFixture, slots: 4, hasSpecKit: true, cmdWrappers: true })
  assert.ok(tasks.text.includes("setup-tasks.cmd"))
  assert.ok(!tasks.text.includes("setup-tasks.ps1"))
})

test("transform is a no-op for unrelated prompts, classic mode and non-Spec Kit projects", () => {
  assert.equal(transformSpeckitPrompt({ text: "hello", slots: 4, hasSpecKit: true }).changed, false)
  assert.equal(transformSpeckitPrompt({ text: implementFixture, slots: 4, hasSpecKit: false }).changed, false)
  assert.equal(
    transformSpeckitPrompt({ text: `${implementFixture}\n--classic\n`, slots: 4, hasSpecKit: true }).changed,
    false,
  )
})

test("warns instead of breaking when the command layout changes", () => {
  const broken = implementFixture.replace("3. Load and analyze the implementation context:", "Load context:")
  const result = transformSpeckitPrompt({ text: broken, slots: 4, hasSpecKit: true })

  assert.equal(result.changed, true)
  assert.equal(result.kind, "implement")
  assert.match(result.text, /could not apply team mode/)
  assert.ok(result.text.includes("Load context:"))
})

test("adjusts mention offsets after a prompt edit", () => {
  const prompt = {
    files: [
      { mention: { start: 10, end: 14, text: "before" } },
      { mention: { start: 110, end: 115, text: "inside" } },
      { mention: { start: 200, end: 204, text: "after" } },
    ],
  }

  adjustMentions(prompt, { changed: true, editStart: 100, editEnd: 120, replacementLength: 5 })

  assert.deepEqual(prompt.files[0].mention, { start: 10, end: 14, text: "before" })
  assert.equal(prompt.files[1].mention, undefined)
  assert.deepEqual(prompt.files[2].mention, { start: 185, end: 189, text: "after" })
})

test("overwrite: false keeps existing skills, agents and commands", async () => {
  const existingSkill = { id: "stsTeamPlan", name: "Custom", description: "custom", path: "/x", content: "custom" }
  const existingAgent = { id: "dev", name: "dev", description: "custom", mode: "subagent", system: "custom" }
  const existingCommand = { name: "stsTeamPlan", description: "custom" }
  const { ctx, skills, agents, commands } = makeContext({
    options: { overwrite: false },
    skills: [existingSkill],
    agents: [existingAgent],
    commands: [existingCommand],
  })
  await plugin.setup(ctx)

  assert.equal(skills.get("stsTeamPlan"), existingSkill)
  assert.equal(agents.get("dev"), existingAgent)
  assert.equal(agents.get("dev").description, "custom")
  assert.equal(commands.get("stsTeamPlan"), existingCommand)
  assert.ok(skills.has("stsTeamImpl"))
  assert.ok(agents.has("qa"))
  assert.ok(commands.has("stsTeamImpl"))
})

test("overwrite: true replaces changed skills and agents", async () => {
  const existingSkill = { id: "stsTeamPlan", name: "Custom", description: "custom", path: "/x", content: "custom" }
  const existingAgent = { id: "dev", name: "dev", description: "custom", mode: "subagent", system: "custom" }
  const { ctx, skills, agents } = makeContext({ skills: [existingSkill], agents: [existingAgent] })
  await plugin.setup(ctx)

  assert.notEqual(skills.get("stsTeamPlan").content, "custom")
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

test("no mentions of the source project, its skill names or .cursor paths", () => {
  const stale = /\b(myimpl|myimpl2|myimpl3|myplan|mymarket)\b|asteroid-defense-game|\.cursor[\\/]/
  const files = [path.join(packageDir, "README.md"), ...walk(skillsDir), ...walk(agentsDir), ...walk(commandsDir)]

  for (const file of files) {
    assert.ok(!stale.test(fs.readFileSync(file, "utf8")), `${file} mentions the source project`)
  }
})
