import { describe, test, expect, beforeEach } from "bun:test"
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { hermesPath } from "../src/service/hermes-home"
import { skills } from "../src/service/bundled-skills"

// HERMES_HOME is a fresh tmpdir via test/preload.ts, so ~/.hermes/skills
// is empty on entry. assets/skills/ resolves to the repo copy via the
// same walk-up locate() that bundled.ts uses.

const ROOT = hermesPath("skills")

describe("bundled-skills", () => {
  beforeEach(() => rmSync(ROOT, { recursive: true, force: true }))

  test("sync() installs eikon + eikon-create under creative/", () => {
    const got = skills.sync().sort()
    expect(got).toEqual(["eikon", "eikon-create"])
    expect(existsSync(join(ROOT, "creative/eikon/SKILL.md"))).toBe(true)
    expect(existsSync(join(ROOT, "creative/eikon-create/SKILL.md"))).toBe(true)
    // Idempotent.
    expect(skills.sync()).toEqual([])
  })

  test("sync() skips a skill the user already has, in any category", () => {
    mkdirSync(join(ROOT, "my-stuff/eikon"), { recursive: true })
    writeFileSync(join(ROOT, "my-stuff/eikon/SKILL.md"), "---\nname: eikon\n---\n")
    const got = skills.sync()
    expect(got).toEqual(["eikon-create"])
    // Did not stomp the user's copy.
    expect(existsSync(join(ROOT, "creative/eikon/SKILL.md"))).toBe(false)
  })

  test("sync() skips when present at skills/ root (uncategorized)", () => {
    mkdirSync(join(ROOT, "eikon-create"), { recursive: true })
    writeFileSync(join(ROOT, "eikon-create/SKILL.md"), "x")
    expect(skills.sync()).toEqual(["eikon"])
  })
})
