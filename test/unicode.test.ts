import { describe, expect, test } from "bun:test"
import { encode } from "../src/utils/unicode"

const units = (s: string) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16))

describe("unicode JSON encoding", () => {
  test("preserves valid astral characters", () => {
    const out = encode({ text: "ok 💝 done" })
    expect(out.issues).toEqual([])
    expect(JSON.parse(out.text).text).toBe("ok 💝 done")
  })

  test("replaces lone surrogates while keeping valid pairs", () => {
    const out = encode({ text: "a\ud83db\udc9dc💝" })
    expect(out.issues).toEqual([{ path: "$.text", count: 2 }])
    const text = JSON.parse(out.text).text
    expect(text).toBe("a�b�c💝")
    expect(units(text)).toContain("d83d")
    expect(units(text)).toContain("dc9d")
  })

  test("reports nested param paths", () => {
    const out = encode({ params: { text: "x\udc9d", nested: ["ok", { y: "\ud83d" }] } })
    expect(out.issues).toEqual([
      { path: "$.params.text", count: 1 },
      { path: "$.params.nested.1.y", count: 1 },
    ])
  })
})
