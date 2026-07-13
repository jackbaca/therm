import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"
import { openStateDb } from "./fixtures/state-db"
import { resetDb } from "../src/service/sessions-db"

const seed = (last?: { id: string; title: string }) => {
  const db = openStateDb()
  db.run("DELETE FROM messages"); db.run("DELETE FROM sessions")
  if (last) db.prepare(
    "INSERT INTO sessions (id, title, source, started_at, message_count) VALUES (?,?,?,?,?)",
  ).run(last.id, last.title, "tui", 1000, 3)
  db.close()
  resetDb()
}

describe("launch surface wiring", () => {
  afterEach(() => seed())

  test("first send reaches prompt.submit", async () => {
    seed()
    const t = await mount({ launch: { mode: "new", splash: true } })
    await act(async () => { await t.keys.typeText("hello") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("prompt.submit")?.params.text === "hello")
    t.destroy()
  })

  test("empty Enter resumes the most recent session without submitting", async () => {
    seed({ id: "prev-sid", title: "fixture" })
    const t = await mount({ launch: { mode: "new", splash: true } })
    act(() => t.keys.pressEnter())
    await until(t, () => t.gw.last("session.resume")?.params.session_id === "prev-sid")
    expect(t.gw.calls.some(call => call.method === "prompt.submit")).toBe(false)
    t.destroy()
  })
})
