// Memory tab — providers list, builtin capacity bars, activity feed.

import { describe, test, expect, beforeEach } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync } from "fs"
import { mountNode, until, MockGateway } from "./harness"
import { Memory } from "../src/tabs/Memory"
import { hermesPath } from "../src/service/hermes-home"
import { home } from "../src/home"

describe("Memory tab (t_cfbfd0c8)", () => {
  beforeEach(() => {
    home.close()
    mkdirSync(hermesPath("memories"), { recursive: true })
    mkdirSync(hermesPath("hermes-agent/plugins/memory/mem0"), { recursive: true })
    writeFileSync(hermesPath("config.yaml"),
      "memory:\n  provider: mem0\n  memory_char_limit: 2200\n  user_char_limit: 1375\n  memory_enabled: true\n  user_profile_enabled: true\n  nudge_interval: 5\n  flush_min_turns: 3\n")
    writeFileSync(hermesPath("memories/MEMORY.md"), "one\n§\ntwo\n§\nthree\n")
    writeFileSync(hermesPath("memories/USER.md"), "Name: Kaio\n")
  })

  test("renders builtin + discovered providers; active dot; capacity bars", async () => {
    await using t = await mountNode(<Memory focused />,
      { gw: new MockGateway(), width: 140, height: 40 })
    await until(t, () => t.frame().includes("builtin"))
    await until(t, () => t.frame().includes("mem0"))

    const f = t.frame()
    // builtin is always active (●), mem0 is the config.provider → active too
    expect(f).toMatch(/●\s+builtin/)
    expect(f).toMatch(/●\s+mem0/)
    // builtin detail: capacity bars with entry counts
    expect(f).toContain("Notes (MEMORY.md)")
    expect(f).toContain("3 entries")
    expect(f).toContain("Profile (USER.md)")
    // hint bar
    expect(f).toContain("activate")
  })

  test("↓ selects mem0; space → confirm dialog → writeConfig via cli.exec", async () => {
    const gw = new MockGateway()
    await using t = await mountNode(<Memory focused />, { gw, width: 140, height: 40 })
    await until(t, () => t.frame().includes("mem0"))

    act(() => t.keys.pressArrow("down"))
    await until(t, () => t.frame().includes("Nudge"))
    // detail pane switched to mem0: shows Agent Settings block
    expect(t.frame()).toContain("every 5 turns")

    // space → toggle (deactivate, since mem0 is active)
    act(() => t.keys.pressKey(" "))
    await until(t, () => t.frame().includes("Deactivate memory provider?"))
    act(() => t.keys.pressKey("y"))
    await until(t, () => gw.last("cli.exec") !== undefined)
    // writeConfig routes memory.provider via cli lane
    const c = gw.last("cli.exec")
    expect(JSON.stringify(c?.params)).toContain("memory.provider")
  })
})
