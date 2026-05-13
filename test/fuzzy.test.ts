import { describe, expect, test } from "bun:test"
import { score } from "../src/utils/fuzzy"
import { rank } from "../src/app/useSlashPopover"
import type { SlashCommand } from "../src/app/slashCommands"

describe("fuzzy score", () => {
  test("subsequence matches return > 0", () => {
    expect(score("mdl", "model")).toBeGreaterThan(0)
    expect(score("rs", "resume")).toBeGreaterThan(0)
    expect(score("rlb", "rollback")).toBeGreaterThan(0)
  })

  test("non-subsequence returns <= 0", () => {
    expect(score("xyz", "model")).toBeLessThanOrEqual(0)
    expect(score("mdx", "model")).toBeLessThanOrEqual(0)
    expect(score("", "model")).toBeLessThanOrEqual(0)
  })

  test("case-insensitive", () => {
    expect(score("MDL", "Model")).toBeGreaterThan(0)
    expect(score("mdl", "MODEL")).toBeGreaterThan(0)
  })

  test("prefix beats scattered subsequence", () => {
    expect(score("mod", "model")).toBeGreaterThan(score("mdl", "model"))
    expect(score("re", "resume")).toBeGreaterThan(score("rs", "resume"))
  })

  test("word-boundary hit beats mid-word hit", () => {
    expect(score("m", "reload-mcp")).toBeGreaterThan(score("m", "resume"))
    expect(score("sp", "SlashPopover")).toBeGreaterThan(score("sp", "grasp"))
  })

  test("start-of-string beats later boundary", () => {
    expect(score("m", "model")).toBeGreaterThan(score("m", "reload-mcp"))
  })
})

describe("fuzzy rank", () => {
  const cmd = (name: string, aliases: string[] = []): SlashCommand => ({
    name, description: "", category: "Session", aliases, argsHint: "",
    subcommands: [], source: "command", target: "gateway",
  })

  const list = [
    cmd("model"),
    cmd("resume"),
    cmd("rollback"),
    cmd("memory"),
    cmd("reload-mcp"),
  ]

  test("mdl → model first", () => {
    expect(rank(list, "mdl")[0].name).toBe("model")
  })

  test("rs → resume first", () => {
    expect(rank(list, "rs")[0].name).toBe("resume")
  })

  test("prefix outranks fuzzy: 'me' → memory before model", () => {
    const r = rank(list, "me").map(c => c.name)
    expect(r[0]).toBe("memory")
    expect(r).toContain("model")
    expect(r.indexOf("memory")).toBeLessThan(r.indexOf("model"))
  })

  test("drops non-matches", () => {
    expect(rank(list, "zzz")).toHaveLength(0)
  })

  test("empty query returns full list unchanged", () => {
    expect(rank(list, "").map(c => c.name)).toEqual(list.map(c => c.name))
  })

  test("matches via alias", () => {
    const r = rank([cmd("new", ["reset"]), cmd("resume")], "rst")
    expect(r[0].name).toBe("new")
  })
})
