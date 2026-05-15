import { describe, test, expect } from "bun:test"
import { act } from "react"
import { useState } from "react"
import { mountNode } from "./harness"
import { Tail } from "../src/components/chat/ThoughtCloud"

// Tail animates by mutating span .children out of React's view. The
// `run` prop toggle forces a React reconcile of the span subtree;
// this asserts that path doesn't throw "Child not found in children"
// (the failure mode when React's cached child ref has been replaced
// — see ui/table Marquee history for why scrollX is safer there).

describe("ThoughtCloud/Tail (ref-mutation animation)", () => {
  test("run toggle survives reconcile; idle shows all slots; running hides some", async () => {
    let setRun: (v: boolean) => void = () => {}
    const Fix = () => {
      const [r, set] = useState(false)
      setRun = set
      return <Tail run={r} />
    }
    const t = await mountNode(<Fix />, { width: 20, height: 10 })
    await t.settle()
    expect(t.frame()).toContain("╭┄┄╮")
    expect(t.frame()).toContain("╶")

    act(() => setRun(true))
    await t.settle()
    await act(async () => { await Bun.sleep(400) })
    await t.settle()
    const lit = t.frame().split("\n").filter(l => /[╭╮╰╯╶]/.test(l)).length
    expect(lit).toBeLessThan(6)

    act(() => setRun(false))
    await t.settle()
    expect(t.frame()).toContain("╭┄┄╮")
    expect(t.frame()).toContain("╶")
    t.destroy()
  })
})
