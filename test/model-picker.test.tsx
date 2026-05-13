import { describe, expect, test } from "bun:test"
import { act } from "react"
import { mountNode, until } from "./harness"
import { useDialog } from "../src/ui/dialog"
import { useGateway } from "../src/context/gateway"
import { openModelPicker } from "../src/dialogs/model-picker"
import { useEffect } from "react"

const Open = () => {
  const d = useDialog()
  const gw = useGateway()
  useEffect(() => { openModelPicker(d, gw) }, [])
  return null
}

const OPTIONS = {
  provider: "anthropic",
  model: "claude-3",
  providers: [
    { slug: "anthropic", name: "Anthropic", is_current: true, total_models: 2, models: ["claude-3", "claude-4"] },
    { slug: "openai", name: "OpenAI", total_models: 1, models: ["gpt-4"] },
  ],
}

describe("model-picker", () => {
  test("session-scoped by default → config.set sends combined arg with session_id; Tab toggles global", async () => {
    const sets: Array<Record<string, unknown>> = []
    const t = await mountNode(<Open />, {
      handlers: {
        "model.options": () => OPTIONS,
        "config.set": (p) => { sets.push(p); return { key: "model", value: p.value } },
      },
    })
    t.gw.setSession("sess-abc")
    await until(t, () => t.frame().includes("Anthropic"))
    expect(t.frame()).toContain("this session")

    // Enter on Anthropic → model step; Enter on claude-3 → apply
    act(() => t.keys.pressEnter()); await t.settle()
    await until(t, () => t.frame().includes("claude-3"))
    act(() => t.keys.pressEnter()); await t.settle()

    expect(sets).toHaveLength(1)
    expect(sets[0]).toMatchObject({
      key: "model",
      value: "claude-3 --provider anthropic",
      session_id: "sess-abc",
    })
    t.destroy()
  })

  test("Tab → global scope omits session_id and appends --global", async () => {
    const sets: Array<Record<string, unknown>> = []
    const t = await mountNode(<Open />, {
      handlers: {
        "model.options": () => OPTIONS,
        "config.set": (p) => { sets.push(p); return { key: "model", value: p.value } },
      },
    })
    t.gw.setSession("sess-abc")
    await until(t, () => t.frame().includes("this session"))

    act(() => t.keys.pressTab()); await t.settle()
    expect(t.frame()).toContain("global")

    act(() => t.keys.pressEnter()); await t.settle()
    await until(t, () => t.frame().includes("claude-3"))
    act(() => t.keys.pressArrow("down")); await t.settle()
    act(() => t.keys.pressEnter()); await t.settle()

    expect(sets).toHaveLength(1)
    expect(sets[0].value).toBe("claude-4 --provider anthropic --global")
    expect(sets[0].session_id).toBeUndefined()
    t.destroy()
  })
})
