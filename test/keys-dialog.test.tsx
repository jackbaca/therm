import { afterEach, describe, test, expect } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"
import * as prefs from "../src/context/preferences"

describe("/keys rebind dialog", () => {
  afterEach(() => prefs.reset())

  test("writes and resets an override", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/keys") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Keybindings"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Rebind app.exit"))

    // Ctrl+U clear, type new spec, Enter.
    await act(async () => { await t.keys.pressKey("u", { ctrl: true }) })
    for (const c of "ctrl+q") await act(async () => { await t.keys.typeText(c) })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Keybindings"))

    expect(prefs.get("keys")?.["app.exit"]).toBe("ctrl+q")
    await act(async () => { await t.keys.typeText("r") })
    await t.settle()
    expect(prefs.get("keys")?.["app.exit"]).toBeUndefined()
    t.destroy()
  })

})
