// Acceptance tests for approvals.destructive_slash_confirm gate.
// Upstream feat: b9c001116 — /clear, /new, /undo confirm by default;
// `now`/`once`/`approve`/`yes`/`always` args skip the dialog; `always`
// additionally flips the config key off.

import { describe, expect, test, beforeEach } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { mount, until, MockGateway } from "./harness"

const catalog = () => ({ pairs: [
  ["/clear", "clear session"],
  ["/new", "new session"],
  ["/undo", "undo last turn"],
] })

const writeConfig = (yaml: string) => {
  const dir = process.env.HERMES_HOME!
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "config.yaml"), yaml)
}

describe("destructive slash confirm (t_3b5fe326)", () => {
  beforeEach(() => {
    delete process.env.HERMES_TUI_NO_CONFIRM
    writeConfig("")  // empty → defaults apply; gate is ON
  })

  test("/new opens a confirm dialog by default", async () => {
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Start a new session?"))

    // No session.close yet — dialog is gating the action.
    expect(t.gw.last("session.close")).toBeUndefined()
    t.destroy()
  })

  test("/new now skips the dialog and fires immediately", async () => {
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new now") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.close") !== undefined)

    expect(t.frame()).not.toContain("Start a new session?")
    t.destroy()
  })

  test("pressing y in the confirm dialog fires the action", async () => {
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Start a new session?"))

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => t.gw.last("session.close") !== undefined)
    t.destroy()
  })

  test("pressing n cancels — no session churn", async () => {
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Start a new session?"))

    await act(async () => { await t.keys.typeText("n") })
    await until(t, () => !t.frame().includes("Start a new session?"))

    expect(t.gw.last("session.close")).toBeUndefined()
    t.destroy()
  })

  test("/new always persists approvals.destructive_slash_confirm=false via cli.exec", async () => {
    const cli: { argv: string[] }[] = []
    const gw = new MockGateway({
      "commands.catalog": catalog,
      "cli.exec": (p) => { cli.push({ argv: p.argv as string[] }); return { blocked: false, code: 0, output: "ok" } },
    })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new always") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.close") !== undefined)

    const hit = cli.find(c => c.argv[0] === "config" && c.argv[1] === "set"
      && c.argv[2] === "approvals.destructive_slash_confirm")
    expect(hit?.argv[3]).toBe("false")
    t.destroy()
  })

  test("gate=false in config.yaml → /new skips dialog", async () => {
    writeConfig("approvals:\n  destructive_slash_confirm: false\n")
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.close") !== undefined)

    expect(t.frame()).not.toContain("Start a new session?")
    t.destroy()
  })

  test("HERMES_TUI_NO_CONFIRM=1 bypasses the dialog", async () => {
    process.env.HERMES_TUI_NO_CONFIRM = "1"
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/new") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.close") !== undefined)

    expect(t.frame()).not.toContain("Start a new session?")
    t.destroy()
  })

  test("/clear opens its own confirm dialog", async () => {
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/clear") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Clear session?"))
    t.destroy()
  })

  test("/undo opens its own confirm dialog", async () => {
    const t = await mount({ gw: new MockGateway({ "commands.catalog": catalog }) })
    await until(t, () => t.frame().includes("Ready"))

    await act(async () => { await t.keys.typeText("/undo") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Undo last turn?"))
    t.destroy()
  })
})
