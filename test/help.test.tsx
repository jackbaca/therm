import { afterEach, describe, expect, test } from "bun:test"
import { mountNode, until, type Harness } from "./harness"
import { HelpDialog } from "../src/dialogs/help"
import * as prefs from "../src/context/preferences"

describe("HelpDialog", () => {
  afterEach(() => prefs.reset())

  test("projects user overrides instead of defaults", async () => {
    prefs.set("keys", { "tab.next": "ctrl+n", "reply.copy": "none" })
    const t: Harness = await mountNode(<HelpDialog />, { width: 120, height: 60 })
    await until(t, () => t.frame().includes("Keyboard Shortcuts"))
    const f = t.frame()
    expect(f).toContain("Ctrl+N")
    expect(f).not.toContain("Alt+→")
    t.destroy()
  })
})
