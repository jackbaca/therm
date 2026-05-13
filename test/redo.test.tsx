// /redo — client-side replay of /undo'd user turns.

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

async function turn(t: Awaited<ReturnType<typeof mount>>, prompt: string, reply: string) {
  await act(async () => { await t.keys.typeText(prompt) })
  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes(prompt))
  act(() => t.gw.push({ type: "message.start" }))
  act(() => t.gw.push({ type: "message.delta", payload: { text: reply } }))
  act(() => t.gw.push({ type: "message.complete",
    payload: { text: reply, usage: { input: 1, output: 1, total: 2 } } }))
  await until(t, () => t.frame().includes(reply))
}

describe("/redo (t_cfbfd0c8)", () => {
  test("/undo captures tail; /redo re-submits the user text", async () => {
    process.env.HERMES_TUI_NO_CONFIRM = "1"
    let hist: Array<{ role: string; text: string }> = []
    const gw = new MockGateway({
      "session.history": () => ({ messages: hist }),
      "commands.catalog": () => ({ pairs: [["/undo", "pop"], ["/redo", "restore"]] }),
    })
    await using t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await turn(t, "first question", "answer one")
    await turn(t, "second question", "answer two")

    // /undo pops the last pair server-side; session.history returns turn 1 only.
    hist = [{ role: "user", text: "first question" }, { role: "assistant", text: "answer one" }]
    await act(async () => { await t.keys.typeText("/undo") })
    act(() => t.keys.pressEnter())
    await until(t, () => !t.frame().includes("second question"))
    expect(gw.last("session.undo")).toBeDefined()

    // /redo re-fires the popped user text via prompt.submit
    await act(async () => { await t.keys.typeText("/redo") })
    act(() => t.keys.pressEnter())
    await until(t, () => gw.last("prompt.submit")?.params.text === "second question")
    expect(t.frame()).toContain("second question")

    // Stack drained — second /redo toasts "nothing to redo"
    // (a fresh send cleared it above).
    await act(async () => { await t.keys.typeText("/redo") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("nothing to redo"))
    delete process.env.HERMES_TUI_NO_CONFIRM
  })

  test("fresh send clears the redo stack", async () => {
    process.env.HERMES_TUI_NO_CONFIRM = "1"
    const gw = new MockGateway({
      "session.history": () => ({ messages: [] }),
      "commands.catalog": () => ({ pairs: [["/undo", "pop"], ["/redo", "restore"]] }),
    })
    await using t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await turn(t, "to be undone", "reply")
    await act(async () => { await t.keys.typeText("/undo") })
    act(() => t.keys.pressEnter())
    await until(t, () => !t.frame().includes("to be undone"))

    // A real send wipes the stack.
    await turn(t, "unrelated", "ok")
    await act(async () => { await t.keys.typeText("/redo") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("nothing to redo"))
    delete process.env.HERMES_TUI_NO_CONFIRM
  })
})
