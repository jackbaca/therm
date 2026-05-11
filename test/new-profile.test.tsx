import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { openCreateProfile } from "../src/dialogs/new-profile"
import { useDialog, type DialogContext } from "../src/ui/dialog"
import { useEffect, useRef } from "react"

// Harness component — opens the dialog on mount and stashes the result
// promise so tests can assert on it without racing the dialog's resolve.
function Host(p: { existing: string[]; onResult: (r: unknown) => void }) {
  const dialog = useDialog()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    openCreateProfile(dialog as DialogContext, { existing: p.existing }).then(p.onResult)
  }, [dialog, p])
  return null
}

async function open(existing: string[] = []) {
  let result: unknown = undefined
  const t = await mountNode(
    <Host existing={existing} onResult={(r) => { result = r }} />,
    { width: 120, height: 40 },
  )
  await until(t, () => t.frame().includes("New Profile"))
  return { t, get result() { return result } }
}

describe("new-profile dialog", () => {
  test("Tab cycles fields (name → clone → alias); Space toggles alias only when focused", async () => {
    const { t } = await open([])
    // Type a name while 'name' is focused — printable char should land.
    await act(async () => { await t.keys.typeText("a") })
    await t.settle()
    expect(t.frame()).toContain("Name")
    expect(t.frame()).toMatch(/Name\s+a/)

    // Alias starts true (default). Space should NOT toggle it while 'name'
    // is focused — Space is a printable and must not reach the checkbox.
    expect(t.frame()).toContain("[x] shell alias")
    act(() => t.keys.pressKey(" ")); await t.settle()
    expect(t.frame()).toContain("[x] shell alias")

    // Tab once → clone. Tab again → alias. Now Space toggles.
    act(() => t.keys.pressTab()); await t.settle()  // → clone
    act(() => t.keys.pressKey(" ")); await t.settle()  // must NOT toggle
    expect(t.frame()).toContain("[x] shell alias")

    act(() => t.keys.pressTab()); await t.settle()  // → alias
    act(() => t.keys.pressKey(" ")); await t.settle()
    expect(t.frame()).toContain("[ ] shell alias")
    act(() => t.keys.pressKey(" ")); await t.settle()
    expect(t.frame()).toContain("[x] shell alias")

    // Tab wraps back to name. Shift+Tab reverses.
    act(() => t.keys.pressTab()); await t.settle()  // alias → name
    await act(async () => { await t.keys.typeText("b") })
    await t.settle()
    expect(t.frame()).toMatch(/Name\s+ab/)

    act(() => t.keys.pressTab({ shift: true })); await t.settle()  // name → alias
    act(() => t.keys.pressKey(" ")); await t.settle()
    expect(t.frame()).toContain("[ ] shell alias")
    t.destroy()
  })

  test("arrows move clone-from selection only while 'clone' is focused", async () => {
    const { t } = await open(["profile-a", "profile-b"])
    // Focus starts on name; ↓ should be inert here.
    act(() => t.keys.pressArrow("down")); await t.settle()
    const frame1 = t.frame()
    // caret still on '(fresh)'
    expect(frame1).toMatch(/▸ \(fresh\)/)

    // Tab → clone; now ↓ moves the caret.
    act(() => t.keys.pressTab()); await t.settle()
    act(() => t.keys.pressArrow("down")); await t.settle()
    expect(t.frame()).toMatch(/▸ profile-a/)
    act(() => t.keys.pressArrow("down")); await t.settle()
    expect(t.frame()).toMatch(/▸ profile-b/)
    t.destroy()
  })

  test("Enter submits with current field values; Esc cancels", async () => {
    const host = await open([])
    const { t } = host
    await act(async () => { await t.keys.typeText("myprofile") })
    await t.settle()
    // Enter from any field should submit when valid.
    act(() => t.keys.pressEnter()); await t.settle()
    await until(t, () => host.result !== undefined)
    expect(host.result).toEqual({ name: "myprofile", cloneFrom: null, alias: true })
    t.destroy()
  })

  test("Esc cancels and resolves null", async () => {
    const host = await open([])
    act(() => host.t.keys.pressEscape()); await host.t.settle()
    await until(host.t, () => host.result !== undefined)
    expect(host.result).toBeNull()
    host.t.destroy()
  })
})
