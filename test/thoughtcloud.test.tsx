import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { ThoughtCloud } from "../src/components/chat/ThoughtCloud"
import type { Message } from "../src/types/message"

describe("ThoughtCloud reasoning", () => {
  test("renders reasoning as markdown while tools stay custom rows", async () => {
    const messages: Message[] = [{
      id: "a1", role: "assistant", timestamp: 0,
      parts: [
        { type: "thinking", content: "Use `scan_skill_commands()` then **verify**.", streaming: false },
        { type: "tool", id: "tw", name: "write_file", args: "", preview: "src/x.ts", status: "done", duration: 9 },
      ],
    }]
    const t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <ThoughtCloud height={12} messages={messages} onResize={() => {}} />
      </box>,
      { width: 100, height: 20 },
    )
    await until(t, () => t.frame().includes("Use scan_skill_commands() then verify."))
    expect(t.frame()).not.toContain("`scan_skill_commands()`")
    expect(t.frame()).not.toContain("**verify**")

    const rows = t.frame().split("\n")
    const y = rows.findIndex(row => row.includes("reasoning") && row.includes("tools"))
    const x = rows[y].indexOf("tools")
    await act(async () => { await t.mouse.pressDown(x, y) })
    await until(t, () => t.frame().includes("src/x.ts"))
    expect(t.frame()).toContain("src/x.ts")
    t.destroy()
  })
})
