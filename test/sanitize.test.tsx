// Render-safety sanitizer + reducer integration. We assert that
// (a) the helper strips the byte classes that poison OpenTUI cells and
// (b) the reducer applies it on every gateway-sourced string boundary.

import { describe, expect, test } from "bun:test"
import { sanitize } from "../src/utils/sanitize"
import { turnReducer, initialTurn } from "../src/app/turnReducer"

describe("sanitize", () => {
  test("strips complete SGR color escapes", () => {
    expect(sanitize("\x1b[31mred\x1b[0m text")).toBe("red text")
    expect(sanitize("\x1b[1;38;5;208mfancy\x1b[m")).toBe("fancy")
  })

  test("strips dangling/incomplete CSI", () => {
    // Mid-stream truncation: parameter bytes with no final byte.
    expect(sanitize("ok \x1b[31;1")).toBe("ok ")
    // Lone introducer.
    expect(sanitize("ok \x1b[")).toBe("ok ")
    // Bare ESC followed by a printable byte matches the "ESC + 1 byte"
    // (escape-sequence introducer) rule and both go.
    expect(sanitize("ok \x1b end")).toBe("ok end")
  })

  test("strips OSC sequences (BEL- and ST-terminated, plus unterminated)", () => {
    expect(sanitize("a\x1b]0;title\x07b")).toBe("ab")
    expect(sanitize("a\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\b")).toBe("alinkb")
    // Unterminated OSC tail — drop to end-of-string.
    expect(sanitize("a\x1b]52;c;ZGF0YQ")).toBe("a")
  })

  test("strips C0 control bytes but keeps tab/newline/CR", () => {
    expect(sanitize("a\x00b\x07c")).toBe("abc")
    expect(sanitize("line1\nline2\tcol\r\n")).toBe("line1\nline2\tcol\r\n")
  })

  test("strips C1 controls and DEL", () => {
    expect(sanitize("a\x9bb\x7fc")).toBe("abc")
  })

  test("strips DCS/APC payloads (sixel- and kitty-graphics-style)", () => {
    expect(sanitize("a\x1bPpayload\x1b\\b")).toBe("ab")
    expect(sanitize("a\x1b_kitty-graphic\x1b\\b")).toBe("ab")
  })

  test("passes plain text and markdown punctuation through unchanged", () => {
    const md = "**bold** _em_ `code` [link](u) — em-dash · mid-dot"
    expect(sanitize(md)).toBe(md)
  })

  test("handles null/undefined/empty", () => {
    expect(sanitize(null)).toBe("")
    expect(sanitize(undefined)).toBe("")
    expect(sanitize("")).toBe("")
  })
})

describe("turnReducer sanitizes provider/tool-controlled strings", () => {
  test("system message text", () => {
    const s = turnReducer(initialTurn, { kind: "system", text: "\x1b[31mwarning\x1b[0m" })
    expect(s.messages[0].parts[0]).toMatchObject({ type: "text", content: "warning" })
  })

  test("tool.start preview", () => {
    let s = turnReducer(initialTurn, { kind: "push", message: {
      id: "m1", role: "assistant", parts: [], timestamp: 0,
    }})
    s = turnReducer(s, { kind: "tool.start", id: "t1", name: "terminal", preview: "ls\x1b[K" })
    expect(s.messages[0].parts[0]).toMatchObject({ type: "tool", preview: "ls" })
  })

  test("tool.complete result and summary", () => {
    let s = turnReducer(initialTurn, { kind: "push", message: {
      id: "m1", role: "assistant", parts: [], timestamp: 0,
    }})
    s = turnReducer(s, { kind: "tool.start", id: "t1", name: "terminal" })
    s = turnReducer(s, { kind: "tool.complete", id: "t1",
      error: "exit 1\x1b[0m", summary: "\x1b[31mfailed\x1b[m" })
    expect(s.messages[0].parts[0]).toMatchObject({ type: "tool", result: "exit 1" })
  })

  test("subagent start goal", () => {
    let s = turnReducer(initialTurn, { kind: "push", message: {
      id: "m1", role: "assistant", parts: [], timestamp: 0,
    }})
    s = turnReducer(s, { kind: "subagent", event: "start", payload: {
      task_index: 0, depth: 0, goal: "\x1b]0;hijack\x07do thing",
    } as never })
    expect(s.messages[0].parts[0]).toMatchObject({
      type: "tool", goal: "do thing", preview: "do thing",
    })
  })

  test("error action", () => {
    const s = turnReducer(initialTurn, { kind: "error", text: "boom\x1b[31m" })
    expect(s.messages[0].parts[0]).toMatchObject({ type: "text", content: "Error: boom" })
  })
})
