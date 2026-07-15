import { describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { TestRecorder } from "@opentui/core/testing"
import { mountNode, until, type Harness } from "./harness"
import { turnReducer, initialTurn, type Action } from "../src/app/turnReducer"
import { MessageList } from "../src/components/chat/MessageList"
import { splitContent } from "../src/components/chat/MediaChip"
import type { Message } from "../src/types/message"

const UDIFF = [
  "--- a/foo.ts",
  "+++ b/foo.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old line",
  "+new line",
].join("\n")

function locate(t: Harness, needle: string) {
  const rows = t.frame().split("\n")
  const y = rows.findIndex(row => row.includes(needle))
  if (y < 0) throw new Error(`Missing frame token: ${needle}`)
  return { x: rows[y].indexOf(needle), y }
}

type Node = {
  constructor?: { name?: string }
  width?: number
  getChildren?: () => Node[]
  content?: Node
  viewport?: { width?: number }
}

function find(node: Node, name: string): Node | undefined {
  if (node.constructor?.name === name) return node
  for (const child of node.getChildren?.() ?? []) {
    const hit = find(child, name)
    if (hit) return hit
  }
}

function reduce(actions: Action[]) {
  return actions.reduce(turnReducer, initialTurn)
}

const SOURCE = "# Heading\n\nThis is **bold** and `code`."
let stream!: (content: string) => void

function StreamProbe() {
  const [content, set] = useState(SOURCE)
  stream = set
  const message: Message = {
    id: "stream-probe", role: "assistant", timestamp: 0,
    parts: [{ type: "text", key: "stream-part", content, streaming: true }],
  }
  return (
    <box flexDirection="column" width="100%" height="100%">
      <MessageList messages={[message]} streaming />
    </box>
  )
}

describe("message transcript contracts", () => {
  test("markdown images route to media without interpreting fenced examples", () => {
    expect(splitContent([
      "before ![preview](/tmp/owl.png) after",
      "```md",
      "![literal](/tmp/owl.png)",
      "```",
    ].join("\n"))).toEqual([
      { md: "before " },
      { media: "/tmp/owl.png" },
      { md: " after" },
      { code: "![literal](/tmp/owl.png)", lang: "md" },
    ])
  })

  test("streamed assistant headings never expose source markers between highlight passes", async () => {
    await using t = await mountNode(<StreamProbe />, { width: 80, height: 16 })
    const recorder = new TestRecorder(t.renderer)
    recorder.rec()

    for (const suffix of [" stream-one", " stream-two", " stream-three", " stream-four"]) {
      act(() => stream(SOURCE + suffix))
      await until(t, () => t.frame().includes(suffix.trim()) && !t.frame().includes("# Heading"))
    }
    recorder.stop()

    const frames = recorder.recordedFrames.map(frame => frame.frame)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.some(frame => frame.includes("# Heading"))).toBe(false)
  })

  test("trim-equivalent completion cannot duplicate or reorder streamed parts", () => {
    const state = reduce([
      { kind: "message.delta", chunk: "before" },
      { kind: "tool.start", id: "t1", name: "read_file", preview: "src/a.ts" },
      { kind: "tool.complete", id: "t1", summary: "read src/a.ts" },
      { kind: "message.delta", chunk: "after" },
      { kind: "message.complete", text: "after\n" },
    ])
    const parts = state.messages[0].parts

    expect(parts.map(part => part.type)).toEqual(["text", "tool", "text"])
    expect(parts.filter(part => part.type === "text")).toEqual([
      expect.objectContaining({ content: "before", streaming: false }),
      expect.objectContaining({ content: "after", streaming: false }),
    ])
  })

  test("messages occupy one transcript column in chronological order", async () => {
    const messages: Message[] = [
      {
        id: "first", role: "system", timestamp: 0,
        parts: [{ type: "text", content: "first-message", streaming: false }],
      },
      {
        id: "second", role: "system", timestamp: 1,
        parts: [{ type: "text", content: "second-message", streaming: false }],
      },
    ]
    await using t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={messages} streaming={false} />
      </box>,
      { width: 72, height: 12 },
    )
    await until(t, () => t.frame().includes("second-message"))

    expect(locate(t, "first-message").y).toBeLessThan(locate(t, "second-message").y)

    const root = (t.renderer as unknown as { root: Node }).root
    const scroll = find(root, "ScrollBoxRenderable")
    expect(scroll).toBeDefined()
    expect(scroll?.viewport?.width).toBe(72)
    expect(scroll?.content?.getChildren?.()).toHaveLength(1)

    const column = scroll?.content?.getChildren?.()[0]
    expect(column?.width).toBe(scroll?.viewport?.width)
    expect(column?.getChildren?.()).toHaveLength(messages.length)
  })

  test("diff controls toggle their body without selecting the message", async () => {
    const picks: Message[] = []
    const message: Message = {
      id: "a1", role: "assistant", timestamp: 0,
      parts: [
        { type: "text", content: "selection-target", streaming: false },
        {
          type: "tool", id: "td", name: "patch", args: "",
          preview: "src/foo.ts", status: "done", result: UDIFF,
        },
      ],
    }
    await using t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={[message]} streaming={false} onPick={msg => picks.push(msg)} />
      </box>,
      { width: 100, height: 18 },
    )
    await until(t, () => t.frame().includes("foo.ts") && t.frame().includes("selection-target"))

    const body = locate(t, "selection-target")
    await act(async () => { await t.mouse.click(body.x, body.y) })
    expect(picks).toEqual([message])
    expect(t.frame()).not.toContain("+new line")

    const tab = locate(t, "foo.ts")
    await act(async () => { await t.mouse.click(tab.x, tab.y) })
    await until(t, () => t.frame().includes("+new line"))
    expect(picks).toEqual([message])

    const active = locate(t, "foo.ts")
    await act(async () => { await t.mouse.click(active.x, active.y) })
    await until(t, () => !t.frame().includes("+new line"))
    expect(picks).toEqual([message])
  })

  test("turn errors disclose the full body on demand", async () => {
    const error = [
      "RuntimeError: boom",
      ...Array.from({ length: 10 }, (_, i) => `trace-${i}`),
    ].join("\n")
    const message: Message = {
      id: "failed", role: "assistant", timestamp: 0, parts: [], error,
    }
    await using t = await mountNode(
      <box flexDirection="column" width="100%" height="100%">
        <MessageList messages={[message]} streaming={false} />
      </box>,
      { width: 100, height: 30 },
    )
    await until(t, () => t.frame().includes("trace-0"))

    expect(t.frame()).not.toContain("trace-9")
    const body = locate(t, "trace-0")
    await act(async () => { await t.mouse.pressDown(body.x, body.y) })
    await until(t, () => t.frame().includes("trace-9"))

    const open = locate(t, "trace-0")
    await act(async () => { await t.mouse.pressDown(open.x, open.y) })
    await until(t, () => !t.frame().includes("trace-9"))
  })
})
