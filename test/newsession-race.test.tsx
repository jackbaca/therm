// Regression: /new must clear the gateway's active sid before
// session.create lands. Without the reset, events arriving in the
// window between reset() and the new setSession(id) get auto-attributed
// to the outgoing session (stale-sid race). Mirrors switchProfile,
// which already clears via gw.setSession("") before respawn.

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"

describe("newSession stale-sid reset", () => {
  test("/new clears gateway sid so session.create does not auto-inject the outgoing id", async () => {
    let n = 0
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/new", "new session"]] }),
      "session.create": () => ({ session_id: `sid-${++n}` }),
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    // Boot established sid-1 via session.create.
    expect(gw.calls.find(c => c.method === "session.create")?.params.session_id).toBeUndefined()

    await act(async () => { await t.keys.typeText("/new now") })
    act(() => t.keys.pressEnter())
    await until(t, () => gw.calls.filter(c => c.method === "session.create").length >= 2)

    // The second session.create (from /new) must NOT carry the outgoing
    // sid. If the reset is missing, gateway-client's auto-injection
    // will have stamped session_id: "sid-1" onto the merged params.
    const creates = gw.calls.filter(c => c.method === "session.create")
    expect(creates.length).toBe(2)
    expect(creates[1]?.params.session_id).toBeUndefined()

    // session.close still finalizes the outgoing session — it passes
    // prev explicitly, so the gateway-level sid clear doesn't affect it.
    await until(t, () => gw.last("session.close") !== undefined)
    expect(gw.last("session.close")?.params.session_id).toBe("sid-1")
    await until(t, () => t.frame().includes("Ready"))

    t.destroy()
  })

  test("failed /new keeps the outgoing session active and visible", async () => {
    const gw = new MockGateway({
      "commands.catalog": () => ({ pairs: [["/new", "new session"]] }),
      "session.resume": p => ({ session_id: p.session_id, messages: [] }),
      "session.create": () => { throw new Error("create exploded") },
    })
    const t = await mount({ gw, launch: { mode: "resume", sid: "old-sid", splash: false } })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new now") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("create exploded"))

    expect(gw.last("session.close")).toBeUndefined()
    const creates = gw.calls.filter(c => c.method === "session.create")
    expect(creates.at(-1)?.params.session_id).toBeUndefined()
    await act(async () => { await t.keys.typeText("still here") })
    act(() => t.keys.pressEnter())
    await until(t, () => gw.last("prompt.submit")?.params.text === "still here")
    expect(gw.last("prompt.submit")?.params.session_id).toBe("old-sid")
    t.destroy()
  })

  test("initial session boot failure surfaces the gateway error", async () => {
    const gw = new MockGateway({
      "session.create": () => { throw new Error("boot exploded") },
    })
    const t = await mount({ gw, launch: { mode: "new", splash: false } })
    await until(t, () => t.frame().includes("Failed to start session: boot exploded"))
    expect(gw.last("prompt.submit")).toBeUndefined()
    t.destroy()
  })
})
