import { describe, expect, test } from "bun:test"
import { renderStyledFrameSvg, type StyledFrame } from "../scripts/styled-screenshot"

describe("styled screenshot SVG renderer", () => {
  test("preserves text, foreground, background, and bold spans", () => {
    const frame: StyledFrame = {
      cols: 4,
      rows: 1,
      lines: [{
        spans: [
          { text: "Hi", width: 2, fg: { r: 255, g: 0, b: 0, a: 1 }, bg: { r: 0, g: 0, b: 255, a: 1 }, attributes: 1 },
          { text: "  ", width: 2, fg: null, bg: null, attributes: 0 },
        ],
      }],
    }

    const svg = renderStyledFrameSvg(frame, { fontSize: 10, lineHeight: 12, charWidth: 6, padding: 0 })
    expect(svg).toContain("<svg")
    expect(svg).toContain("Hi")
    expect(svg).toContain("rgb(255,0,0)")
    expect(svg).toContain("rgb(0,0,255)")
    expect(svg).toContain('font-weight="700"')
    expect(svg).toContain('xml:space="preserve"')
  })
})
