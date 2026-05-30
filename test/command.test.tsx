import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mount, mountNode, until } from "./harness"
import { useCommand } from "../src/ui/command"
import { useEffect } from "react"

describe("Command palette", () => {
  test("Ctrl+K opens; rows show resolved chord hint from catalog", async () => {
    const t = await mount({ width: 140, height: 40 })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.keys.pressKey("k", { ctrl: true }))
    await until(t, () => t.frame().includes("Command Palette"))

    const f = t.frame()
    // action-backed entries show keys.print(action) right-aligned
    const help = f.split("\n").find(l => l.includes("Help"))!
    expect(help).toContain("F1")
    const theme = f.split("\n").find(l => l.includes("Switch Theme"))!
    expect(theme).toContain("Ctrl+X T")
    // description-only entries have no hint
    const logs = f.split("\n").find(l => l.includes("Gateway Logs"))!
    expect(logs).not.toMatch(/Ctrl|F\d/)
    t.destroy()
  })

  test("action chord dispatches registered command without opening palette", async () => {
    const fired: string[] = []
    const Reg = () => {
      const cmd = useCommand()
      useEffect(() => cmd.register([
        { title: "Status", value: "status", action: "status.open", onSelect: () => fired.push("status") },
        { title: "Themes", value: "theme", action: "theme.pick", onSelect: () => fired.push("theme") },
      ]), [cmd])
      return <box><text>reg</text></box>
    }
    const t = await mountNode(<Reg />)
    await until(t, () => t.frame().includes("reg"))

    // <leader>i → status.open
    act(() => t.keys.pressKey("x", { ctrl: true }))
    await t.settle()
    await act(async () => { await t.keys.typeText("i") })
    await t.settle()
    expect(fired).toEqual(["status"])

    // <leader>t → theme.pick
    act(() => t.keys.pressKey("x", { ctrl: true }))
    await t.settle()
    await act(async () => { await t.keys.typeText("t") })
    await t.settle()
    expect(fired).toEqual(["status", "theme"])
    t.destroy()
  })

  test("F1 opens HelpDialog via command registry (e2e through app)", async () => {
    const t = await mount({ width: 140, height: 40 })
    await until(t, () => t.frame().includes("Ready"))

    act(() => t.keys.pressKey("F1"))
    await until(t, () => t.frame().includes("Keyboard Shortcuts"))
    expect(t.frame()).toContain("leader = Ctrl+X")

    act(() => t.keys.pressEscape())
    await until(t, () => !t.frame().includes("Keyboard Shortcuts"))
    t.destroy()
  })
})
