import { expect, test } from "bun:test"
import { act } from "react"
import { join } from "node:path"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { mount, until } from "./harness"
import { tmpHome } from "./fixture/home"
import { packageDir, manifest } from "./fixture/eikon-marketplace"
import { prefs } from "../src/context/preferences"
import { eikon } from "../src/service/eikon"

async function marketplace() {
  const root = process.env.HERM_EIKON_MARKETPLACE_ROOT!
  const dir = packageDir(root)
  writeFileSync(join(root, "index.json"), JSON.stringify([
    { manifest: manifest("remote"), packageUrl: `file://${dir}/manifest.json` },
  ]))
  process.env.HERM_EIKON_MARKETPLACE = `file://${root}/index.json`
  return root
}

function openMarketplace(t: Awaited<ReturnType<typeof mount>>) {
  act(() => t.keys.pressArrow("right", { meta: true }))
  act(() => t.keys.pressArrow("right", { meta: true }))
  act(() => t.keys.pressArrow("right", { meta: true }))
  act(() => t.keys.pressArrow("right", { meta: true }))
  act(() => t.keys.pressArrow("right", { shift: true }))
  act(() => t.keys.pressArrow("right", { shift: true }))
}

test("marketplace previews in the real sidebar and restores without activation", async () => {
  await using home = await tmpHome({ prefs: { eikon: "current" } })
  const root = join(home.root, "market")
  mkdirSync(root, { recursive: true })
  process.env.HERM_EIKON_MARKETPLACE_ROOT = root
  await marketplace()

  await using t = await mount({ width: 180, height: 44 })
  openMarketplace(t)
  await until(t, () => t.frame().includes("Marketplace (1)") && t.frame().includes("idle"), 3000)

  expect(t.frame()).toContain("Preview: Remote Eikon")
  expect(prefs.get("eikon")).toBe("current")
  expect(existsSync(eikon.file("remote"))).toBe(false)

  act(() => t.keys.pressEscape())
  await t.settle()
  expect(t.frame()).not.toContain("Preview: Remote Eikon")
  expect(prefs.get("eikon")).toBe("current")
})

test("marketplace install is install-only and Use activates", async () => {
  await using home = await tmpHome({ prefs: { eikon: "current" } })
  const root = join(home.root, "market")
  mkdirSync(root, { recursive: true })
  process.env.HERM_EIKON_MARKETPLACE_ROOT = root
  await marketplace()

  await using t = await mount({ width: 180, height: 44 })
  openMarketplace(t)
  await until(t, () => t.frame().includes("Press Install") && t.frame().includes("idle"), 3000)

  act(() => t.keys.pressKey("i"))
  await until(t, () => t.frame().includes("Installed — press Use to activate"), 3000)
  expect(prefs.get("eikon")).toBe("current")

  act(() => t.keys.pressKey("u"))
  await until(t, () => t.frame().includes("Active"), 3000)
  expect(prefs.get("eikon")).toBe("remote")
})

test("marketplace surfaces invalid package errors", async () => {
  await using home = await tmpHome({ prefs: { eikon: "current" } })
  const root = join(home.root, "market")
  const bad = join(root, "bad")
  mkdirSync(bad, { recursive: true })
  writeFileSync(join(bad, "manifest.json"), JSON.stringify({ kind: "eikon.package", name: "bad" }))
  writeFileSync(join(root, "index.json"), JSON.stringify([
    { name: "bad", title: "Bad Remote", source: "bad/" },
  ]))
  process.env.HERM_EIKON_MARKETPLACE = `file://${root}/index.json`

  await using t = await mount({ width: 180, height: 44 })
  openMarketplace(t)
  await until(t, () => t.frame().includes("Bad Remote") && t.frame().includes("id: safe id required"), 3000)

  expect(prefs.get("eikon")).toBe("current")
})
