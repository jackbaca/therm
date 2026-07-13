import { expect, test } from "bun:test"
import { getEventListeners } from "node:events"
import { act } from "react"
import { mount, until } from "./harness"

test("tab remounts release renderer selection listeners", async () => {
  await using t = await mount()
  await until(t, () => t.frame().includes("Ready"))
  const count = () => getEventListeners(t.renderer, "selection").length
  const before = count()
  for (let i = 0; i < 20; i++) {
    act(() => t.keys.pressArrow("right", { meta: true }))
    await t.settle()
    act(() => t.keys.pressArrow("left", { meta: true }))
    await t.settle()
  }
  expect(count()).toBe(before)
})
