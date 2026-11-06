import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import plugin from "../plugin.js"

const packageDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
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

async function apply(cfg, options) {
  const hooks = await plugin({}, options)
  await hooks.config(cfg)
  return cfg
}

test("registers skills path, four agents and four commands", async () => {
  const cfg = await apply({})

  assert.deepEqual(cfg.skills, { paths: [skillsDir] })

  assert.deepEqual(Object.keys(cfg.agent).sort(), ["analyst", "dev", "lead", "qa"])
  for (const [name, agent] of Object.entries(cfg.agent)) {
    assert.equal(agent.name, name)
    assert.equal(agent.mode, "subagent")
    assert.ok(agent.description, `${name} has a description`)
    assert.ok(agent.prompt.length > 200, `${name} has a full prompt`)
  }

  assert.deepEqual(Object.keys(cfg.command).sort(), ["multi-impl", "multi-impl-v3", "multi-impl2", "multi-plan"])
  assert.match(cfg.command["multi-plan"].template, /\$ARGUMENTS/)
  assert.match(cfg.command["multi-plan"].template, /multi-plan/)
  assert.match(cfg.command["multi-impl2"].template, /multi-impl2/)
})

test("keeps descriptions with a colon and resolves {{PACKAGE_DIR}}", async () => {
  const cfg = await apply({})

  assert.match(cfg.agent.dev.description, /Разработчик стори: пишет код/)
  const template = skillsDir.replaceAll("\\", "/") + "/multi-plan/story-template.md"
  assert.ok(cfg.agent.analyst.prompt.includes(template))
  assert.ok(!cfg.agent.analyst.prompt.includes("{{PACKAGE_DIR}}"))
})

test("keeps existing skills paths and is idempotent", async () => {
  const hooks = await plugin({}, {})
  const cfg = { skills: { paths: ["/other"] } }
  await hooks.config(cfg)
  await hooks.config(cfg)

  assert.deepEqual(cfg.skills.paths, ["/other", skillsDir])
})

test("supports the v2 skills array shape", async () => {
  const cfg = await apply({ skills: ["/other"] })

  assert.deepEqual(cfg.skills, ["/other", skillsDir])
})

test("options disable parts of the registration", async () => {
  const cfg = await apply({}, { skills: false, commands: false })

  assert.equal(cfg.skills, undefined)
  assert.equal(cfg.command, undefined)
  assert.ok(cfg.agent.lead)
})

test("overwrite: false leaves project agents and commands alone", async () => {
  const existing = { agent: { dev: { description: "custom" } }, command: { "multi-plan": { template: "custom" } } }
  const cfg = await apply(existing, { overwrite: false })

  assert.deepEqual(cfg.agent.dev, { description: "custom" })
  assert.deepEqual(cfg.command["multi-plan"], { template: "custom" })
  assert.ok(cfg.agent.qa)
})

test("overwrite: true replaces project agents and commands", async () => {
  const existing = { agent: { dev: { description: "custom" } }, command: { "multi-plan": { template: "custom" } } }
  const cfg = await apply(existing, {})

  assert.notEqual(cfg.agent.dev.description, "custom")
  assert.notEqual(cfg.command["multi-plan"].template, "custom")
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

test("no stale skill names from the source project", () => {
  const stale = /\b(myimpl|myimpl2|myimpl3|myplan|mymarket)\b/

  for (const dir of [skillsDir, agentsDir, commandsDir]) {
    for (const file of walk(dir)) {
      assert.ok(!stale.test(fs.readFileSync(file, "utf8")), `${file} mentions a source-project skill name`)
    }
  }
})
