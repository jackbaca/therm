import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { runtimeDescriptor } from "eikon"
import { parseEikon, parseEikonFile, listEikons } from "../src/components/avatar/eikon"
import { bundledEikonPath } from "../src/components/avatar/bundled"

const LEGACY = readFileSync(join(import.meta.dir, "fixtures/eikon/mono-v1.6.0-extract.eikon"), "utf8")

const LAUNCH_FIXTURE = [
  JSON.stringify({
    type: "header",
    eikon: 1,
    id: "test/tiny-launch",
    version: "1.0.0",
    title: "tiny launch",
    author: { name: "t" },
    size: { cols: 3, rows: 2 },
    defaultSignal: "state.idle",
    signals: {
      "state.idle": { clip: "idle" },
      "state.error": { clip: "error", fallback: "state.idle" },
    },
  }),
  JSON.stringify({ type: "clip", name: "idle", fps: 8, frameCount: 2, loopFrom: 0 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: [" o ", "/|\\"] }),
  JSON.stringify({ type: "frame", clip: "idle", index: 1, rows: [" O ", "/|\\"] }),
  JSON.stringify({ type: "clip", name: "error", fps: 4, frameCount: 1, loopFrom: 1 }),
  JSON.stringify({ type: "frame", clip: "error", index: 0, rows: [" x ", "/|\\"] }),
].join("\n")

describe("parseEikon", () => {
  test("parses header + states + frames", () => {
    expect(new Bun.CryptoHasher("sha256").update(LEGACY).digest("hex"))
      .toBe("6f4b6c159ddd5cabfc3ba9ff62a8480eb3c717ae94f6bd5c3d8a2e4f1ec2c302")
    const e = parseEikon(LEGACY)
    expect(e.meta.name).toBe("mono")
    expect(e.meta.version).toBe(1)
    expect(e.meta.width).toBe(48)
    expect(e.meta.states).toEqual(["idle"])
    expect(e.states.size).toBe(1)
    const idle = e.states.get("idle")!
    expect(idle.fps).toBe(16)
    expect(idle.frames).toHaveLength(2)
    expect(idle.loopFrom).toBe(0)
  })

  test("throws with line number on malformed JSON", () => {
    const bad = LEGACY.split("\n")
    bad[2] = "{not json"
    expect(() => parseEikon(bad.join("\n"))).toThrow(/line 3/)
  })



  test("parses launch-format streams", () => {
    const e = parseEikon(LAUNCH_FIXTURE)
    expect(e.meta.name).toBe("tiny launch")
    expect(e.meta.version).toBe(1)
    expect(e.meta.width).toBe(3)
    expect(e.meta.height).toBe(2)
    expect(e.states.has("idle")).toBe(true)
    expect(e.states.get("idle")!.frames[0]).toEqual([" o ", "/|\\"])
    expect(e.states.get("error")!.loopFrom).toBe(1)
  })

  test("parses gzip runtime files", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-gzip-"))
    const info = runtimeDescriptor(LAUNCH_FIXTURE, { encoding: "gzip" })
    const p = join(dir, "tiny.eikon")
    writeFileSync(p, info.bytes)

    const e = parseEikonFile(p)

    expect(e.meta.name).toBe("tiny launch")
    expect(e.states.get("idle")!.frames[0]).toEqual([" o ", "/|\\"])
  })
})

describe("listEikons", () => {
  test("scans dirs, parses header only, skips missing dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    writeFileSync(join(dir, "a.eikon"), LEGACY)
    writeFileSync(join(dir, "skip.txt"), "nope")
    const found = listEikons([dir, "/does/not/exist"])
    expect(found).toHaveLength(1)
    expect(found[0].meta.name).toBe("mono")
    expect(found[0].meta.states).toEqual(["idle"])
    expect(found[0].path).toContain("a.eikon")
  })

  test("prefers package manifest entrypoint over sibling non-entrypoint streams", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-"))
    writeFileSync(join(dir, "standalone.eikon"), LEGACY)
    const pkg = join(dir, "pkg")
    mkdirSync(pkg)
    writeFileSync(join(pkg, "manifest.json"), JSON.stringify({
      kind: "eikon.package",
      schemaVersion: "1.0",
      id: "test/pkg",
      name: "pkg",
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "streams/pkg.eikon" },
      files: [{ path: "streams/pkg.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl" }],
    }))
    mkdirSync(join(pkg, "streams"))
    writeFileSync(join(pkg, "streams", "pkg.eikon"), LAUNCH_FIXTURE)
    writeFileSync(join(pkg, "pkg.eikon"), LEGACY)
    writeFileSync(join(pkg, "extra.eikon"), LAUNCH_FIXTURE)

    const found = listEikons([dir])
    const paths = found.map(e => e.path)
    expect(paths.some(p => p.endsWith("standalone.eikon"))).toBe(true)
    expect(paths.some(p => p.endsWith("streams/pkg.eikon"))).toBe(true)
    expect(paths.some(p => p.endsWith("pkg/pkg.eikon"))).toBe(false)
    expect(paths.some(p => p.endsWith("extra.eikon"))).toBe(false)
  })

  test("scans gzip runtime package entrypoints", () => {
    const dir = mkdtempSync(join(tmpdir(), "eikon-gzip-list-"))
    const info = runtimeDescriptor(LAUNCH_FIXTURE, { encoding: "gzip" })
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      kind: "eikon.package",
      schemaVersion: "1.0",
      id: "test/gzip",
      name: "gzip",
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "streams/gzip.eikon" },
      files: [{
        path: "streams/gzip.eikon",
        role: "runtime",
        mediaType: "application/vnd.eikon.stream+jsonl",
        encoding: "gzip",
        size: info.size,
        digest: info.digest,
        decodedSize: info.decodedSize,
        decodedDigest: info.decodedDigest,
      }],
    }))
    mkdirSync(join(dir, "streams"))
    writeFileSync(join(dir, "streams", "gzip.eikon"), info.bytes)

    const found = listEikons([dir])

    expect(found).toHaveLength(1)
    expect(found[0].meta.name).toBe("tiny launch")
  })

  test("bundled eikons ship only Nous as a package runtime stream", () => {
    const p = bundledEikonPath("nous")!
    expect(bundledEikonPath("default")).toBe(p)
    expect(p).toEndWith("nous.eikon")
    expect(existsSync(join(dirname(p), "manifest.json"))).toBe(true)
    const man = JSON.parse(readFileSync(join(dirname(p), "manifest.json"), "utf8"))
    expect(man.id).toBe("liftaris/nous")
    expect(man.name).toBe("nous")
    expect(man.version).toBe("1.0.0")
    expect(man.origin.identityKey).toBe("registry:eikon.liftaris.dev:liftaris/nous@1.0.0")
    expect(man.origin.packageUrl).toBe("https://eikon.liftaris.dev/packages/liftaris/nous/1.0.0.json")
    const e = parseEikonFile(p)
    expect(e.meta.width).toBe(48)
    expect(e.states.has("idle")).toBe(true)
    const found = listEikons([join(import.meta.dir, "../assets/eikons")])
    expect(found).toHaveLength(1)
    expect(found.filter(e => e.meta.name.toLowerCase() === "nous")).toHaveLength(1)
    expect(found.every(e => e.path.endsWith(".eikon"))).toBe(true)
  })
})
