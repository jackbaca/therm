import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { Config } from "../src/tabs/Config"
import { buildFields, GROUPS, groupOf, sections } from "../src/config"
import { MockGateway, mountNode, until } from "./harness"

type H = Awaited<ReturnType<typeof mountNode>>

const nav = async (t: H, cfg: Record<string, unknown>, key: string) => {
  const group = groupOf(key)
  const at = GROUPS.indexOf(group)
  const gi = at + (at >= 1 ? 1 : 0)
  const rows = sections(group, buildFields(cfg).filter(f => groupOf(f.key) === group))
    .flatMap(s => s.items)
  const ri = rows.findIndex(f => f.key === key)
  if (gi < 0 || ri < 0) throw new Error(`missing config field: ${key}`)
  act(() => { for (let i = 0; i < gi; i++) t.keys.pressArrow("down") })
  act(() => t.keys.pressTab())
  act(() => { for (let i = 0; i < ri; i++) t.keys.pressArrow("down") })
  await t.settle()
}

const count = (gw: MockGateway, method: string) =>
  gw.calls.filter(call => call.method === method).length

const save = async (t: H) => {
  act(() => t.keys.pressKey("s", { ctrl: true }))
  await t.settle()
}

describe("Config tab", () => {
  afterEach(() => { delete process.env.HERMES_MANAGED })

  test("a load failure remains visible to the user", async () => {
    const gw = new MockGateway({
      "config.get": () => { throw new Error("config-load-sentinel") },
    })
    await using t = await mountNode(<Config focused />, { gw })

    await until(t, () => t.frame().includes("config-load-sentinel"))
    expect(count(gw, "config.get")).toBe(1)
  })

  test("a local draft owns the field after a late initial load", async () => {
    let release!: (value: unknown) => void
    let gets = 0
    let cfg = { compression: { enabled: true } }
    const gw = new MockGateway({
      "config.get": () => {
        gets++
        if (gets === 1) return new Promise(done => { release = done })
        return { config: cfg }
      },
    })
    gw.expect$("cli.exec", p => {
      cfg = { compression: { enabled: false } }
      return { blocked: false, code: 0, output: "ok" }
    }, {
      match: p => JSON.stringify(p.argv) === JSON.stringify([
        "config", "set", "compression.enabled", "false",
      ]),
    })
    await using t = await mountNode(<Config focused />, { gw })

    await nav(t, {}, "compression.enabled")
    await act(async () => { await t.keys.typeText(" ") })
    release({ config: { compression: { enabled: true } } })
    await act(async () => { await Promise.resolve() })
    await t.settle()

    await save(t)
    expect(count(gw, "cli.exec")).toBe(0)
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => count(gw, "cli.exec") === 1)
    await until(t, () => gets >= 3)
  })

  test("same-frame edits route through cli, verify, then require restart approval", async () => {
    let cfg = { terminal: { container_persistent: false } }
    let gets = 0
    const restarts: string[] = []
    const gw = new MockGateway({
      "config.get": () => { gets++; return { config: cfg } },
    })
    gw.expect$("cli.exec", () => {
      cfg = { terminal: { container_persistent: true } }
      return { blocked: false, code: 0, output: "ok" }
    }, {
      match: p => JSON.stringify(p.argv) === JSON.stringify([
        "config", "set", "terminal.container_persistent", "true",
      ]),
    })
    gw.on("restart", mode => { restarts.push(mode) })
    await using t = await mountNode(<Config focused />, { gw })

    await nav(t, cfg, "terminal.container_persistent")
    act(() => {
      void t.keys.typeText(" ")
      t.keys.pressKey("s", { ctrl: true })
    })
    await t.settle()
    expect(count(gw, "cli.exec")).toBe(0)

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => count(gw, "cli.exec") === 1)
    await until(t, () => gets >= 3)
    expect(gw.last("config.set")).toBeUndefined()
    expect(restarts).toEqual([])

    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => restarts.length === 1)
    expect(restarts).toEqual(["resume"])
  })

  test("failed readback keeps the draft retryable", async () => {
    let cfg = { compression: { enabled: false } }
    let gets = 0
    const gw = new MockGateway({
      "config.get": () => {
        gets++
        if (gets === 2) throw new Error("readback unavailable")
        return { config: cfg }
      },
    })
    gw.expect$("cli.exec", () => {
      cfg = { compression: { enabled: true } }
      return { blocked: false, code: 0, output: "ok" }
    }, {
      min: 2,
      max: 2,
      match: p => JSON.stringify(p.argv) === JSON.stringify([
        "config", "set", "compression.enabled", "true",
      ]),
    })
    await using t = await mountNode(<Config focused />, { gw })

    await nav(t, cfg, "compression.enabled")
    await act(async () => { await t.keys.typeText(" ") })
    await save(t)
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => gets >= 2)
    expect(count(gw, "cli.exec")).toBe(1)

    await save(t)
    expect(count(gw, "cli.exec")).toBe(1)
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => count(gw, "cli.exec") === 2)
    await until(t, () => gets >= 4)
  })

  test("invalid input blocks persistence until corrected", async () => {
    let cfg = { agent: { max_turns: 90 } }
    const gw = new MockGateway({
      "config.get": () => ({ config: cfg }),
    })
    gw.expect$("cli.exec", () => {
      cfg = { agent: { max_turns: 5 } }
      return { blocked: false, code: 0, output: "ok" }
    }, {
      match: p => JSON.stringify(p.argv) === JSON.stringify([
        "config", "set", "agent.max_turns", "5",
      ]),
    })
    await using t = await mountNode(<Config focused />, { gw })

    await nav(t, cfg, "agent.max_turns")
    act(() => t.keys.pressEnter())
    await t.settle()
    act(() => { t.keys.pressBackspace(); t.keys.pressBackspace() })
    await act(async () => { await t.keys.typeText("0") })
    act(() => t.keys.pressEnter())
    await t.settle()

    await save(t)
    expect(count(gw, "cli.exec")).toBe(0)

    act(() => t.keys.pressBackspace())
    await act(async () => { await t.keys.typeText("5") })
    act(() => t.keys.pressEnter())
    await t.settle()
    await save(t)
    expect(count(gw, "cli.exec")).toBe(0)
    await act(async () => { await t.keys.typeText("y") })
    await until(t, () => count(gw, "cli.exec") === 1)
  })

  test("managed installs reject edits and persistence", async () => {
    process.env.HERMES_MANAGED = "nixos"
    const cfg = { compression: { enabled: false } }
    const gw = new MockGateway({
      "config.get": () => ({ config: cfg }),
    })
    await using t = await mountNode(<Config focused />, { gw })

    await nav(t, cfg, "compression.enabled")
    await act(async () => { await t.keys.typeText(" ") })
    await save(t)
    await t.settle()

    expect(count(gw, "cli.exec")).toBe(0)
    expect(count(gw, "config.set")).toBe(0)
  })
})
