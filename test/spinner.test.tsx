import { describe, test, expect } from "bun:test"
import { mountNode, until } from "./harness"
import { Spinner } from "../src/ui/spinner"

const BRAILLE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/

describe("Spinner", () => {
  test("renders a progress glyph", async () => {
    const t = await mountNode(<Spinner label="fixture" />)
    await until(t, () => BRAILLE.test(t.frame()))
    expect(t.frame().match(BRAILLE)).not.toBeNull()
    t.destroy()
  })
})
