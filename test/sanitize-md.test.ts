import { describe, expect, test } from "bun:test"
import { sanitizeLinks } from "../src/utils/sanitize-md"

describe("sanitizeLinks — inline links", () => {
  test("escapes link whose dest has no terminal-openable scheme", () => {
    expect(sanitizeLinks("see [here](#anchor) for more"))
      .toBe("see [here]\\(#anchor) for more")
    expect(sanitizeLinks("[rel](./path/to/file.md)"))
      .toBe("[rel]\\(./path/to/file.md)")
    expect(sanitizeLinks("call [set](arg) now"))
      .toBe("call [set]\\(arg) now")
  })

  test("preserves link whose dest has an openable scheme", () => {
    expect(sanitizeLinks("[x](https://example.com)"))
      .toBe("[x](https://example.com)")
    expect(sanitizeLinks("[x](http://a.b/c?d=1)"))
      .toBe("[x](http://a.b/c?d=1)")
    expect(sanitizeLinks("[x](file:///tmp/y)"))
      .toBe("[x](file:///tmp/y)")
    expect(sanitizeLinks("[x](mailto:a@b.c)"))
      .toBe("[x](mailto:a@b.c)")
  })

  test("scheme check is case-insensitive", () => {
    expect(sanitizeLinks("[x](HTTPS://example.com)"))
      .toBe("[x](HTTPS://example.com)")
  })

  test("handles multiple links, mixed validity", () => {
    expect(sanitizeLinks("[a](https://x) and [b](#y) and [c](mailto:z@z)"))
      .toBe("[a](https://x) and [b]\\(#y) and [c](mailto:z@z)")
  })

  test("leaves prose brackets without paren-dest alone", () => {
    expect(sanitizeLinks("array[0] and [citation needed]"))
      .toBe("array[0] and [citation needed]")
  })
})

describe("sanitizeLinks — autolinks", () => {
  test("strips angle brackets around schemed autolinks", () => {
    expect(sanitizeLinks("go to <https://example.com> now"))
      .toBe("go to https://example.com now")
    expect(sanitizeLinks("<mailto:a@b.c>")).toBe("mailto:a@b.c")
  })

  test("leaves non-scheme angle brackets alone", () => {
    expect(sanitizeLinks("use <div> or <span>"))
      .toBe("use <div> or <span>")
    expect(sanitizeLinks("<#anchor>")).toBe("<#anchor>")
  })
})

describe("sanitizeLinks — code spans", () => {
  test("skips inline-code spans entirely", () => {
    expect(sanitizeLinks("run `[x](#a)` then [y](#b)"))
      .toBe("run `[x](#a)` then [y]\\(#b)")
    expect(sanitizeLinks("``[a](b)`` and `<https://x>`"))
      .toBe("``[a](b)`` and `<https://x>`")
  })

  test("code span at start, end, and adjacent", () => {
    expect(sanitizeLinks("`[a](b)`[c](#d)`[e](f)`"))
      .toBe("`[a](b)`[c]\\(#d)`[e](f)`")
  })
})

describe("sanitizeLinks — bail / identity", () => {
  test("returns input unchanged when no link-ish syntax present", () => {
    const s = "plain prose with (parens) and backticks `x`"
    expect(sanitizeLinks(s)).toBe(s)
  })

  test("bare brackets and bare angles are identity", () => {
    expect(sanitizeLinks("[")).toBe("[")
    expect(sanitizeLinks("<")).toBe("<")
  })
})
