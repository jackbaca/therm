import { describe, expect, test } from "bun:test"
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import * as layout from "../src/plugins/bundled/eikon-studio/layout"
import { hermesPath } from "../src/service/hermes-home"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

describe("eikon layout", () => {
  test("ensure / file / source resolve to <name>/ folder form", () => {
    const p = layout.ensure("foo")
    expect(p.dir).toBe(join(HH, "eikons", "foo"))
    expect(p.file).toBe(join(HH, "eikons", "foo", "foo.eikon"))
    expect(p.source).toBe(join(HH, "eikons", "foo", "source"))
    expect(existsSync(p.source)).toBe(true)
  })

  test("adopt copies external file as base.<ext>; findSource prefers base → idle → first image", () => {
    const tmp = join(HH, "external.png")
    writeFileSync(tmp, "png-bytes")
    const dst = layout.adopt("foo", tmp)
    expect(dst).toBe(join(HH, "eikons", "foo", "source", "base.png"))
    expect(readFileSync(dst, "utf8")).toBe("png-bytes")
    expect(layout.findSource("foo")).toBe(dst)

    // idle.jpg present but base.* wins
    writeFileSync(join(HH, "eikons", "foo", "source", "idle.jpg"), "x")
    expect(layout.findSource("foo")).toBe(dst)
  })

  test("list returns folder-form eikons only; flags hasSource", () => {
    writeFileSync(layout.file("foo"), '{"eikon":1,"name":"foo"}\n')
    // Legacy flat file should not appear in list()
    writeFileSync(join(hermesPath("eikons"), "legacy.eikon"), "{}")
    // Empty-source folder
    layout.ensure("bar")
    writeFileSync(layout.file("bar"), '{"eikon":1,"name":"bar"}\n')

    const xs = layout.list().sort((a, b) => a.name.localeCompare(b.name))
    const names = xs.map(x => x.name)
    expect(names).toContain("foo")
    expect(names).toContain("bar")
    expect(names).not.toContain("legacy")
    expect(xs.find(x => x.name === "foo")!.hasSource).toBe(true)
    expect(xs.find(x => x.name === "bar")!.hasSource).toBe(false)
  })
})
