import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mount, until } from "./harness"
import { resumeHint } from "../src/components/chat/Composer"

describe("composer subagent resume state", () => {
  test("formats zero, one, many, and streaming states", () => {
    expect(resumeHint(undefined, false)).toBeUndefined()
    expect(resumeHint(0, false)).toBeUndefined()
    expect(resumeHint(1, false)).toBe("↩ resumes when subagent finishes")
    expect(resumeHint(3, false)).toBe("↩ resumes when 3 subagents finish")
    expect(resumeHint(2, true)).toBeUndefined()
  })

  test("live session usage reaches the composer and streaming suppresses it", async () => {
    const hint = resumeHint(1, false)!
    const t = await mount({ handlers: {
      "session.create": () => ({
        session_id: "test-sid",
        info: {
          model: "test-model", session_id: "test-sid", tools: {}, skills: {},
          usage: { input: 0, output: 0, total: 0, active_subagents: 1 },
        },
      }),
    } })
    await until(t, () => t.frame().includes(hint))

    act(() => t.gw.push({ type: "message.start", session_id: "test-sid" }))
    await until(t, () => !t.frame().includes(hint))
    t.destroy()
  })
})
