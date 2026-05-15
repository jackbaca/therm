import { beforeAll, describe, expect, test } from "bun:test"
import { openStateDb } from "./fixtures/state-db"
import { goalState, resetDb } from "../src/service/sessions-db"

describe("sessions-db/goalState", () => {
  beforeAll(() => {
    const db = openStateDb()
    const put = (sid: string, j: unknown) =>
      db.run("INSERT OR REPLACE INTO state_meta (key, value) VALUES (?, ?)",
        [`goal:${sid}`, JSON.stringify(j)])
    put("g-none", { goal: "ship it", status: "active", turn_count: 2 })
    put("g-subs", {
      goal: "ship it", status: "active",
      subgoals: ["  add tests  ", "", 42, null, "update docs"],
    })
    put("g-empty", { goal: "x", status: "paused", subgoals: [] })
    db.run("INSERT OR REPLACE INTO state_meta (key, value) VALUES (?, ?)",
      ["goal:g-bad", "{not json"])
    db.close()
    resetDb()
  })

  test("absent subgoals field → undefined (back-compat)", () => {
    const g = goalState("g-none")
    expect(g?.goal).toBe("ship it")
    expect(g?.turn_count).toBe(2)
    expect(g?.subgoals).toBeUndefined()
  })

  test("subgoals: trims, drops non-string and empty", () => {
    const g = goalState("g-subs")
    expect(g?.subgoals).toEqual(["add tests", "update docs"])
  })

  test("empty subgoals array → undefined", () => {
    expect(goalState("g-empty")?.subgoals).toBeUndefined()
  })

  test("malformed JSON → null", () => {
    expect(goalState("g-bad")).toBeNull()
  })

  test("missing row → null", () => {
    expect(goalState("nope")).toBeNull()
  })
})
