import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { tmpHome } from "./fixture/home"
import { MockGateway, mount, until, type Harness } from "./harness"

const catalog = () => ({ pairs: [["/new", "new session"]] })

const count = (gw: MockGateway, method: string) =>
  gw.calls.filter(call => call.method === method).length

const slash = async (t: Harness, text: string) => {
  await act(async () => { await t.keys.typeText(text) })
  act(() => t.keys.pressEnter())
  await t.settle()
}

async function gated(text: string, method: string) {
  await using _home = await tmpHome({ config: {} })
  const gw = new MockGateway({ "commands.catalog": catalog })
  await using t = await mount({ gw })
  await until(t, () => count(gw, "session.create") === 1)

  await slash(t, text)
  expect(count(gw, method)).toBe(0)
  await act(async () => { await t.keys.typeText("y") })
  await until(t, () => count(gw, method) === 1)
  await t.settle()
  expect(count(gw, method)).toBe(1)
}

async function bypass(config: Record<string, unknown>, text: string, env = false) {
  await using _home = await tmpHome({ config })
  if (env) process.env.HERMES_TUI_NO_CONFIRM = "1"
  const gw = new MockGateway({ "commands.catalog": catalog })
  await using t = await mount({ gw })
  await until(t, () => count(gw, "session.create") === 1)

  await slash(t, text)
  await until(t, () => count(gw, "session.close") === 1)
  delete process.env.HERMES_TUI_NO_CONFIRM
}

describe("destructive slash confirmation", () => {
  afterEach(() => { delete process.env.HERMES_TUI_NO_CONFIRM })

  test("default policy withholds a destructive effect until approval", async () => {
    await gated("/new", "session.close")
  })

  test("cancellation executes nothing and returns input ownership", async () => {
    await using _home = await tmpHome({ config: {} })
    const gw = new MockGateway({ "commands.catalog": catalog })
    await using t = await mount({ gw })
    await until(t, () => count(gw, "session.create") === 1)

    await slash(t, "/new")
    expect(count(gw, "session.close")).toBe(0)
    await act(async () => { await t.keys.typeText("n") })
    await t.settle()

    await slash(t, "still-running")
    await until(t, () => gw.last("prompt.submit")?.params.text === "still-running")
    expect(count(gw, "session.close")).toBe(0)
  })

  test("explicit bypass controls execute without confirmation", async () => {
    await bypass({}, "/new now")
    await bypass({ approvals: { destructive_slash_confirm: false } }, "/new")
    await bypass({}, "/new", true)
  })

  test("always executes once and persists the exact safety gate", async () => {
    await using _home = await tmpHome({ config: {} })
    const gw = new MockGateway({ "commands.catalog": catalog })
    gw.expect$("session.close", () => ({ closed: true }))
    gw.expect$("cli.exec", () => ({ blocked: false, code: 0, output: "ok" }), {
      match: p => JSON.stringify(p.argv) === JSON.stringify([
        "config", "set", "approvals.destructive_slash_confirm", "false",
      ]),
    })
    await using t = await mount({ gw })
    await until(t, () => count(gw, "session.create") === 1)

    await slash(t, "/new always")
    await until(t, () => count(gw, "session.close") === 1)
    await until(t, () => count(gw, "cli.exec") === 1)
    expect(count(gw, "session.close")).toBe(1)
  })
})
