import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { eikon } from "../src/service/eikon"
import { knobs } from "../src/utils/eikon-knobs"
import { native, caps, type Rasterizer } from "../src/utils/eikon-render"
import { parseEikon } from "../src/components/avatar/eikon"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!
if (!HH || HH.includes("/.hermes")) throw new Error("sandbox not applied")

describe("service/eikon: layout", () => {
  test("ensure creates folder form", () => {
    const p = eikon.ensure("foo")
    expect(p.dir).toBe(join(HH, "eikons", "foo"))
    expect(existsSync(p.source)).toBe(true)
  })

  test("adopt + findSource: base → idle → first; per-state wins", () => {
    writeFileSync(join(HH, "ext.png"), "png")
    const f = eikon.adopt("foo", join(HH, "ext.png"))
    expect(f).toBe("base.png")
    expect(eikon.findSource("foo")).toBe(join(HH, "eikons", "foo", "source", "base.png"))
    writeFileSync(join(HH, "eikons", "foo", "source", "error.jpg"), "j")
    expect(eikon.findSource("foo", "error")).toMatch(/error\.jpg$/)
    expect(eikon.findSource("foo", "idle")).toMatch(/base\.png$/)
  })

  test("studio.json round-trip", () => {
    const s = knobs.fresh("foo", native)
    eikon.writeStudio("foo", knobs.toStudio(s))
    const r = eikon.readStudio("foo")!
    expect(r.rasterizer).toBe("native")
    expect(r.glyph).toBe("◆")
  })

  test("list returns folder-form only; header source_url surfaces", () => {
    writeFileSync(eikon.file("foo"), JSON.stringify({ eikon: 1, name: "foo", source_url: "http://x/foo/" }) + "\n")
    eikon.ensure("bar"); writeFileSync(eikon.file("bar"), '{"eikon":1,"name":"bar"}\n')
    writeFileSync(join(HH, "eikons", "flat.eikon"), "{}")
    const xs = eikon.list()
    const names = xs.map(x => x.name)
    expect(names).toContain("foo"); expect(names).toContain("bar")
    expect(names).not.toContain("flat")
    expect(xs.find(x => x.name === "foo")!.hasSource).toBe(true)
    expect(xs.find(x => x.name === "foo")!.sourceUrl).toBe("http://x/foo/")
  })
})

describe("service/eikon: registry", () => {
  test("built-ins present; register/unregister; pick prefers available", () => {
    expect(eikon.rasterizers().map(r => r.name)).toEqual(["chafa", "native"])
    const fake: Rasterizer = {
      name: "fake", knobs: {},
      available: () => true, render: async () => ({ frames: [[""]] }),
    }
    let pinged = 0
    const off = eikon.onRegistry(() => pinged++)
    const un = eikon.register(fake)
    expect(eikon.rasterizer("fake")).toBe(fake)
    expect(pinged).toBe(1)
    un()
    expect(eikon.rasterizer("fake")).toBeUndefined()
    off()
    // pick: unavailable prefer → first available
    expect(eikon.pick("nope").available()).toBe(true)
  })
})

describe("service/eikon: save", () => {
  const run = caps.ffmpeg ? test : test.skip
  run("save writes .eikon + studio.json + pref + revision", async () => {
    const before = eikon.revision()
    eikon.ensure("pack")
    // Valid 16×16 gray PNG via ffmpeg so native can decode it.
    const png = join(HH, "eikons", "pack", "source", "base.png")
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "color=gray:s=16x16", "-frames:v", "1", "-y", png])
    writeFileSync(eikon.file("pack"), JSON.stringify({ eikon: 1, name: "pack", source_url: "http://x/pack/" }) + "\n")
    const s = knobs.fresh("pack", native, eikon.readStudio("pack"))
    s.sources = { base: "base.png" }
    const out = await eikon.save(s)
    expect(out).toBe(eikon.file("pack"))
    expect(prefs.get("eikonPath")).toBe(out)
    expect(eikon.revision()).toBe(before + 1)
    const doc = parseEikon(readFileSync(out, "utf8"))
    expect(doc.meta.width).toBe(48)
    expect(doc.states.size).toBe(6)
    // source_url header survives a save.
    expect(eikon.header(out)!.source_url).toBe("http://x/pack/")
  })

  test("save with no source writes glyph placeholder frames", async () => {
    eikon.ensure("empty"); writeFileSync(eikon.file("empty"), '{"eikon":1,"name":"empty"}\n')
    const s = knobs.fresh("empty", native)
    const out = await eikon.save(s)
    const doc = parseEikon(readFileSync(out, "utf8"))
    expect(doc.states.get("idle")!.frames[0]!.join("")).toContain("◆")
  })
})

describe("service/eikon: fetchSource", () => {
  test("pulls manifest + files via Bun.serve fixture", async () => {
    const srv = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url)
        if (u.pathname.endsWith("manifest.json"))
          return Response.json({ files: ["base.png"] })
        if (u.pathname.endsWith("base.png"))
          return new Response(new Uint8Array([137, 80, 78, 71]))
        return new Response("404", { status: 404 })
      },
    })
    const url = `http://localhost:${srv.port}/x/`
    eikon.ensure("bundled")
    writeFileSync(eikon.file("bundled"), JSON.stringify({ eikon: 1, name: "bundled", source_url: url }) + "\n")
    const n = await eikon.fetchSource("bundled", url)
    expect(n).toBe(1)
    expect(existsSync(join(eikon.sourceDir("bundled"), "base.png"))).toBe(true)
    srv.stop()
  })
})

afterAll(() => { void HH })
