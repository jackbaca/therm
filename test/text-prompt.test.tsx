import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { useDialog } from "../src/ui/dialog"
import { openTextPrompt } from "../src/dialogs/text-prompt"
import { useEffect } from "react"

let resolved: string | null | undefined

const Opener = () => {
  const dialog = useDialog()
  useEffect(() => {
    resolved = undefined
    void openTextPrompt(dialog, { title: "Rename Thing", label: "Title", initial: "hello" })
      .then(v => { resolved = v })
  }, [])
  return null
}

describe("TextPrompt", () => {
  test("input row is 1-high — hint sits one blank below value, not bled onto", async () => {
    const t = await mountNode(<Opener />)
    await until(t, () => t.frame().includes("Rename Thing"))
    const lines = t.frame().split("\n")
    const valY = lines.findIndex(l => l.includes("┃ hello"))
    expect(valY).toBeGreaterThan(-1)
    // Line directly below is the blank spacer; hint is on valY+2.
    expect(lines[valY + 1]).not.toMatch(/\w/)
    expect(lines[valY + 2]).toContain("Enter confirm")
    // Label and value text start at the same x (no border offset).
    const labelY = lines.findIndex(l => /Title\s*│/.test(l) || /Title\s/.test(l))
    // Label is plain; value has "┃ " prefix (2 chars). gsk.8 was a 1-char
    // off; with the ┃-bar the value starts 2 right of the label — that's
    // the intended oc-style indent, not a misalignment.
    expect(lines[valY].indexOf("hello") - lines[labelY].indexOf("Title")).toBe(2)
    t.destroy()
  })

  test("overlong value truncates inside the dialog, never wraps", async () => {
    const t = await mountNode(<Opener />)
    await until(t, () => t.frame().includes("┃ hello"))
    const long = "x".repeat(200)
    for (const c of long) await act(async () => { await t.keys.typeText(c) })
    await t.settle()
    const lines = t.frame().split("\n")
    // Exactly one line carries the ┃ marker.
    expect(lines.filter(l => l.includes("┃")).length).toBe(1)
    // Hint row still intact directly after.
    const valY = lines.findIndex(l => l.includes("┃"))
    expect(lines[valY + 2]).toContain("Enter confirm")
    t.destroy()
  })

  test("bracketed-paste lands in the buffer", async () => {
    const t = await mountNode(<Opener />)
    await until(t, () => t.frame().includes("┃ hello"))
    await act(async () => { await t.keys.pasteBracketedText("-sk-abc123") })
    await until(t, () => t.frame().includes("hello-sk-abc123"))
    const lines = t.frame().split("\n")
    const valY = lines.findIndex(l => l.includes("┃"))
    expect(lines[valY]).toContain("hello-sk-abc123")
    t.destroy()
  })

  test("← moves cursor: char inserts before end; Enter resolves", async () => {
    const t = await mountNode(<Opener />)
    await until(t, () => t.frame().includes("┃ hello"))
    // "hello" cursor at end → ←← → type X → "helXlo"
    await act(async () => { t.keys.pressArrow("left") })
    await act(async () => { t.keys.pressArrow("left") })
    await act(async () => { await t.keys.typeText("X") })
    await until(t, () => t.frame().includes("helXlo"))
    await act(async () => { t.keys.pressEnter() })
    await until(t, () => resolved !== undefined)
    expect(resolved).toBe("helXlo")
    t.destroy()
  })
})
