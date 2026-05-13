import { describe, expect, test } from "bun:test"
import { isDangerous } from "../src/app/control"
import { TABS } from "../src/app/tabs"

const idx = (name: string) => TABS.findIndex(t => t.name === name)

describe("control.isDangerous — guards the intended tabs by name, not hardcoded index", () => {
  test("Chat: Enter guarded (regression — was drifted to Context's index)", () => {
    expect(isDangerous(idx("Chat"), "return", false)).toBe(true)
  })

  test("Sessions: d/delete/Enter guarded (session switch/delete via Sessions sub-tab)", () => {
    expect(isDangerous(idx("Sessions"), "d", false)).toBe(true)
    expect(isDangerous(idx("Sessions"), "delete", false)).toBe(true)
    expect(isDangerous(idx("Sessions"), "return", false)).toBe(true)
  })

  test("Config group: Config-sub toggles + Env-sub deletions + Ctrl+S guarded (union across sub-tabs)", () => {
    const c = idx("Config")
    expect(isDangerous(c, "space", false)).toBe(true)
    expect(isDangerous(c, "return", false)).toBe(true)
    expect(isDangerous(c, "h", false)).toBe(true)
    expect(isDangerous(c, "l", false)).toBe(true)
    expect(isDangerous(c, "[", false)).toBe(true)
    expect(isDangerous(c, "]", false)).toBe(true)
    expect(isDangerous(c, "d", false)).toBe(true)
    expect(isDangerous(c, "delete", false)).toBe(true)
    expect(isDangerous(c, "s", true)).toBe(true)
    expect(isDangerous(c, "s", false)).toBe(false)  // bare 's' fine
  })

  test("Profiles & Automation group: return/space/d/delete/k guarded (profile/cron/kanban mutations)", () => {
    const p = idx("Profiles & Automation")
    expect(isDangerous(p, "return", false)).toBe(true)
    expect(isDangerous(p, "space", false)).toBe(true)
    expect(isDangerous(p, "d", false)).toBe(true)
    expect(isDangerous(p, "delete", false)).toBe(true)
    expect(isDangerous(p, "k", false)).toBe(true)
  })

  test("Unknown tab index returns false (no crash)", () => {
    expect(isDangerous(99, "return", false)).toBe(false)
    expect(isDangerous(-1, "return", false)).toBe(false)
  })
})
