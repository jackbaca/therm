import { describe, test, expect } from "bun:test"
import { mountNode } from "./harness"
import { HintBar } from "../src/ui/hint"

describe("HintBar", () => {
  test("formats structured pairs and suffix", async () => {
    const t = await mountNode(
      <HintBar pairs={[["K", "verb-a"], ["J", "verb-b"]]} suffix="status" />,
      { width: 60, height: 3 },
    )
    expect(t.frame()).toContain("[K] verb-a  [J] verb-b  ·  status")
    t.destroy()
  })

  test("oversized content clips to one row, does not wrap", async () => {
    const long = "fixture ".repeat(20)
    const t = await mountNode(<HintBar raw={long} />, { width: 30, height: 3 })
    const f = t.frame()
    const nonEmpty = f.split("\n").filter(l => l.trim()).length
    expect(nonEmpty).toBe(1)
    t.destroy()
  })
})
