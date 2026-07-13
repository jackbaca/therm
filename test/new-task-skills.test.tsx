import { describe, test, expect } from "bun:test"
import { act, useEffect } from "react"
import { mountNode, MockGateway, until } from "./harness"
import { useDialog } from "../src/ui/dialog"
import { openCreateTask, type Draft } from "../src/dialogs/new-task"

let resolved: Draft | null | undefined

const Opener = () => {
  const dialog = useDialog()
  useEffect(() => {
    resolved = undefined
    void openCreateTask(dialog, { assignees: ["builder", "reviewer"] })
      .then(v => { resolved = v })
  }, [])
  return null
}

async function walkToSkills(t: Awaited<ReturnType<typeof mountNode>>) {
  await until(t, () => t.frame().trim().length > 0)
  await act(async () => { await t.keys.typeText("hi") })
  const tab = async () => { await act(async () => { t.keys.pressTab() }); await t.settle() }
  for (let i = 0; i < 5; i++) await tab()
  await act(async () => { await t.keys.typeText(" ") })
  await t.settle()
  for (let i = 0; i < 5; i++) await tab()
}

describe("new-task Skills field", () => {
  test("typing filters → Tab commits highlighted match as a chip", async () => {
    const gw = new MockGateway({
      "skills.manage": p => p.action === "list"
        ? { skills: { devops: ["kanban-worker", "hermes-agent-skill-authoring"], software: ["plan"] } }
        : {},
    })
    const t = await mountNode(<Opener />, { gw, width: 120, height: 60 })
    await walkToSkills(t)
    // Type "plan" → one match; Tab commits.
    for (const c of "plan") await act(async () => { await t.keys.typeText(c) })
    // Match row shows: "  ▸          plan  software" — ▸ is in the 13-wide label column.
    await until(t, () => /plan\s+software/.test(t.frame()))
    await act(async () => { await t.keys.pressTab() })
    // After commit, filter clears and the match row disappears; only the chip remains.
    await until(t, () => !/plan\s+software/.test(t.frame()))
    // Commit: Ctrl+Enter from the Skills field submits.
    await act(async () => { t.keys.pressEnter({ ctrl: true }) })
    await until(t, () => resolved !== undefined)
    expect(resolved).not.toBeNull()
    expect(resolved!.skills).toEqual(["plan"])
    t.destroy()
  })

  test("Backspace on empty filter removes the last chip", async () => {
    const gw = new MockGateway({
      "skills.manage": () => ({ skills: { devops: ["kanban-worker"], software: ["plan"] } }),
    })
    const t = await mountNode(<Opener />, { gw, width: 120, height: 60 })
    await walkToSkills(t)
    // Add "plan" chip via filter + Tab.
    for (const c of "plan") await act(async () => { await t.keys.typeText(c) })
    await act(async () => { await t.keys.pressTab() })
    // Add "kanban" chip.
    for (const c of "kanban") await act(async () => { await t.keys.typeText(c) })
    await act(async () => { await t.keys.pressTab() })
    await t.settle()
    // Filter is empty now. Backspace should pop the last chip (kanban-worker).
    await act(async () => { await t.keys.pressBackspace() })
    await t.settle()
    // Submit and inspect the draft — more robust than regex on the frame,
    // since chip label collides with the "Title" placeholder glyph.
    await act(async () => { t.keys.pressEnter({ ctrl: true }) })
    await until(t, () => resolved !== undefined)
    expect(resolved!.skills).toEqual(["plan"])
    t.destroy()
  })

  test("filter buffer eats Backspace before popping chips", async () => {
    const gw = new MockGateway({
      "skills.manage": () => ({ skills: { s: ["plan"] } }),
    })
    const t = await mountNode(<Opener />, { gw, width: 120, height: 60 })
    await walkToSkills(t)
    // Add one chip.
    for (const c of "plan") await act(async () => { await t.keys.typeText(c) })
    await act(async () => { await t.keys.pressTab() })
    await t.settle()
    // Type "xyz" into the filter (no matches, but buffer grows).
    for (const c of "xyz") await act(async () => { await t.keys.typeText(c) })
    // Bksp erases filter char — chip must survive.
    await act(async () => { await t.keys.pressBackspace() })
    await act(async () => { await t.keys.pressBackspace() })
    await act(async () => { await t.keys.pressBackspace() })
    await t.settle()
    await act(async () => { t.keys.pressEnter({ ctrl: true }) })
    await until(t, () => resolved !== undefined)
    expect(resolved!.skills).toEqual(["plan"])
    t.destroy()
  })

})
