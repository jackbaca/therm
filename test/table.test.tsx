import { describe, test, expect } from "bun:test"
import { mountNode } from "./harness"
import { Col, Hdr } from "../src/ui/table"

// These assert on the ui/table primitives directly. Earlier revisions
// drove them through <Toolsets>, which meant any column-layout change
// in that tab broke tests that have nothing to do with the tab.

describe("ui/table", () => {
  test("Col truncates overlong fixed-width content; grow takes remainder", async () => {
    const t = await mountNode(
      <box flexDirection="row" width={40}>
        <Col w={8}>ABCDEFGHIJKLMNOP</Col>
        <Col grow>tail</Col>
      </box>,
      { width: 50, height: 5 },
    )
    await t.settle()
    const line = t.frame().split("\n").find(l => l.includes("ABCDEFGH"))!
    // Clipped at 8 — I/J never paint, next col starts immediately after.
    expect(line).toContain("ABCDEFGHtail")
    expect(line).not.toContain("ABCDEFGHI")
    t.destroy()
  })

  test("Hdr+Col header aligns with body rows across a forced-vbar scrollbox", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => `row-${i}`)
    const t = await mountNode(
      <box flexDirection="column" width={60} height={16}>
        <Hdr>
          <Col w={4}>{""}</Col>
          <Col grow bold>Name</Col>
          <Col w={10} right bold>Count</Col>
        </Hdr>
        <scrollbox scrollY flexGrow={1} verticalScrollbarOptions={{ visible: true }}>
          {rows.map((r, i) => (
            <box key={r} flexDirection="row" height={1}>
              <Col w={4}>{"  "}</Col>
              <Col grow>{r}</Col>
              <Col w={10} right>{String(i)}</Col>
            </box>
          ))}
        </scrollbox>
      </box>,
      { width: 70, height: 20 },
    )
    await t.settle()
    const lines = t.frame().split("\n")
    const hdr = lines.find(l => /Name\s+Count/.test(l))!
    const row = lines.find(l => l.includes("row-0"))!
    expect(hdr.indexOf("Name")).toBe(row.indexOf("row-0"))
    t.destroy()
  })

  test("grow col shrinks under narrow terminal instead of bleeding", async () => {
    const long = "an_extremely_long_value_that_would_overflow_padEnd_sixteen"
    const Fixture = () => (
      <box flexDirection="row" height={1}>
        <Col w={2}>{"● "}</Col>
        <Col grow>{long}</Col>
        <Col w={9} right>3 tools</Col>
        <Col w={11} right>enabled</Col>
      </box>
    )
    const t = await mountNode(<Fixture />, { width: 120, height: 5 })
    await t.settle()
    const row = (f: string) => f.split("\n").find(l => l.includes("● an_extremely"))!

    const wide = t.frame()
    expect(row(wide)).toContain("padEnd_sixteen")
    expect(row(wide)).toContain("3 tools")

    t.resize(50, 5)
    await t.settle(); await t.settle()
    const narrow = t.frame()
    // grow col truncated; fixed meta cols still on the same line; no wrap.
    expect(row(narrow)).not.toContain("padEnd_sixteen")
    expect(row(narrow)).toContain("3 tools")
    expect(row(narrow)).toContain("enabled")
    expect(narrow.split("\n").filter(l => /●.*an_extremely/.test(l)).length).toBe(1)
    t.destroy()
  })

})
