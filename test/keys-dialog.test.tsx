import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"
import * as prefs from "../src/context/preferences"

describe("/keys rebind dialog", () => {
  test("opens via slash; lists actions; Enter → spec prompt → writes override", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/keys") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Keybindings"))
    const f = t.frame()
    expect(f).toContain("Global")
    expect(f).toContain("Quit")
    expect(f).toMatch(/leader = Ctrl\+X/)

    // Row 0 = app.exit (first global after leader is filtered). Rebind it.
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Rebind app.exit"))
    expect(t.frame()).toContain("┃ ctrl+c")

    // Ctrl+U clear, type new spec, Enter.
    await act(async () => { await t.keys.pressKey("u", { ctrl: true }) })
    for (const c of "ctrl+q") await act(async () => { await t.keys.typeText(c) })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Keybindings"))

    expect(prefs.get("keys")?.["app.exit"]).toBe("ctrl+q")
    // Dialog now shows the new chord + override marker.
    expect(t.frame()).toMatch(/Ctrl\+Q\s+Quit/)
    expect(t.frame()).toContain("· ")
    // hint shows 'r reset' now that an override exists on the selected row
    expect(t.frame()).toContain("r reset")

    // 'r' resets.
    await act(async () => { await t.keys.typeText("r") })
    await t.settle()
    expect(prefs.get("keys")?.["app.exit"]).toBeUndefined()
    t.destroy()
  })

  test("shows ⚠ on a conflicting override", async () => {
    // palette.open → ctrl+c collides with app.exit (same scope, both
    // in the first few rows so visible without scrolling).
    prefs.set("keys", { "palette.open": "ctrl+c" })
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))
    await act(async () => { await t.keys.typeText("/keys") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Keybindings"))

    const f = t.frame()
    const exitRow = f.split("\n").find(l => /Ctrl\+C\s+Quit\b/.test(l))
    const palRow = f.split("\n").find(l => l.includes("Command palette"))
    expect(exitRow).toContain("⚠")
    expect(palRow).toContain("⚠")
    expect(palRow).toContain("· ") // overridden marker
    // Row 0 selected = app.exit → footer shows the conflict detail.
    expect(f).toMatch(/⚠ shares Ctrl\+C with: .*palette\.open/)
    t.destroy()
  })
})
