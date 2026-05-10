// Regression: /new and session-switch must finalize the outgoing
// gateway session via session.close. Without it the gateway leaks one
// slash_worker subprocess + one live AIAgent per hop and leaves the
// DB row's `ended_at IS NULL`, which breaks lineage classification
// (sessions-db.ts SUB/CONT predicates) until quit. Parity with Ink
// TUI's useSessionLifecycle.closeSession.

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("session.close", () => {
  test("/new closes the outgoing session", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/new", "new session"]] }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    // Boot path created (or resumed) → sid is test-sid.
    expect(t.gw.last("session.close")).toBeUndefined()

    await act(async () => { await t.keys.typeText("/new now") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.close") !== undefined)

    expect(t.gw.last("session.close")?.params.session_id).toBe("test-sid")
    expect(t.gw.last("session.create")).toBeDefined()

    t.destroy()
  })

  test("switchSession closes prev after resume succeeds", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/resume", "resume session"]] }),
      "session.resume": p => ({ session_id: p.session_id, messages: [] }),
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "first", splash: false } })
    await until(t, () => t.frame().includes("Ready"))

    // Boot resumed "first"; no close yet.
    expect(t.gw.last("session.close")).toBeUndefined()

    // Switch via /resume <sid> — routes through switchSession.
    await act(async () => { await t.keys.typeText("/resume second") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.close") !== undefined)

    expect(t.gw.last("session.close")?.params.session_id).toBe("first")
    // Resume landed on the target — close ran only after that.
    const ri = gw.calls.findIndex(c => c.method === "session.resume" && c.params.session_id === "second")
    const ci = gw.calls.findIndex(c => c.method === "session.close")
    expect(ri).toBeGreaterThan(-1)
    expect(ci).toBeGreaterThan(ri)

    t.destroy()
  })

  test("switchSession keeps prev live when resume fails", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/resume", "resume session"]] }),
      "session.resume": p => {
        if (p.session_id === "bad") throw new Error("nope")
        return { session_id: p.session_id, messages: [] }
      },
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "first", splash: false } })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/resume bad") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Failed to resume"))

    // No close — user is still on "first", which must stay live.
    expect(t.gw.last("session.close")).toBeUndefined()

    t.destroy()
  })

  test("switchSession to self does not close", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/resume", "resume session"]] }),
      "session.resume": p => ({ session_id: p.session_id, messages: [] }),
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "same", splash: false } })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/resume same") })
    act(() => t.keys.pressEnter())
    // Wait for the second resume (first was boot) to land.
    await until(t, () => gw.calls.filter(c => c.method === "session.resume").length >= 2)

    expect(t.gw.last("session.close")).toBeUndefined()

    t.destroy()
  })
})
