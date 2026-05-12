import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { mountNode, until, type Harness } from "./harness"

// Light coverage for the bundled Files plugin. Other test files reset
// the plugin registry in their hooks, so here we re-register the
// bundled plugins ourselves inside each test rather than relying on
// module-load order.

const bootstrap = async () => {
  const host = await import("../src/plugins/host")
  host._reset()
  // Re-evaluate the plugin modules. bun caches by resolved path, so
  // the import() is a no-op on the second call — that's fine because
  // the side-effect (register()) already ran on first import and host
  // state is what we reset.
  await import("../src/plugins/clock")
  await import("../src/plugins/files")
  // If the modules were previously imported they won't re-run; force
  // the registrations by calling the known-stable plugin objects via
  // a fresh import with a cache-busted specifier.
  if (!host.tabs().some(e => e.tab.name === "Files")) {
    const files = await import("../src/plugins/files.tsx?fresh=" + Math.random())
    void files
  }
  return host
}

describe("files plugin", () => {
  test("registers a tab called \"Files\"", async () => {
    const host = await bootstrap()
    const entry = host.tabs().find(e => e.tab.name === "Files")
    expect(entry).toBeDefined()
    expect(entry!.id).toBe("demo.files")
  })

  test("renders a file tree for the initial directory", async () => {
    const host = await bootstrap()
    const entry = host.tabs().find(e => e.tab.name === "Files")!
    const t: Harness = await mountNode(entry.tab.component(), { width: 80, height: 15 })
    await until(t, () => /▸|Select a file/.test(t.frame()))
    expect(t.frame()).toContain("Select a file to preview.")
    t.destroy()
  })

  test("readdir sandbox sanity (independent of the renderer)", () => {
    const root = mkdtempSync(join(tmpdir(), "herm-files-"))
    writeFileSync(join(root, "readme.md"), "# hi")
    writeFileSync(join(root, "notes.txt"), "x")
    mkdirSync(join(root, "sub"))
    const names = readdirSync(root, { withFileTypes: true })
      .map(d => d.name)
      .sort()
    expect(names).toEqual(["notes.txt", "readme.md", "sub"])
  })
})
