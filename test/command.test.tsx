import { describe, test, expect } from "bun:test"
import { act, useEffect, useState } from "react"
import { mount, mountNode, until } from "./harness"
import { useCommand } from "../src/ui/command"

const status = async (t: Awaited<ReturnType<typeof mountNode>>) => {
  act(() => t.keys.pressKey("x", { ctrl: true }))
  await t.settle()
  await act(async () => { await t.keys.typeText("i") })
  await t.settle()
}

describe("Command palette", () => {
  test("shell shortcut opens and Escape closes the palette", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))
    act(() => t.keys.pressKey("k", { ctrl: true }))
    await until(t, () => t.frame().includes("Command Palette"))
    act(() => t.keys.pressEscape())
    await until(t, () => !t.frame().includes("Command Palette"))
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

  test("unsubscribe removes a command from action dispatch", async () => {
    const fired: string[] = []
    let off = () => {}
    const Reg = () => {
      const cmd = useCommand()
      useEffect(() => {
        off = cmd.register([{
          title: "Transient", value: "transient", action: "status.open",
          onSelect: () => fired.push("transient"),
        }])
        return () => off()
      }, [cmd])
      return <text>registered</text>
    }
    const t = await mountNode(<Reg />)
    await until(t, () => t.frame().includes("registered"))

    await status(t)
    expect(fired).toEqual(["transient"])
    off()
    await status(t)
    expect(fired).toEqual(["transient"])
    t.destroy()
  })

  test("finite registration churn leaves only the latest action", async () => {
    const fired: number[] = []
    const Churn = () => {
      const cmd = useCommand()
      const [n, setN] = useState(0)
      useEffect(() => cmd.register([{
        title: `Status ${n}`, value: `status-${n}`, action: "status.open",
        onSelect: () => fired.push(n),
      }]), [cmd, n])
      useEffect(() => { if (n < 8) queueMicrotask(() => setN(n + 1)) }, [n])
      return <text>{String(n)}</text>
    }
    const t = await mountNode(<Churn />)
    await until(t, () => t.frame().trim() === "8")

    await status(t)
    expect(fired).toEqual([8])
    t.destroy()
  })

})
