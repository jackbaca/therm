import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { Cron } from "../src/tabs/Cron"
import * as prefs from "../src/context/preferences"
import { handleListKey, useKeys, type Keys } from "../src/keys"
import { useKeyboard } from "@opentui/react"

const JOBS = [
  { job_id: "j1", name: "alpha", schedule: "every 1h", enabled: true },
  { job_id: "j2", name: "beta", schedule: "every 1h", enabled: true },
]

describe("useListKeys / handleListKey", () => {
  test("nav primitives: ↓/End clamp, PgDn strides, scrollTo callback fires", async () => {
    let sel = 0, scrolled = -1
    const setSel = (fn: number | ((p: number) => number)) => {
      sel = typeof fn === "function" ? fn(sel) : fn
    }
    const fired: string[] = []
    const Probe = () => {
      const keys = useKeys()
      useKeyboard(key => {
        handleListKey(keys, key, {
          count: 5, setSel, page: 3,
          scrollTo: n => { scrolled = n },
          onActivate: () => fired.push("activate"),
          onNew: () => fired.push("new"),
        })
      })
      return <box><text>probe</text></box>
    }
    const t = await mountNode(<Probe />)
    await until(t, () => t.frame().includes("probe"))

    act(() => t.keys.pressArrow("down"))
    expect(sel).toBe(1)
    expect(scrolled).toBe(1)
    act(() => t.keys.pressKey("END"))
    expect(sel).toBe(4)
    act(() => t.keys.pressKey("HOME"))
    expect(sel).toBe(0)
    act(() => t.keys.pressKey("\x1B[57355u")) // kitty pagedown
    expect(sel).toBe(3)
    act(() => t.keys.pressEnter())
    expect(fired).toEqual(["activate"])
    await act(async () => { await t.keys.typeText("n") })
    expect(fired).toEqual(["activate", "new"])
    // Absent handler → not consumed, no throw.
    await act(async () => { await t.keys.typeText("d") })
    expect(fired).toEqual(["activate", "new"])
    t.destroy()
  })

  test("leader-armed bare letter does NOT match list.* (leader=false chords)", async () => {
    const fired: string[] = []
    let k!: Keys
    const Probe = () => {
      const keys = useKeys()
      k = keys
      useKeyboard(key => {
        if (handleListKey(keys, key, {
          count: 1, setSel: () => {},
          onNew: () => fired.push("list.new"),
        })) return
        if (keys.match("session.new", key)) fired.push("session.new")
      })
      return <box><text>probe</text></box>
    }
    const t = await mountNode(<Probe />)
    await until(t, () => t.frame().includes("probe"))

    act(() => t.keys.pressKey("x", { ctrl: true }))
    await t.settle()
    expect(k.leader).toBe(true)
    await act(async () => { await t.keys.typeText("n") })
    await t.settle()
    // list.new (bare 'n') must NOT fire under leader; session.new does.
    expect(fired).toEqual(["session.new"])
    t.destroy()
  })

  test("tabs honor list.* rebind via preferences", async () => {
    prefs.set("keys", { "list.delete": "x", "list.refresh": "none" })
    let deleted = ""
    const gw = new MockGateway({
      "cron.manage": p => {
        if (p.action === "list") return { jobs: JOBS }
        if (p.action === "remove") { deleted = p.name as string; return { ok: true } }
        return { ok: true }
      },
    })
    const t = await mountNode(<Cron focused />, { gw })
    await until(t, () => t.frame().includes("Cron Jobs (2)"))

    // Hint reflects rebind + suppressed refresh.
    expect(t.frame()).toContain("[X] delete")
    expect(t.frame()).not.toMatch(/\[R\] refresh/)

    // 'd' no longer deletes.
    await act(async () => { await t.keys.typeText("d") })
    await t.settle()
    expect(t.frame()).not.toContain("Delete Job?")

    // 'x' does.
    await act(async () => { await t.keys.typeText("x") })
    await until(t, () => t.frame().includes("Delete Job?"))
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => deleted === "j1")

    // 'r' disabled → no extra list call.
    const before = gw.calls.filter(c => c.params.action === "list").length
    await act(async () => { await t.keys.typeText("r") })
    await t.settle()
    expect(gw.calls.filter(c => c.params.action === "list").length).toBe(before)
    t.destroy()
  })
})
