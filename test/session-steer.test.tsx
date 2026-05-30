import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("session steer", () => {
  test("leader steer opens a text prompt and submits guidance through session.steer", async () => {
    const gw = new MockGateway({
      "session.steer": p => ({ status: "queued", text: p.text }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    act(() => { t.keys.pressKey("x", { ctrl: true }) })
    await t.settle()
    act(() => { t.keys.pressKey("s") })
    await until(t, () => t.frame().includes("Steer active turn"))
    await act(async () => { await t.keys.typeText("use the cache") })
    act(() => { t.keys.pressEnter() })
    await until(t, () => gw.last("session.steer")?.params.text === "use the cache")

    expect(t.gw.last("prompt.submit")).toBeUndefined()
    expect(t.frame()).toContain("Queued")
    expect(t.frame()).toContain("Message Hermes")

    t.destroy()
  })

  test("steer prompt ignores empty input and Escape cancels without side effects", async () => {
    const gw = new MockGateway({
      "session.steer": p => ({ status: "queued", text: p.text }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    act(() => { t.keys.pressKey("x", { ctrl: true }) })
    await t.settle()
    act(() => { t.keys.pressKey("s") })
    await until(t, () => t.frame().includes("Steer active turn"))
    await act(async () => { await t.keys.typeText("   ") })
    act(() => { t.keys.pressEnter() })
    await t.settle()
    expect(gw.last("session.steer")).toBeUndefined()
    expect(t.frame()).toContain("Steer active turn")

    act(() => { t.keys.pressEscape() })
    await until(t, () => !t.frame().includes("Steer active turn"))

    expect(gw.last("session.steer")).toBeUndefined()
    expect(t.gw.last("prompt.submit")).toBeUndefined()

    t.destroy()
  })

  test("composer steer chip advertises the leader chord", async () => {
    const gw = new MockGateway({
      "session.steer": p => ({ status: "queued", text: p.text }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("steer Ctrl+X S"))

    expect(t.frame()).toContain("◇ steer Ctrl+X S")
    t.destroy()
  })

  test("busy steer preserves text when gateway does not queue it", async () => {
    const gw = new MockGateway({
      "config.get": p => p.key === "busy" ? { value: "steer" } : {},
      "session.steer": () => ({ status: "rejected" }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("first") })
    act(() => t.keys.pressEnter())
    await t.settle()
    act(() => t.gw.push({ type: "message.start" }))
    await until(t, () => t.frame().includes("Type to queue"))
    await act(async () => { await t.keys.typeText("keep this") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("⏸ 1. keep this"))

    expect(gw.last("session.steer")?.params.text).toBe("keep this")
    expect(t.frame()).toContain("steer rejected — queued for next turn")
    t.destroy()
  })

  test("busy steer preserves text when gateway call fails", async () => {
    const gw = new MockGateway({
      "config.get": p => p.key === "busy" ? { value: "steer" } : {},
      "session.steer": () => { throw new Error("offline") },
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("first") })
    act(() => t.keys.pressEnter())
    await t.settle()
    act(() => t.gw.push({ type: "message.start" }))
    await until(t, () => t.frame().includes("Type to queue"))
    await act(async () => { await t.keys.typeText("still keep this") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("⏸ 1. still keep this"))

    expect(gw.last("session.steer")?.params.text).toBe("still keep this")
    t.destroy()
  })
})
