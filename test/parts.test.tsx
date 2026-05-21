import { describe, expect, test } from "bun:test"
import { act, createRef, useImperativeHandle, forwardRef, useRef } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { mountNode, until, type Harness } from "./harness"
import { PartsBuffer, styles as partStyles, type FilePart, type AgentPart, type TextPart } from "../src/app/parts"
import { useTheme } from "../src/theme"

// Probe mounts a bare <textarea> inside a ThemeProvider so partStyles
// can register against a real SyntaxStyle. Exposes the TextareaRenderable
// and the PartsBuffer bound to it so tests drive both directly.
type Probe = {
  ta: TextareaRenderable
  buf: PartsBuffer
}

const Harn = forwardRef<Probe>((_, ref) => {
  const theme = useTheme()
  const ta = useRef<TextareaRenderable | null>(null)
  const buf = useRef<PartsBuffer | null>(null)
  useImperativeHandle(ref, () => ({
    get ta() { return ta.current! },
    get buf() { return buf.current! },
  }), [])
  const sids = partStyles(theme.syntaxStyle, theme.theme)
  return (
    <textarea
      ref={r => {
        ta.current = r
        if (r && !buf.current) buf.current = new PartsBuffer(r, sids)
        if (!r) buf.current = null
      }}
      syntaxStyle={theme.syntaxStyle}
      focused
      minHeight={1}
      maxHeight={6}
      wrapMode="word"
    />
  )
})

async function setup(): Promise<{ t: Harness; probe: Probe }> {
  const ref = createRef<Probe>()
  const t = await mountNode(<Harn ref={ref} />, { width: 80, height: 10 })
  await until(t, () => ref.current?.ta != null && ref.current?.buf != null)
  return { t, probe: ref.current! }
}

function file(name: string): FilePart {
  return {
    type: "file",
    mime: "text/uri-list",
    filename: name,
    source: { type: "file", path: name, text: { start: 0, end: name.length, value: name } },
  }
}

function agent(name: string): AgentPart {
  return { type: "agent", name }
}

function text(body: string): TextPart {
  return { type: "text", text: body }
}

