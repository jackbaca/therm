import { describe, expect, test, beforeEach } from "bun:test"
import { rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { frecency } from "../src/app/frecency"
import { configDir } from "../src/utils/paths"

describe("frecency", () => {
  beforeEach(() => {
    rmSync(join(configDir(), "frecency.jsonl"), { force: true })
    frecency._reset()
  })

  test("score is 0 for unknown, bump raises it, recency decays", () => {
    expect(frecency.score("@file:a.ts")).toBe(0)
    frecency.bump("@file:a.ts")
    const s1 = frecency.score("@file:a.ts")
    expect(s1).toBeGreaterThan(0)
    frecency.bump("@file:a.ts")
    expect(frecency.score("@file:a.ts")).toBeGreaterThan(s1)
    // Frequency wins over a single recent bump at same age.
    frecency.bump("@file:b.ts")
    expect(frecency.score("@file:a.ts")).toBeGreaterThan(frecency.score("@file:b.ts"))
  })

  test("load compacts append-only log to newest-per-path", () => {
    mkdirSync(configDir(), { recursive: true })
    const now = Date.now()
    writeFileSync(join(configDir(), "frecency.jsonl"),
      [
        JSON.stringify({ path: "@file:x", n: 1, at: now - 1000 }),
        JSON.stringify({ path: "@file:x", n: 3, at: now }),
        "not json",
        JSON.stringify({ path: "@file:y", n: 2, at: now - 86_400_000 * 10 }),
      ].join("\n") + "\n")
    frecency._reset()
    // x: n=3, ~0 days → ~3.  y: n=2, 10 days → 2/11 ≈ 0.18
    expect(frecency.score("@file:x")).toBeGreaterThan(2.5)
    expect(frecency.score("@file:y")).toBeLessThan(0.5)
    expect(frecency.score("@file:y")).toBeGreaterThan(0)
  })
})
