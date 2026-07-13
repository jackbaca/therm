import { describe, test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OC_TO_HERM, loadOcKeybinds } from "../src/keys/oc-compat"
import { DEFAULTS } from "../src/keys/catalog"
import { parse } from "../src/keys/chord"

describe("keys/oc-compat", () => {
  test("every mapped target is a real ActionId; no duplicates", () => {
    const targets = OC_TO_HERM.map(([, h]) => h)
    for (const id of targets) expect(id in DEFAULTS).toBe(true)
    expect(new Set(targets).size).toBe(targets.length)
    expect(new Set(OC_TO_HERM.map(([oc]) => oc)).size).toBe(OC_TO_HERM.length)
  })

  test("pinned tui.json layers import mapped keys and preserve none", () => {
    const cwd = mkdtempSync(join(tmpdir(), "herm-oc-"))
    const home = mkdtempSync(join(tmpdir(), "herm-oc-home-"))
    const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/opencode", name))
    writeFileSync(join(cwd, "tui.json"), fixture("tui-base.json"))
    mkdirSync(join(cwd, ".opencode"), { recursive: true })
    writeFileSync(join(cwd, ".opencode", "tui.json"), fixture("tui-project.json"))

    const r = loadOcKeybinds(cwd, home)
    expect(r.sources).toHaveLength(2)
    expect(r.overrides.leader).toBe("ctrl+space")
    expect(r.overrides["palette.open"]).toBe("ctrl+shift+p")
    expect(r.overrides["session.compress"]).toBe("none")
    expect(parse(r.overrides["session.compress"]!)).toEqual([])
    expect(r.skipped.sort()).toEqual(["agent_cycle", "input_word_forward"])
    for (const v of Object.values(r.overrides))
      expect(() => parse(v!)).not.toThrow()
    rmSync(cwd, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test("no files → empty result", () => {
    const cwd = mkdtempSync(join(tmpdir(), "herm-oc-empty-"))
    const home = mkdtempSync(join(tmpdir(), "herm-oc-home-empty-"))
    const r = loadOcKeybinds(cwd, home)
    expect(r.sources).toHaveLength(0)
    expect(Object.keys(r.overrides)).toHaveLength(0)
    expect(r.skipped).toHaveLength(0)
    rmSync(cwd, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })
})
