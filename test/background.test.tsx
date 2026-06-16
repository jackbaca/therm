import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("background/btw completion", () => {
  test("background.complete → stock TUI transcript line", async () => {
    const t = await mount({ width: 140, height: 40 })
    await until(t, () => t.frame().includes("Ready"))

    const body = ["summary line", ...Array.from({ length: 5 }, (_, i) => `detail ${i}`)].join("\n")
    act(() => t.gw.push({ type: "background.complete", payload: { task_id: "bg-1", text: body } }))
    await t.settle()

    const f = t.frame()
    expect(f).toContain("[bg bg-1] summary line")
    expect(f).toContain("detail 4")
    expect(f).not.toContain("Background task complete")
    expect(f).not.toContain("view")
    t.destroy()
  })

  test("btw.complete → transcript marker + toast", async () => {
    const t = await mount()
    await until(t, () => t.frame().includes("Ready"))
    act(() => t.gw.push({ type: "btw.complete", payload: { text: "side answer here" } }))
    await t.settle()
    expect(t.frame()).toContain("◈ btw — side answer here")
    expect(t.frame()).toContain("btw")
    t.destroy()
  })

  test("/background register → stock TUI start line + composer badge; completion unregisters", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/background", "run in background"]] }),
      "prompt.background": () => ({ task_id: "bg-42" }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    expect(t.frame()).not.toContain("▶ 1")

    await act(async () => { await t.keys.typeText("/background do the thing") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("▶ 1"))
    expect(t.frame()).toContain("bg bg-42 started")
    expect(t.gw.last("prompt.background")?.params).toMatchObject({ session_id: "test-sid", text: "do the thing" })

    act(() => t.gw.push({ type: "background.complete", payload: { task_id: "bg-42", text: "done" } }))
    await until(t, () => !t.frame().includes("▶ 1"))
    t.destroy()
  })

  test("/background with no task_id in response does not register", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/background", "run in background"]] }),
      "prompt.background": () => ({}),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/background oops") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("background start failed"))
    expect(t.frame()).not.toContain("▶ 1")
    t.destroy()
  })
})