describe("PartsBuffer", () => {
  test("insertText appends plain text, produces no parts", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("hello"))
    await t.settle()
    expect(probe.buf.text()).toBe("hello")
    expect(probe.buf.parts()).toEqual([])
    t.destroy()
  })

  test("insertPart writes virtualText + trailing space, records part with range", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertPart(file("@file:src/a.ts"), "@file:src/a.ts"))
    await t.settle()
    expect(probe.buf.text()).toBe("@file:src/a.ts ")
    const ps = probe.buf.parts()
    expect(ps).toHaveLength(1)
    const p = ps[0]!
    expect(p.type).toBe("file")
    if (p.type === "file") {
      expect(p.filename).toBe("@file:src/a.ts")
      expect(p.source?.text.start).toBe(0)
      expect(p.source?.text.end).toBe(14)
      expect(p.source?.text.value).toBe("@file:src/a.ts")
    }
    t.destroy()
  })

  test("insertText + insertPart + insertText preserves display order", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("see "))
    act(() => probe.buf.insertPart(file("@file:a.ts"), "@file:a.ts"))
    act(() => probe.buf.insertText("then "))
    act(() => probe.buf.insertPart(agent("reviewer"), "@reviewer"))
    act(() => probe.buf.insertText("done"))
    await t.settle()
    expect(probe.buf.text()).toBe("see @file:a.ts then @reviewer done")
    const ps = probe.buf.parts()
    expect(ps.map(p => p.type)).toEqual(["file", "agent"])
    // ranges in ascending order
    const r0 = ps[0]!.type === "file" ? ps[0]!.source!.text : null
    const r1 = ps[1]!.type === "agent" ? ps[1]!.source! : null
    expect(r0!.start).toBeLessThan(r1!.start)
    t.destroy()
  })

  test("listParts equivalent: parts() reflects kinds and ranges", async () => {
    const { t, probe } = await setup()
    const f = file("@file:x")
    const a = agent("reviewer")
    const txt = text("pasted content body")
    act(() => probe.buf.insertPart(f, "@file:x"))
    act(() => probe.buf.insertPart(a, "@reviewer"))
    act(() => probe.buf.insertPart(txt, "[Pasted #1]"))
    await t.settle()
    const kinds = probe.buf.parts().map(p => p.type)
    expect(kinds).toEqual(["file", "agent", "text"])
    t.destroy()
  })

  test("chip at buffer start", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    act(() => probe.buf.insertText("after"))
    await t.settle()
    expect(probe.buf.text()).toBe("@file:a after")
    const p = probe.buf.parts()[0]!
    if (p.type === "file") expect(p.source?.text.start).toBe(0)
    t.destroy()
  })

  test("chip at buffer end (no trailing text after the chip's trailing space)", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("before "))
    act(() => probe.buf.insertPart(file("@file:b"), "@file:b"))
    await t.settle()
    // insertPart always appends a trailing space; caret lands after it
    expect(probe.buf.text()).toBe("before @file:b ")
    expect(probe.buf.parts()).toHaveLength(1)
    t.destroy()
  })

  test("adjacent chips — two chips inserted back to back", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    act(() => probe.buf.insertPart(file("@file:b"), "@file:b"))
    await t.settle()
    expect(probe.buf.text()).toBe("@file:a @file:b ")
    const ps = probe.buf.parts()
    expect(ps).toHaveLength(2)
    const r0 = ps[0]!.type === "file" ? ps[0]!.source!.text : null
    const r1 = ps[1]!.type === "file" ? ps[1]!.source!.text : null
    expect(r0!.end).toBeLessThanOrEqual(r1!.start)
    expect(r1!.start - r0!.end).toBe(1) // the space between them
    t.destroy()
  })

  test("inserting text immediately before a chip does NOT extend the chip's range", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    await t.settle()
    const before = probe.buf.parts()[0]!
    const origLen = before.type === "file" ? before.source!.text.end - before.source!.text.start : 0
    // Move caret to 0 and insert "xx" before the chip
    act(() => { probe.ta.cursorOffset = 0 })
    act(() => probe.buf.insertText("xx"))
    await t.settle()
    expect(probe.buf.text()).toBe("xx@file:a ")
    const after = probe.buf.parts()[0]!
    if (after.type === "file") {
      const newLen = after.source!.text.end - after.source!.text.start
      expect(newLen).toBe(origLen)
      expect(after.source!.text.start).toBe(2) // shifted, not extended
    }
    t.destroy()
  })

  test("inserting text immediately after a chip does NOT extend the chip's range", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    await t.settle()
    const before = probe.buf.parts()[0]!
    const origEnd = before.type === "file" ? before.source!.text.end : 0
    // Caret already at end of buffer after insertPart; insert more text
    act(() => probe.buf.insertText("yy"))
    await t.settle()
    expect(probe.buf.text()).toBe("@file:a yy")
    const after = probe.buf.parts()[0]!
    if (after.type === "file") {
      expect(after.source!.text.end).toBe(origEnd)
      expect(after.source!.text.start).toBe(0)
    }
    t.destroy()
  })

  test("atomic-chip backspace: one keystroke removes the whole chip + its part", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    await t.settle()
    // caret sits just past the trailing space; remove the space first so
    // the next backspace lands on the chip boundary
    act(() => t.keys.pressBackspace())
    await t.settle()
    expect(probe.buf.text()).toBe("@file:a")
    expect(probe.buf.parts()).toHaveLength(1)
    // Now a single backspace deletes the entire chip atomically
    act(() => t.keys.pressBackspace())
    await t.settle()
    expect(probe.buf.text()).toBe("")
    expect(probe.buf.parts()).toEqual([])
    t.destroy()
  })

  test("backspace inside plain text deletes one char (regression guard)", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("hello"))
    await t.settle()
    act(() => t.keys.pressBackspace())
    await t.settle()
    expect(probe.buf.text()).toBe("hell")
    act(() => t.keys.pressBackspace())
    await t.settle()
    expect(probe.buf.text()).toBe("hel")
    t.destroy()
  })

  test("deleteRange spanning a chip removes it cleanly", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("prefix "))
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    act(() => probe.buf.insertText("suffix"))
    await t.settle()
    expect(probe.buf.text()).toBe("prefix @file:a suffix")
    // Delete everything from end of "prefix " through "@file:a" (cols 7..14
    // inclusive) by replacing the whole buffer — setText + sync mirrors
    // what a selection+delete via the textarea would do.
    act(() => {
      probe.ta.deleteRange(0, 7, 0, 15)
    })
    await t.settle()
    expect(probe.buf.text()).toBe("prefix suffix")
    expect(probe.buf.parts()).toEqual([])
    t.destroy()
  })

  test("toSnapshot() + fromSnapshot() round-trip is lossless", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("look "))
    act(() => probe.buf.insertPart(file("@file:src/z.ts"), "@file:src/z.ts"))
    act(() => probe.buf.insertText("and "))
    act(() => probe.buf.insertPart(agent("reviewer"), "@reviewer"))
    await t.settle()
    const snap = probe.buf.toSnapshot()
    expect(snap.v).toBe(1)
    expect(snap.input).toBe(probe.buf.text())
    expect(snap.parts).toHaveLength(2)

    // Clear, then restore; text + parts must match exactly.
    act(() => probe.buf.clear())
    await t.settle()
    expect(probe.buf.text()).toBe("")
    expect(probe.buf.parts()).toEqual([])

    act(() => probe.buf.fromSnapshot(snap))
    await t.settle()
    expect(probe.buf.text()).toBe(snap.input)
    // Deep-equal parts
    expect(probe.buf.parts()).toEqual(snap.parts)

    // Second snapshot must deep-equal the first.
    const snap2 = probe.buf.toSnapshot()
    expect(snap2).toEqual(snap)
    t.destroy()
  })

  test("clear() wipes text, marks, and parts", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("x "))
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    await t.settle()
    expect(probe.buf.parts()).toHaveLength(1)
    act(() => probe.buf.clear())
    await t.settle()
    expect(probe.buf.text()).toBe("")
    expect(probe.buf.parts()).toEqual([])
    t.destroy()
  })

  test("expand() inlines text parts, keeps file/agent parts in emitted list", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertText("here "))
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    act(() => probe.buf.insertText(" and "))
    act(() => probe.buf.insertPart(text("the real pasted body"), "[Pasted #1]"))
    await t.settle()
    expect(probe.buf.text()).toBe("here @file:a  and [Pasted #1] ")
    const exp = probe.buf.expand()
    // [Pasted #1] replaced by its source text, @file:a chip preserved as-is
    expect(exp.text).toBe("here @file:a  and the real pasted body ")
    expect(exp.parts).toHaveLength(1)
    expect(exp.parts[0]!.type).toBe("file")
    t.destroy()
  })

  test("sync() drops parts whose marks were deleted (atomic backspace case)", async () => {
    const { t, probe } = await setup()
    act(() => probe.buf.insertPart(file("@file:a"), "@file:a"))
    act(() => probe.buf.insertPart(file("@file:b"), "@file:b"))
    await t.settle()
    expect(probe.buf.parts()).toHaveLength(2)
    // Delete the trailing space, then the second chip via backspace.
    act(() => t.keys.pressBackspace())
    await t.settle()
    act(() => t.keys.pressBackspace())
    await t.settle()
    const ps = probe.buf.parts()
    expect(ps).toHaveLength(1)
    if (ps[0]!.type === "file") expect(ps[0]!.filename).toBe("@file:a")
    t.destroy()
  })
})
