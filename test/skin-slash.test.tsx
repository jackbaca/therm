import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until, MockGateway } from "./harness"
import * as prefs from "../src/context/preferences"
import { matchSub, LOCAL_COMMANDS } from "../src/app/slashCommands"

const type = async (t: Awaited<ReturnType<typeof mount>>, s: string) => {
  await act(async () => { await t.keys.typeText(s) })
  await t.settle()
  // First Enter accepts the subcommand-popover entry (writes `/skin X `),
  // second submits. No-arg / unknown-arg have no popover, first submits.
  act(() => t.keys.pressEnter()); await t.settle()
  act(() => t.keys.pressEnter()); await t.settle()
}

describe("/skin", () => {
  test("with arg: writes gateway config, applies theme, clears eikon pref", async () => {
    prefs.set("theme", "tokyonight")
    prefs.set("eikon", "manual")

    const gw = new MockGateway()
    gw.on$("config.set", p => {
      if (p.key === "skin")
        queueMicrotask(() => gw.push({ type: "skin.changed",
          payload: { name: String(p.value), colors: {}, branding: {} } }))
      return { value: String(p.value) }
    })

    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await type(t, "/skin ares")
    await until(t, () => t.frame().includes("skin → ares"))

    const call = gw.last("config.set")!
    expect(call.params.key).toBe("skin")
    expect(call.params.value).toBe("ares")
    expect(prefs.get("theme")).toBe("ares")
    expect(prefs.get("eikon")).toBeUndefined()

    await type(t, "/skin default")
    await until(t, () => t.frame().includes("skin → default"))
    expect(prefs.get("theme")).toBe("default")

    t.destroy()
  })

  test("no arg: prints current + list, no config.set", async () => {
    const gw = new MockGateway()
    gw.push({ type: "skin.changed", payload: { name: "mono", colors: {}, branding: {} } })
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await type(t, "/skin")
    await until(t, () => t.frame().includes("skin: mono"))
    expect(t.frame()).toMatch(/default.*ares.*mono.*slate/)
    expect(gw.last("config.set")).toBeUndefined()
    t.destroy()
  })

  test("unknown name → error toast, no write", async () => {
    const gw = new MockGateway()
    const t = await mount({ gw })
    await until(t, () => t.frame().includes("Ready"))

    await type(t, "/skin bogus")
    await until(t, () => t.frame().includes("unknown skin: bogus"))
    expect(gw.last("config.set")).toBeUndefined()
    t.destroy()
  })

  test("subcommand completion surfaces SKINS", () => {
    const m = matchSub(LOCAL_COMMANDS, "/skin po")
    expect(m?.map(c => c.name)).toEqual(["skin poseidon"])
  })
})
