import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { ConfirmStep, type InstallResult } from "../src/dialogs/install-distribution"
import type { DistributionManifest } from "../src/service/hermes-profiles"

const manifest: DistributionManifest = {
  name: "my-dist",
  version: "1.0.0",
  description: "A test distribution",
  hermes_requires: "",
  author: "",
  license: "",
  env_requires: [],
  distribution_owned: [],
  source: "",
  installed_at: "",
}

async function open() {
  let result: InstallResult | null | undefined
  let cancelled = false
  const t = await mountNode(
    <ConfirmStep
      source="github.com/owner/repo"
      manifest={manifest}
      onConfirm={(r) => { result = r }}
      onCancel={() => { cancelled = true }}
    />,
    { width: 120, height: 40 },
  )
  return {
    t,
    get result() { return result },
    get cancelled() { return cancelled },
  }
}

describe("install-distribution Confirm step", () => {
  test("Enter submits from alias field with current values", async () => {
    const h = await open()
    const t = h.t
    act(() => t.keys.pressTab()); await t.settle()  // → alias
    act(() => t.keys.pressKey(" ")); await t.settle()  // alias = true
    act(() => t.keys.pressEnter()); await t.settle()
    await until(t, () => h.result !== undefined)
    expect(h.result).toEqual({
      source: "github.com/owner/repo",
      manifest,
      name: null,
      alias: true,
    })
    t.destroy()
  })

  test("Esc cancels", async () => {
    const h = await open()
    act(() => h.t.keys.pressEscape()); await h.t.settle()
    await until(h.t, () => h.cancelled)
    expect(h.cancelled).toBe(true)
    h.t.destroy()
  })
})
