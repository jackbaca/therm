import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("live session event routing", () => {
  test("ignores sibling session stream events after activating another session", async () => {
    const gw = new MockGateway({
      "session.resume": p => ({
        session_id: p.session_id,
        messages: p.session_id === "sid-b"
          ? [{ role: "user", content: "Question B", timestamp: 1 }]
          : [],
      }),
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "sid-b", splash: false } })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => {
      t.gw.push({ type: "message.start", session_id: "sid-b" })
      t.gw.push({ type: "message.delta", session_id: "sid-b", payload: { text: "B is streaming" } })
      t.gw.push({ type: "message.start", session_id: "sid-a" })
      t.gw.push({ type: "message.delta", session_id: "sid-a", payload: { text: "LATE_FROM_A" } })
      t.gw.push({ type: "status.update", session_id: "sid-a", payload: { text: "A is still running", kind: "lifecycle" } })
      t.gw.push({ type: "message.complete", session_id: "sid-a", payload: { text: "DONE_A" } })
    })
    await until(t, () => t.frame().includes("B is streaming"))

    expect(t.frame()).not.toContain("LATE_FROM_A")
    expect(t.frame()).not.toContain("DONE_A")
    expect(t.frame()).not.toContain("A is still running")
    expect(t.frame()).not.toContain("Ready")
    t.destroy()
  })

  test("ignores sibling process notifications while stream events stay scoped", async () => {
    const gw = new MockGateway({
      "session.resume": p => ({ session_id: p.session_id, messages: [] }),
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "sid-b", splash: false } })
    await until(t, () => t.frame().includes("Ready"))

    act(() => {
      t.gw.push({ type: "message.start", session_id: "sid-b" })
      t.gw.push({ type: "message.delta", session_id: "sid-b", payload: { text: "B is streaming" } })
      t.gw.push({
        type: "status.update",
        session_id: "sid-a",
        payload: {
          kind: "process",
          text: "Background process proc_watch completed (exit code 0).\nCommand: watch-kanban",
        },
      })
    })
    await until(t, () => t.frame().includes("B is streaming"))

    expect(t.frame()).not.toContain("proc_watch")
    expect(t.frame()).not.toContain("watch-kanban")
    t.destroy()
  })

  test("sibling background completion clears badge without writing into active transcript", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/background", "run in background"]] }),
      "prompt.background": () => ({ task_id: "bg-42" }),
      "session.resume": p => ({ session_id: p.session_id, messages: [] }),
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "sid-b", splash: false } })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/background do the thing") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("▶ 1"))

    act(() => t.gw.push({
      type: "background.complete",
      session_id: "sid-a",
      payload: { task_id: "bg-42", text: "done elsewhere" },
    }))
    await until(t, () => !t.frame().includes("▶ 1"))

    expect(t.frame()).not.toContain("done elsewhere")
    t.destroy()
  })
})
