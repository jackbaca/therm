import { beforeEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decodeRuntimeFile, runtimeDescriptor } from "eikon"
import { mountNode, until, type Harness } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
import { eikon } from "../src/service/eikon"
import * as submit from "../src/service/eikon-submit"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!

function seed(name: string, opts: { published?: boolean } = {}) {
  const p = eikon.ensure(name)
  const raw = decodeRuntimeFile(join(import.meta.dir, "../assets/eikons/nous/nous.eikon"))
  const lines = raw.trimEnd().split("\n")
  return Promise.resolve().then(() => {
    const baseHead = JSON.parse(lines[0]!)
    const head = { ...baseHead, id: `liftaris/${name}`, title: name, author: { name: "kaio" } }
    writeFileSync(eikon.file(name), JSON.stringify(head) + "\n" + lines.slice(1).join("\n") + "\n")
    mkdirSync(join(p.dir, "source"), { recursive: true })
    writeFileSync(join(p.dir, "source", "base.png"), "png")
    const manifest = { name, version: 1, source: "source/base.png", states: { idle: { file: "source/base.png" } }, ...(opts.published ? { origin: { source: "https://catalog.example/eikons/draft", at: "2026-05-31T00:00:00Z" } } : {}) }
    writeFileSync(join(p.dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
    prefs.set("eikon", name)
  })
}

async function selectDraft(t: Harness) {
  await until(t, () => t.frame().includes("draft"))
  for (let i = 0; i < 20; i++) {
    if (t.frame().includes("Preview — draft")) return
    act(() => t.keys.pressArrow("down"))
    await t.settle()
  }
  throw new Error(`draft row not selectable\n${t.frame()}`)
}

async function open(t: Harness) {
  await selectDraft(t)
  act(() => t.keys.pressKey("s"))
  await until(t, () => t.frame().includes("Submit eikon"))
}

async function stage(t: Harness) {
  act(() => t.keys.pressEnter())
  await until(t, () => t.frame().includes("Registry preflight"))
}

async function consent(t: Harness) {
  await t.settle()
}

function meta() {
  return { title: "draft", author: "kaio", description: "demo", glyph: "◆" }
}

describe("Eikon submit dialog", () => {
  beforeEach(() => {
    prefs.set("eikon", undefined)
    rmSync(join(HH, "eikons"), { recursive: true, force: true })
  })

  test("Enter runs registry preflight before backend invocation", async () => {
    await seed("draft")
    const fn = mock(async (_input: submit.PreparedSubmit) => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    expect(t.frame()).toContain("draft.eikon")
    expect(t.frame()).toContain("package manifest")
    expect(t.frame()).toContain("files prepared for registry review")
    expect(fn).not.toHaveBeenCalled()
  })

  test("published marketplace installs are blocked from duplicate submission", async () => {
    await seed("draft", { published: true })
    const fn = mock(async (_input: submit.PreparedSubmit) => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await selectDraft(t)
    act(() => t.keys.pressKey("s"))
    await until(t, () => t.frame().includes("Create a local draft before submitting"))
    expect(t.frame()).not.toContain("Submit eikon")
    expect(fn).not.toHaveBeenCalled()
  })

  test("metadata fields use arrows, not Tab", async () => {
    await seed("draft")
    const fn = mock(async (_input: submit.PreparedSubmit) => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await until(t, () => t.frame().includes("↑↓ field") && /▸ title/.test(t.frame()))

    act(() => t.keys.pressTab())
    await t.settle()
    expect(t.frame()).toMatch(/▸ title/)
    expect(t.frame()).not.toMatch(/▸ author/)

    act(() => t.keys.pressArrow("down"))
    await until(t, () => /▸ author/.test(t.frame()))
    act(() => t.keys.pressArrow("down"))
    await until(t, () => /▸ description/.test(t.frame()))
    act(() => t.keys.pressArrow("up"))
    await until(t, () => /▸ author/.test(t.frame()))
  })

  test("preflight preview lists safe included files and omits secret symlink escapes", async () => {
    await seed("draft")
    const root = eikon.dir("draft")
    writeFileSync(join(root, "README.md"), "ok")
    writeFileSync(join(root, ".env"), "TOKEN=***")
    writeFileSync(join(HH, "escape.txt"), "outside")
    symlinkSync(join(HH, "escape.txt"), join(root, "source", "escape.txt"))
    const seen = await submit.prepare({ path: eikon.file("draft"), meta: meta(), includeSource: true })
    const paths = seen.files.map(f => f.path)
    expect(paths).toContain("eikons/draft/source/base.png")
    expect(paths).toContain("eikons/draft/manifest.json")
    expect(paths).not.toContain(".env")
    expect(paths).not.toContain("source/escape.txt")
    const fn = mock(async (_input: submit.PreparedSubmit) => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/7", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 180, height: 60 })
    await open(t)
    await stage(t)
    expect(t.frame()).toContain("Registry preflight")
    expect(t.frame()).not.toContain(".env")
    expect(t.frame()).not.toContain("escape.txt")
    expect(fn).not.toHaveBeenCalled()
    await consent(t)
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("submitted and is being reviewed"))
    expect(fn).toHaveBeenCalledTimes(1)
    expect((fn.mock.calls[0]?.[0] as submit.PreparedSubmit).path).toBe(eikon.file("draft"))
  })

  test("metadata validation rejects secrets and private URLs before staging", async () => {
    await seed("draft")

    await expect(submit.prepare({
      path: eikon.file("draft"),
      meta: { title: "draft", author: "kaio", description: "token ghp_secret", glyph: "◆" },
    })).rejects.toThrow(/description looks secret-like/)

    for (const url of ["http://172.16.0.1", "http://169.254.169.254", "http://[::1]"]) {
      await expect(submit.prepare({
        path: eikon.file("draft"),
        meta: { title: "draft", author: "kaio", description: url, glyph: "◆" },
      })).rejects.toThrow(/description contains private or unsafe URL/)
    }
  })

  test("runtime filename must match Eikon metadata name", async () => {
    await seed("draft")
    const wrong = join(eikon.dir("draft"), "wrongfile.eikon")
    writeFileSync(wrong, readFileSync(eikon.file("draft")))

    await expect(submit.prepare({ path: wrong, meta: meta() }))
      .rejects.toThrow(/runtime filename must match eikon name: expected draft\.eikon/)
  })

  test("runtime metadata public scan rejects private URLs before staging", async () => {
    await seed("draft")
    const lines = readFileSync(eikon.file("draft"), "utf8").trimEnd().split("\n")
    const head = JSON.parse(lines[0]!)
    head.description = "debug endpoint http://127.0.0.1/internal"
    writeFileSync(eikon.file("draft"), `${JSON.stringify(head)}\n${lines.slice(1).join("\n")}\n`)

    await expect(submit.prepare({ path: eikon.file("draft"), meta: meta() }))
      .rejects.toThrow(/draft\.eikon contains private or unsafe URL/)
  })

  test("submit revalidates staged bundle before backend create", async () => {
    await seed("draft")
    const prepared = await submit.prepare({ path: eikon.file("draft"), meta: meta() })
    writeFileSync(prepared.bundle.files.find(f => f.path === "eikons/draft/manifest.json")!.abs, "tampered")

    const fn = mock(async (_req: import("eikon").SubmitRequest) => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: _req }))
    const backend: import("eikon").SubmitBackend = {
      async check() { return { ok: true as const } },
      create: fn,
    }

    const res = await submit.submit(prepared, backend)

    expect(res.kind).toBe("validation-failed")
    expect(fn).not.toHaveBeenCalled()
  })

  test("staged public manifest drops unknown source manifest fields and uses display metadata", async () => {
    await seed("draft")
    writeFileSync(join(eikon.dir("draft"), "manifest.json"), JSON.stringify({
      name: "draft", version: 1, source: "source/base.png", states: { idle: { file: "source/base.png" } }, notes: "token ***",
    }, null, 2) + "\n")

    const prepared = await submit.prepare({ path: eikon.file("draft"), meta: meta(), includeSource: true })
    const man = JSON.parse(await Bun.file(prepared.bundle.files.find(f => f.path === "eikons/draft/manifest.json")!.abs).text())

    expect(man.notes).toBeUndefined()
    expect(man.display).toEqual({ title: "draft", author: "kaio", description: "demo", glyph: "◆" })
    expect(prepared.body).toContain("Description: demo")
  })

  test("preflight preview accepts gzip runtime drafts", async () => {
    await seed("draft")
    const raw = await Bun.file(eikon.file("draft")).text()
    writeFileSync(eikon.file("draft"), runtimeDescriptor(raw, { encoding: "gzip" }).bytes)

    const seen = await submit.prepare({ path: eikon.file("draft"), meta: meta(), includeSource: true })

    expect(seen.name).toBe("draft")
    expect(seen.files.map(f => f.path)).toContain("eikons/draft/manifest.json")
  })

  test("manual PR instructions show only after GitHub setup failure", async () => {
    await seed("draft")
    const fn = mock(async (_input: submit.PreparedSubmit) => ({ kind: "setup-needed" as const, failures: [{ code: "missing-auth" as const, message: "Run gh auth login" }] }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 180, height: 60 })
    await open(t)
    await stage(t)
    expect(t.frame()).not.toContain("PR body")
    expect(t.frame()).not.toContain("Manual PR")
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("GitHub CLI unavailable") && t.frame().includes("Manual PR") && t.frame().includes("Run gh auth login"))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test("failure redacts displayed auth tokens", async () => {
    await seed("draft")
    const fn = mock(async (_input: submit.PreparedSubmit) => ({ kind: "backend-failed" as const, failures: [{ code: "backend-failed" as const, message: "gh failed token ***" }] }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    await consent(t)
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submit failed"))
    expect(t.frame()).toContain("[redacted]")
    expect(t.frame()).not.toContain("***")
    expect((fn.mock.calls[0]?.[0] as submit.PreparedSubmit).path).toBe(eikon.file("draft"))
  })

  test("repeated Enter while in flight creates one backend submission", async () => {
    await seed("draft")
    let release: ((value: submit.SubmitResult) => void) | undefined
    const fn = mock((_input: submit.PreparedSubmit) => new Promise<submit.SubmitResult>(res => { release = res }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    await consent(t)
    act(() => t.keys.pressEnter())
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submitting…"))
    expect(fn).toHaveBeenCalledTimes(1)
    release!({ kind: "submitted", url: "https://github.com/liftaris/eikon/pull/9", request: {} as never })
    await until(t, () => t.frame().includes("submitted and is being reviewed"))
  })

  test("rejected submit clears busy state", async () => {
    await seed("draft")
    let calls = 0
    const fn = mock(async (_input: submit.PreparedSubmit) => { calls++; throw new Error("gh failed Bearer abc.def") })
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await open(t)
    await stage(t)
    await consent(t)
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submit failed") && t.frame().includes("[redacted]"))
    act(() => t.keys.pressEnter())
    await until(t, () => calls === 2)
  })

  test("Submit entry is hidden for bundled eikons", async () => {
    prefs.set("eikon", "nous")
    const fn = mock(async (_input: submit.PreparedSubmit) => ({ kind: "submitted" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submit={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("bundled/system"))
    expect(t.frame()).not.toContain("submit")
    act(() => t.keys.pressKey("s"))
    await t.settle()
    expect(t.frame()).not.toContain("Submit eikon")
    expect(fn).not.toHaveBeenCalled()
  })
})
