import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpHome } from "./fixture/home"
import { manifest, packageDir, stream } from "./fixture/eikon-marketplace"
import { prefs } from "../src/context/preferences"
import { eikon } from "../src/service/eikon"

describe("Eikon marketplace service", () => {
  test("loads package catalog entries and previews selected launch package data", async () => {
    await using home = await tmpHome()
    const dir = packageDir(home.root)
    writeFileSync(join(dir, "index.json"), JSON.stringify([
      { manifest: manifest("remote"), packageUrl: `file://${dir}/manifest.json` },
    ]))
    const entries = await eikon.loadCatalog(`file://${dir}/index.json`)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe("remote")
    expect(entries[0]?.state).toBe("available")

    const prev = await eikon.previewPackage(entries[0]!)
    expect(prev.eikon.meta.name).toBe("remote")
    expect(prev.eikon.states.get("working")?.frames[0]?.[0]).toBe("work  ")
    expect(prev.manifest.signals?.["state.working"]?.fallback).toBe("state.idle")
  })

  test("rejects invalid packages", async () => {
    await expect(eikon.adaptPackage({ name: "bad" })).rejects.toThrow()
  })

  test("installs packages without activating them", async () => {
    await using home = await tmpHome({ prefs: { eikon: "current" } })
    const dir = packageDir(home.root)
    const out = await eikon.installPackage(`file://${join(dir, "manifest.json")}`)

    expect(out.name).toBe("remote")
    expect(prefs.get("eikon")).toBe("current")
    expect(existsSync(eikon.file("remote"))).toBe(true)
    expect(readFileSync(eikon.file("remote"), "utf8")).toContain("\"state\":\"working\"")
  })

  test("Use activates an already installed package", async () => {
    await using home = await tmpHome({ prefs: { eikon: "current" } })
    const dir = packageDir(home.root)
    await eikon.installPackage(`file://${join(dir, "manifest.json")}`)

    eikon.useInstalled("remote")

    expect(prefs.get("eikon")).toBe("remote")
  })

  test("adapts legacy .eikon handoff paths", async () => {
    const legacy = [
      JSON.stringify({ eikon: 1, name: "legacy", width: 6, height: 2, glyph: "◆" }),
      ...["idle", "listening", "thinking", "speaking", "working", "error"].flatMap(state => [
        JSON.stringify({ state, fps: 4, frame_count: 1 }),
        JSON.stringify({ f: 0, data: `${state.slice(0, 6).padEnd(6)}\n......` }),
      ]),
    ].join("\n") + "\n"
    const man = { ...manifest("legacy"), entrypoints: { default: "avatar.eikon" }, legacy: { sourceFormat: ".eikon" as const, migration: "adapt" as const } }

    const adapted = await eikon.adaptPackage(man, undefined, legacy)

    expect(adapted.eikon.meta.name).toBe("legacy")
    expect(adapted.eikon.states.get("working")?.frames[0]?.[0]).toBe("workin")
  })

  test("reports all six lifecycle states", async () => {
    const adapted = await eikon.adaptPackage(manifest("remote"), stream("remote"))

    expect(adapted.states).toEqual(["idle", "listening", "thinking", "speaking", "working", "error"])
    for (const state of adapted.states) expect(adapted.eikon.states.has(state)).toBe(true)
  })
})
