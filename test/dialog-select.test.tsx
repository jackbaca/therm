import { describe, test, expect } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { DialogSelect } from "../src/ui/dialog-select"

const opts = Array.from({ length: 30 }, (_, i) => ({
  title: `Item ${String(i).padStart(2, "0")}`,
  value: `v${i}`,
}))

describe("DialogSelect", () => {
  test("arrow-down past viewport scrolls selection into view", async () => {
    const t = await mountNode(
      <DialogSelect title="Pick" options={opts} onSelect={() => {}} />,
      { width: 80, height: 30 },
    )
    await until(t, () => t.frame().includes("Item 00"))
    // 16-row viewport → item 20 starts off-screen.
    expect(t.frame()).not.toContain("Item 20")
    act(() => { for (let i = 0; i < 20; i++) t.keys.pressArrow("down") })
    await t.settle()
    expect(t.frame()).toContain("Item 20")
    // Top of list scrolled off.
    expect(t.frame()).not.toContain("Item 00")
    t.destroy()
  })

  test("scrollbar sits beside content (root is row, not column)", async () => {
    const t = await mountNode(
      <DialogSelect title="Pick" options={opts} onSelect={() => {}} />,
      { width: 80, height: 30 },
    )
    await until(t, () => t.frame().includes("Item 00"))
    // Scrollbar track glyph is on the SAME line as a visible row.
    const row = t.frame().split("\n").find(l => l.includes("Item 00"))!
    expect(/[▲▼║│┃█▐]/.test(row)).toBe(true)
    t.destroy()
  })

  test("End jumps to last item, Home back to first", async () => {
    const moves: string[] = []
    const t = await mountNode(
      <DialogSelect title="Pick" options={opts} onSelect={() => {}}
        onMove={o => moves.push(o.value)} />,
      { width: 80, height: 30 },
    )
    await until(t, () => t.frame().includes("Item 00"))
    act(() => t.keys.pressKey("END"))
    await t.settle()
    expect(moves.at(-1)).toBe(`v${opts.length - 1}`)
    expect(t.frame()).toContain("Item 29")
    act(() => t.keys.pressKey("HOME"))
    await t.settle()
    expect(moves.at(-1)).toBe("v0")
    expect(t.frame()).toContain("Item 00")
    t.destroy()
  })

  test("PgDn advances by one viewport, Enter selects", async () => {
    const picked: string[] = []
    const t = await mountNode(
      <DialogSelect title="Pick" options={opts} onSelect={o => picked.push(o.value)} />,
      { width: 80, height: 30 },
    )
    await until(t, () => t.frame().includes("Item 00"))
    // Viewport height is 16 → PgDn stride ≈ 15 → cursor lands on a mid-list item.
    act(() => t.keys.pressKey("\x1B[57355u")) // kitty pagedown
    await t.settle()
    act(() => t.keys.pressEnter())
    await t.settle()
    expect(picked.length).toBe(1)
    expect(picked[0]).not.toBe("v0")
    t.destroy()
  })

  test("non-filterable: Space selects", async () => {
    const picked: string[] = []
    const t = await mountNode(
      <DialogSelect title="Pick" options={opts.slice(0, 5)}
        filterable={false} onSelect={o => picked.push(o.value)} />,
      { width: 80, height: 30 },
    )
    await until(t, () => t.frame().includes("Item 00"))
    act(() => t.keys.pressArrow("down"))
    await t.settle()
    act(() => t.keys.pressKey(" "))
    await t.settle()
    expect(picked).toEqual(["v1"])
    t.destroy()
  })
})
