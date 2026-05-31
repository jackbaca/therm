import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mountNode, until } from "./harness"
import { EikonGallery } from "../src/tabs/EikonGallery"
import { eikon } from "../src/service/eikon"
import * as submit from "../src/service/eikon-submit"
import * as prefs from "../src/context/preferences"

const HH = process.env.HERMES_HOME!

function seed(name: string) {
  const p = eikon.ensure(name)
  writeFileSync(eikon.file(name), JSON.stringify({ eikon: 1, name, width: 48, height: 24, author: "kaio" }) + "\n")
  mkdirSync(join(p.dir, "source"), { recursive: true })
  writeFileSync(join(p.dir, "source", "base.png"), "png")
  writeFileSync(join(p.dir, "manifest.json"), JSON.stringify({ name, source: "source/base.png" }, null, 2) + "\n")
  prefs.set("eikon", name)
}

describe("Eikon submit dialog", () => {
  test("missing license focuses the missing field before backend invocation", async () => {
    seed("draft")
    const fn = mock(async () => ({ kind: "review-created" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submitReview={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("draft"))
    act(() => t.keys.pressKey("u"))
    await until(t, () => t.frame().includes("Submit eikon"))
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("license required"))
    expect(t.frame()).toMatch(/License.*█/s)
    expect(fn).not.toHaveBeenCalled()
  })

  test("missing provenance blocks before backend invocation", async () => {
    seed("draft")
    const fn = mock(async () => ({ kind: "review-created" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submitReview={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("draft"))
    act(() => t.keys.pressKey("u"))
    await until(t, () => t.frame().includes("Submit eikon"))
    await act(async () => { await t.keys.typeText("MIT") })
    act(() => t.keys.pressTab())
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("provenance required"))
    expect(t.frame()).toMatch(/Provenance.*█/s)
    expect(fn).not.toHaveBeenCalled()
  })

  test("preflight setup guidance does not submit and preserves typed metadata", async () => {
    seed("draft")
    const fn = mock(async () => ({ kind: "setup-needed" as const, failures: [{ code: "missing-auth" as const, message: "Run gh auth login" }] }))
    await using t = await mountNode(<EikonGallery focused submitReview={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("draft"))
    act(() => t.keys.pressKey("u"))
    await until(t, () => t.frame().includes("Submit eikon"))
    await act(async () => { await t.keys.typeText("MIT") })
    act(() => t.keys.pressTab())
    await act(async () => { await t.keys.typeText("Original art") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Setup needed") && t.frame().includes("Run gh auth login"))
    expect(t.frame()).toContain("MIT")
    expect(t.frame()).toContain("Original art")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test("happy path displays the returned review URL", async () => {
    seed("draft")
    const fn = mock(async () => ({ kind: "review-created" as const, url: "https://github.com/liftaris/eikon/pull/7", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submitReview={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("draft"))
    act(() => t.keys.pressKey("u"))
    await until(t, () => t.frame().includes("Submit eikon"))
    await act(async () => { await t.keys.typeText("MIT") })
    act(() => t.keys.pressTab())
    await act(async () => { await t.keys.typeText("Original art") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submitted for review") && t.frame().includes("pull/7"))
    expect(fn).toHaveBeenCalledWith({ path: eikon.file("draft"), license: "MIT", provenance: "Original art" })
  })

  test("failure preserves typed metadata and redacts displayed auth tokens", async () => {
    seed("draft")
    const fn = mock(async () => ({ kind: "backend-failed" as const, failures: [{ code: "backend-failed" as const, message: "gh failed token ghp_ABC123secret" }] }))
    await using t = await mountNode(<EikonGallery focused submitReview={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("draft"))
    act(() => t.keys.pressKey("u"))
    await until(t, () => t.frame().includes("Submit eikon"))
    await act(async () => { await t.keys.typeText("MIT") })
    act(() => t.keys.pressTab())
    await act(async () => { await t.keys.typeText("Original art") })
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submit failed"))
    expect(t.frame()).toContain("MIT")
    expect(t.frame()).toContain("Original art")
    expect(t.frame()).toContain("[redacted]")
    expect(t.frame()).not.toContain("ghp_ABC123secret")
  })

  test("repeated Enter while in flight creates one backend submission", async () => {
    seed("draft")
    let release: ((value: submit.SubmitResult) => void) | undefined
    const fn = mock(() => new Promise<submit.SubmitResult>(res => { release = res }))
    await using t = await mountNode(<EikonGallery focused submitReview={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("draft"))
    act(() => t.keys.pressKey("u"))
    await until(t, () => t.frame().includes("Submit eikon"))
    await act(async () => { await t.keys.typeText("MIT") })
    act(() => t.keys.pressTab())
    await act(async () => { await t.keys.typeText("Original art") })
    act(() => t.keys.pressEnter())
    act(() => t.keys.pressEnter())
    await until(t, () => t.frame().includes("Submitting…"))
    expect(fn).toHaveBeenCalledTimes(1)
    release!({ kind: "review-created", url: "https://github.com/liftaris/eikon/pull/9", request: {} as never })
    await until(t, () => t.frame().includes("pull/9"))
  })

  test("Submit entry is hidden for bundled eikons", async () => {
    prefs.set("eikon", "default")
    const fn = mock(async () => ({ kind: "review-created" as const, url: "https://github.com/liftaris/eikon/pull/1", request: {} as never }))
    await using t = await mountNode(<EikonGallery focused submitReview={fn} />, { width: 160, height: 48 })
    await until(t, () => t.frame().includes("(bundled)"))
    expect(t.frame()).not.toContain("submit")
    act(() => t.keys.pressKey("u"))
    await t.settle()
    expect(t.frame()).not.toContain("Submit eikon")
    expect(fn).not.toHaveBeenCalled()
  })
})
