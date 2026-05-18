import { describe, test, expect } from "bun:test"
import { act } from "react"
import { useState } from "react"
import { mountNode } from "./harness"
import { Tail, ThoughtCloud } from "../src/components/chat/ThoughtCloud"
import type { Message } from "../src/types/message"

// Tail animates by mutating span .children out of React's view. The
// `run` prop toggle forces a React reconcile of the span subtree;
// this asserts that path doesn't throw "Child not found in children"
// (the failure mode when React's cached child ref has been replaced
// — see ui/table Marquee history for why scrollX is safer there).

describe("ThoughtCloud/Tail (ref-mutation animation)", () => {
  test("run toggle survives reconcile; idle shows all slots; running hides some", async () => {
    let setRun: (v: boolean) => void = () => {}
    const Fix = () => {
      const [r, set] = useState(false)
      setRun = set
      return <Tail run={r} />
    }
    const t = await mountNode(<Fix />, { width: 20, height: 10 })
    await t.settle()
    expect(t.frame()).toContain("╭┄┄╮")
    expect(t.frame()).toContain("╶")

    act(() => setRun(true))
    await t.settle()
    await act(async () => { await Bun.sleep(400) })
    await t.settle()
    const lit = t.frame().split("\n").filter(l => /[╭╮╰╯╶]/.test(l)).length
    expect(lit).toBeLessThan(6)

    act(() => setRun(false))
    await t.settle()
    expect(t.frame()).toContain("╭┄┄╮")
    expect(t.frame()).toContain("╶")
    t.destroy()
  })
})

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
    await t.settle()
    const f = t.frame()
    expect(f).not.toContain("`scan_skill_commands()`")
    expect(f).not.toContain("**verify**")
    expect(f).not.toContain("Write src/x.ts")
    t.destroy()
  })
})
