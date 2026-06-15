import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

function info() {
  return { model: "test-model", session_id: "test-sid", tools: {}, skills: {} }
}

describe("queued prompt submit", () => {
  test("interrupt-mode queue waits for session.info before draining", async () => {
    const gw = new MockGateway({
      "config.get": p => p.key === "busy" ? { value: "interrupt" } : {},
      "session.interrupt": () => ({ status: "interrupted" }),
      "prompt.submit": () => ({ status: "streaming" }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    act(() => gw.push({ type: "message.start" }))
    await until(t, () => t.frame().includes("Type to queue"))

    await act(async () => { await t.keys.typeText("stop l4") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("stop l4"))

    expect(gw.calls.filter(c => c.method === "session.interrupt")).toHaveLength(1)

    act(() => gw.push({ type: "message.complete", payload: { status: "interrupted", text: "" } }))
    await t.settle()
    expect(gw.calls.filter(c => c.method === "prompt.submit")).toHaveLength(0)

    act(() => gw.push({ type: "session.info", payload: info() }))
    await until(t, () => gw.calls.filter(c => c.method === "prompt.submit").length === 1)

    expect(gw.last("prompt.submit")?.params).toMatchObject({
      session_id: "test-sid",
      text: "stop l4",
    })
    t.destroy()
  })

  test("session-busy submit rejection requeues and retries", async () => {
    let tries = 0
    const gw = new MockGateway({
      "config.get": p => p.key === "busy" ? { value: "interrupt" } : {},
      "session.interrupt": () => ({ status: "interrupted" }),
      "prompt.submit": () => {
        tries += 1
        if (tries === 1) throw new Error("session busy")
        return { status: "streaming" }
      },
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    act(() => gw.push({ type: "message.start" }))
    await until(t, () => t.frame().includes("Type to queue"))
    await act(async () => { await t.keys.typeText("retry after settle") })
    act(() => t.keys.pressEnter())

    act(() => gw.push({ type: "message.complete", payload: { status: "interrupted", text: "" } }))
    await t.settle()
    expect(gw.calls.filter(c => c.method === "prompt.submit")).toHaveLength(0)

    act(() => gw.push({ type: "session.info", payload: info() }))
    await until(t, () => gw.calls.filter(c => c.method === "prompt.submit").length === 2, 2500)

    expect(tries).toBe(2)
    expect(gw.last("prompt.submit")?.params.text).toBe("retry after settle")
    expect(t.frame()).toContain("retry after settle")
    t.destroy()
  })
})
