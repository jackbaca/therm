import { describe, expect, test, beforeEach } from "bun:test"
import { mountNode, until, type Harness } from "./harness"
import { Gutter, list, register, _reset } from "../src/plugins"

// Isolate across tests. The registry is a module singleton and the
// bundled `demo.clock` side-imports on first load.
beforeEach(() => {
  _reset()
  register({
    id: "test.hello",
    name: "Hello",
    gutter: () => <text>hello-gutter</text>,
  })
})

describe("Gutter", () => {
  test("renders the first non-null plugin output", async () => {
    const t: Harness = await mountNode(
      <Gutter sid="" tab={0} streaming={false} />,
      { width: 40, height: 3 },
    )
    await until(t, () => t.frame().includes("hello-gutter"))
    expect(t.frame()).toContain("hello-gutter")
    t.destroy()
  })

  test("skips plugins whose gutter returns null", async () => {
    register({ id: "test.hidden", name: "Hidden", gutter: () => null })
    // Re-order: put Hidden first by resetting and re-registering.
    _reset()
    register({ id: "test.hidden", name: "Hidden", gutter: () => null })
    register({
      id: "test.visible",
      name: "Visible",
      gutter: () => <text>visible-one</text>,
    })
    const t: Harness = await mountNode(
      <Gutter sid="" tab={0} streaming={false} />,
      { width: 40, height: 3 },
    )
    await until(t, () => t.frame().includes("visible-one"))
    expect(t.frame()).toContain("visible-one")
    t.destroy()
  })

  test("renders nothing when no plugin produces output", async () => {
    _reset()
    register({ id: "test.a", name: "A", gutter: () => null })
    const t: Harness = await mountNode(
      <Gutter sid="" tab={0} streaming={false} />,
      { width: 40, height: 3 },
    )
    // Frame should not contain any of our test markers.
    expect(t.frame()).not.toContain("hello-gutter")
    expect(t.frame()).not.toContain("visible-one")
    t.destroy()
  })

  test("register is idempotent on id", () => {
    _reset()
    register({ id: "dup", name: "One", gutter: () => null })
    register({ id: "dup", name: "Two", gutter: () => null })
    expect(list().length).toBe(1)
    expect(list()[0].name).toBe("One")
  })
})
