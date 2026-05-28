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
})
