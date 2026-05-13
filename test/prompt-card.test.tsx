import { describe, test, expect } from "bun:test"
import { act, createRef } from "react"
import { mountNode, until, MockGateway } from "./harness"
import { PromptCard, pending, type PromptCardHandle } from "../src/components/chat/PromptCard"
import type { PromptPart, Part } from "../src/types/message"

const approval = (over: Partial<Extract<PromptPart["req"], { variant: "approval" }>> = {}): PromptPart => ({
  type: "prompt", id: "a1", variant: "approval",
  req: { variant: "approval", command: "rm -rf /tmp/x", description: "recursive rm", ...over },
})

describe("PromptCard.Approval", () => {
  test("renders command + pattern_keys; 1..4/Enter/Esc dispatch approval.respond", async () => {
    const gw = new MockGateway(); gw.ok = true
    const ref = createRef<PromptCardHandle>()
    const answers: string[] = []
    await using t = await mountNode(
      <PromptCard ref={ref}
        part={approval({ pattern_keys: ["rm_recursive", "tmp_write"] })}
        onAnswer={(_, label) => answers.push(label)} />,
      { gw },
    )
    const f = t.frame()
    expect(f).toContain("$ rm -rf /tmp/x")
    expect(f).toContain("recursive rm")
    expect(f).toContain("rm_recursive, tmp_write")
    expect(f).toContain("Allow once")
    expect(f).toContain("Deny")

    act(() => ref.current!.feed({ name: "2" } as never))
    await t.settle()
    expect(gw.last("approval.respond")?.params.choice).toBe("session")
    expect(answers).toEqual(["Allow this session"])
    // second send is ignored (done latch)
    act(() => ref.current!.feed({ name: "4" } as never))
    await t.settle()
    expect(gw.calls.filter(c => c.method === "approval.respond").length).toBe(1)
  })

  test("←/→ wraps, Enter sends selection", async () => {
    const gw = new MockGateway(); gw.ok = true
    const ref = createRef<PromptCardHandle>()
    await using t = await mountNode(
      <PromptCard ref={ref} part={approval()} onAnswer={() => {}} />,
      { gw },
    )
    act(() => ref.current!.feed({ name: "left" } as never))
    act(() => ref.current!.feed({ name: "return" } as never))
    await t.settle()
    expect(gw.last("approval.respond")?.params.choice).toBe("deny")
  })

  test("answered part collapses to Outcome line", async () => {
    await using t = await mountNode(
      <PromptCard part={{ ...approval(), answered: { label: "Allow once", ok: true, at: 0 } }}
        onAnswer={() => {}} />,
    )
    expect(t.frame()).toContain("✓")
    expect(t.frame()).toContain("Allow once")
    expect(t.frame()).not.toContain("$ rm")
  })
})

describe("PromptCard.Clarify", () => {
  test("choice list: ↓ + Enter sends; 'Other' opens freeform", async () => {
    const gw = new MockGateway(); gw.ok = true
    const ref = createRef<PromptCardHandle>()
    const part: PromptPart = {
      type: "prompt", id: "c1", variant: "clarify",
      req: { variant: "clarify", request_id: "r1", question: "which?", choices: ["A", "B"] },
    }
    await using t = await mountNode(
      <PromptCard ref={ref} part={part} onAnswer={() => {}} />, { gw },
    )
    expect(t.frame()).toContain("which?")
    expect(t.frame()).toContain("Other")
    act(() => ref.current!.feed({ name: "down" } as never))
    act(() => ref.current!.feed({ name: "return" } as never))
    await t.settle()
    expect(gw.last("clarify.respond")?.params).toMatchObject({ request_id: "r1", answer: "B" })
  })
})

describe("pending()", () => {
  test("finds the latest unanswered prompt part across messages", () => {
    const parts = (...ps: Part[]) => ({ role: "assistant" as const, parts: ps })
    const a = approval()
    const done = { ...approval(), id: "a0", answered: { label: "x", ok: true, at: 0 } }
    expect(pending([parts(done)])).toBeNull()
    expect(pending([parts(done), parts({ type: "text", content: "hi", streaming: false }, a)])).toBe(a)
  })
})
