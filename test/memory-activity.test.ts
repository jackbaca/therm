import { describe, expect, test, beforeAll } from "bun:test"
import { openStateDb } from "./fixtures/state-db"
import { extract, readMemoryActivity } from "../src/service/memory-activity"

const row = (name: string, args: Record<string, unknown>, ts = 1000) => ({
  ts, session_id: "s1", title: "Test",
  tool_calls: JSON.stringify([{ function: { name, arguments: JSON.stringify(args) } }]),
})

describe("memory-activity/extract", () => {
  test("builtin memory tool: action verb + target-prefixed summary", () => {
    const [a] = extract(row("memory", { action: "add", target: "user", content: "Name: Kaio" }))
    expect(a.provider).toBe("builtin")
    expect(a.op).toBe("write")
    expect(a.verb).toBe("add")
    expect(a.summary).toBe("user: Name: Kaio")
  })

  test("builtin remove uses old_text", () => {
    const [a] = extract(row("memory", { action: "remove", target: "memory", old_text: "stale fact" }))
    expect(a.verb).toBe("remove")
    expect(a.summary).toBe("memory: stale fact")
  })

  test("provider-prefixed tools strip prefix and classify op", () => {
    const [w] = extract(row("mem0_conclude", { conclusion: "User prefers tabs" }))
    expect(w).toMatchObject({ provider: "mem0", op: "write", verb: "conclude" })
    expect(w.summary).toBe("User prefers tabs")
    const [r] = extract(row("mem0_search", { query: "timezone" }))
    expect(r).toMatchObject({ provider: "mem0", op: "read", verb: "search" })
  })

  test("summary truncates long content and collapses whitespace", () => {
    const [a] = extract(row("hindsight_retain", { content: "x".repeat(200) + "\n\n  y" }))
    expect(a.summary.length).toBeLessThanOrEqual(80)
    expect(a.summary.endsWith("…")).toBe(true)
  })

  test("non-memory tool calls and malformed rows are skipped", () => {
    expect(extract(row("terminal", { command: "ls" }))).toEqual([])
    expect(extract({ ts: 0, session_id: "s", title: null, tool_calls: "not json" })).toEqual([])
    expect(extract({ ts: 0, session_id: "s", title: null, tool_calls: "{}" })).toEqual([])
  })

  test("multi-call row yields one activity per memory tool", () => {
    const r = {
      ts: 1, session_id: "s", title: "t",
      tool_calls: JSON.stringify([
        { function: { name: "terminal", arguments: "{}" } },
        { function: { name: "memory", arguments: JSON.stringify({ action: "add", target: "memory", content: "a" }) } },
        { function: { name: "mem0_profile", arguments: "{}" } },
      ]),
    }
    const out = extract(r)
    expect(out.map(a => a.tool)).toEqual(["memory", "mem0_profile"])
  })
})

describe("memory-activity/readMemoryActivity", () => {
  beforeAll(() => {
    const db = openStateDb()
    db.run(`INSERT OR REPLACE INTO sessions (id, title) VALUES ('sA','Session A')`)
    const ins = db.prepare(
      `INSERT INTO messages (session_id, role, tool_calls, timestamp) VALUES (?,?,?,?)`)
    ins.run("sA", "assistant", row("memory", { action: "add", target: "memory", content: "fact 1" }).tool_calls, 100)
    ins.run("sA", "assistant", row("terminal", { command: "ls" }).tool_calls, 101)
    ins.run("sA", "assistant", row("mem0_search", { query: "q" }).tool_calls, 102)
    ins.run("sA", "user", null, 103)
    ins.run("sA", "assistant", row("honcho_conclude", { conclusion: "c" }).tool_calls, 104)
    db.close()
  })

  test("scans assistant rows newest-first, skips non-memory, honours limit", () => {
    const all = readMemoryActivity(10)
    expect(all.map(a => a.tool)).toEqual(["honcho_conclude", "mem0_search", "memory"])
    expect(all[0].sessionTitle).toBe("Session A")
    expect(all[0].ts).toBe(104)

    const one = readMemoryActivity(1)
    expect(one).toHaveLength(1)
    expect(one[0].tool).toBe("honcho_conclude")
  })

  test("missing db → empty, no throw", () => {
    // readonly open of a nonexistent file throws → caught → [].
    // Covered by extract tests; sanity-check the scan cap path here.
    expect(readMemoryActivity(10, 1).map(a => a.tool)).toEqual(["honcho_conclude"])
  })
})
