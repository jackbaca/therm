import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("background/btw completion", () => {
  test("background.complete → transcript marker + toast with view action → alert dialog", async () => {
    const t = await mount({ width: 140, height: 40 })
    await until(t, () => t.frame().includes("Ready"))

    const body = ["summary line", ...Array.from({ length: 5 }, (_, i) => `detail ${i}`)].join("\n")
    act(() => t.gw.push({ type: "background.complete", payload: { task_id: "bg-1", text: body } }))
    await t.settle()

    const f = t.frame()
    expect(f).toContain("◷ background task bg-1 complete — summary line")
    expect(f).toContain("Background task complete")
    expect(f).toContain("view")

    // click the toast action
    const rows = f.split("\n")
    const y = rows.findIndex(l => l.includes("view"))
    const x = rows[y].indexOf("view")
    await act(async () => { await t.mouse.pressDown(x, y) })
    await until(t, () => t.frame().includes("◈ Background task bg-1"))

    const d = t.frame()
    expect(d).toContain("summary line")
    expect(d).toContain("detail 4")
    expect(d).toContain("Esc close · C copy")

    act(() => t.keys.pressEscape())
    await t.settle()
    expect(t.frame()).not.toContain("◈ Background task bg-1")
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

  test("/background register → composer badge; background.complete → unregister", async () => {
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
