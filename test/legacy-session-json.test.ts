import { describe, test, expect, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const HH = process.env.HERMES_HOME!

afterEach(() => {
  rmSync(join(HH, "sessions"), { recursive: true, force: true })
})

describe("legacy session JSON readers", () => {
  test("missing sessions directory is empty optional state", async () => {
    rmSync(join(HH, "sessions"), { recursive: true, force: true })

    const { readLiveSessions, readToolsFromLatestSession } = await import("../src/service/hermes-home")

    expect(await readLiveSessions()).toEqual({})
    expect(await readToolsFromLatestSession()).toBeNull()
  })

  test("missing JSON snapshots do not break home slices", async () => {
    rmSync(join(HH, "sessions"), { recursive: true, force: true })

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
    const dir = join(HH, "sessions")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "sessions.json"), JSON.stringify({
      a: { session_id: "sid-legacy", last_prompt_tokens: 42 },
    }))
    writeFileSync(join(dir, "session_legacy.json"), JSON.stringify({
      tools: [
        { function: { name: "terminal", description: "run commands", parameters: { type: "object" } } },
      ],
    }))

    const { readLiveSessions, readToolsFromLatestSession } = await import("../src/service/hermes-home")

    expect((await readLiveSessions()).a.session_id).toBe("sid-legacy")
    const tools = await readToolsFromLatestSession()
    expect(tools?.source.relative).toBe("sessions/session_legacy.json")
    expect(tools?.tools.map(t => t.name)).toEqual(["terminal"])
  })
})
