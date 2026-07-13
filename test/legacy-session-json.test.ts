import { describe, test, expect } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpHome } from "./fixture/home"

const dir = () => join(process.env.HERMES_HOME!, "sessions")
const fixture = (name: string) => readFileSync(new URL(`fixtures/sessions/${name}`, import.meta.url))

describe("legacy session JSON readers", () => {
  test("missing sessions directory is empty optional state", async () => {
    await using home = await tmpHome()
    rmSync(dir(), { recursive: true, force: true })

    const { readLiveSessions, readToolsFromLatestSession } = await import("../src/service/hermes-home")

    expect(await readLiveSessions()).toEqual({})
    expect(await readToolsFromLatestSession()).toBeNull()
  })

  test("missing JSON snapshots do not break home slices", async () => {
    await using home = await tmpHome()
    rmSync(dir(), { recursive: true, force: true })

    const { HomeStore } = await import("../src/home/store")
    const h = new HomeStore()
    try {
      expect(await h.ensure("liveSessions")).toEqual({})
      expect(await h.ensure("toolsInfo")).toBeNull()
    } finally {
      h.close()
    }
  })

  test("legacy snapshots still read when explicitly present", async () => {
    await using home = await tmpHome()
    const root = dir()
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "sessions.json"), fixture("sessions-v2026.7.7.json"))
    const name = "session_20260509_002407_e8b6e4.json"
    writeFileSync(join(root, name), fixture(name))

    const { readLiveSessions, readToolsFromLatestSession } = await import("../src/service/hermes-home")

    expect((await readLiveSessions())["agent:main:telegram:chat:user"].session_id).toBe("sid-legacy")
    const tools = await readToolsFromLatestSession()
    expect(tools?.source.relative).toBe(`sessions/${name}`)
    expect(tools?.tools.map(t => t.name)).toEqual(["terminal"])
  })
})
