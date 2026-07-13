import { describe, test, expect, beforeEach } from "bun:test"
import { count, clearCache, formatTokens } from "../src/utils/tokens"

describe("tokens.count", () => {
  beforeEach(clearCache)

  test("empty string → 0", () => {
    expect(count("")).toBe(0)
  })

  test("prose — short English text", () => {
    const n = count("The quick brown fox jumps over the lazy dog")
    // o200k_base ~9-10 tokens for this sentence.
    expect(n).toBeGreaterThan(5)
    expect(n).toBeLessThan(15)
  })

  test("returns a number for JSON / schema-like content", () => {
    // Real tool schemas trend LOWER than chars/4 because JSON keys and
    // structural tokens (\"type\", \"properties\", etc.) are single-token
    // even at 8-12 chars. The point is accuracy, not a fixed direction.
    const json = JSON.stringify({
      name: "file_write",
      description: "Write content to a file.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
    })
    const n = count(json)
    const rough = Math.ceil(json.length / 4)
    // Must be different from the rough heuristic (that\'s the whole point)
    expect(n).not.toBe(rough)
    expect(n).toBeGreaterThan(0)
  })

  test("CJK — tokenizer counts more accurately than chars/4", () => {
    // CJK chars are 1-3 tokens each; chars/4 massively undercounts.
    const text = "你好世界你好世界你好世界你好世界你好世界"
    const tokens = count(text)
    const roughFour = Math.ceil(text.length / 4)
    expect(tokens).toBeGreaterThan(roughFour)
  })

})

describe("tokens.formatTokens", () => {
  test("under 1000 → bare number", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(42)).toBe("42")
    expect(formatTokens(999)).toBe("999")
  })

  test("1k–10k → 1-decimal K", () => {
    expect(formatTokens(1_000)).toBe("1.0K")
    expect(formatTokens(1_500)).toBe("1.5K")
    expect(formatTokens(9_999)).toBe("10.0K")
  })

  test("10k–1M → integer K", () => {
    expect(formatTokens(10_000)).toBe("10K")
    expect(formatTokens(258_000)).toBe("258K")
    expect(formatTokens(999_499)).toBe("999K")
  })

  test("≥1M → M, one decimal unless whole", () => {
    expect(formatTokens(1_000_000)).toBe("1M")
    expect(formatTokens(1_200_000)).toBe("1.2M")
    expect(formatTokens(2_000_000)).toBe("2M")
    expect(formatTokens(1_234_567)).toMatch(/^1\.2M$/)
  })

  test("negative / NaN / Infinity → '0'", () => {
    expect(formatTokens(-1)).toBe("0")
    expect(formatTokens(NaN)).toBe("0")
    expect(formatTokens(Infinity)).toBe("0")
  })
})
