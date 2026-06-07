import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { handleEikonCli, EIKON_CLI_USAGE, type EikonCliDeps } from "../src/app/eikon-cli"

function capture() {
  let stdout = ""
  let stderr = ""
  return {
    io: {
      stdout: (s: string) => { stdout += s },
      stderr: (s: string) => { stderr += s },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  }
}

function item(name = "ares") {
  return {
    name,
    file: `/tmp/${name}/${name}.eikon`,
    source: `/tmp/${name}/source`,
    hasSource: true,
    sourceUrl: "https://eikon.liftaris.dev/eikons/ares/",
    lifecycle: {
      name,
      source: { kind: "default-catalog" as const, identity: "ares" },
      trust: "verified" as const,
      active: false,
      removable: true,
      updateable: true,
      updateAvailable: false,
      dirty: false,
    },
  }
}

function deps(overrides: Partial<EikonCliDeps> = {}): EikonCliDeps {
  let active: string | undefined
  return {
    fetchSource: async (source, opts) => ({
      name: opts?.name ?? source,
      sources: opts?.media === false ? {} : { base: "base.png" },
      n: opts?.media === false ? 0 : 1,
      bytes: opts?.media === false ? 0 : 42,
    }),
    peekSource: async () => ({ n: 2, bytes: 2048 }),
    search: async query => [{
      name: "ares",
      title: "Ares",
      author: "Kaio",
      version: "1.0.0",
      sourceIdentity: "ares",
      trust: "verified" as const,
      installed: false,
      active: false,
      compatibility: { eikon: ">=1 <2", available: true },
    }].filter(row => !query || row.name.includes(query) || row.title.includes(query)),
    inspect: async source => ({
      source,
      name: "ares",
      title: "Ares",
      author: "Kaio",
      version: "1.0.0",
      sourceKind: "default-catalog",
      sourceIdentity: "ares",
      compatibility: { eikon: ">=1 <2", available: true },
      preview: true,
      poster: false,
      installed: false,
      active: false,
      trust: "verified",
    }),
    info: name => ({ ...item(name).lifecycle, active: overrides.getActive?.() === name || active === name }),
    update: async name => ({ name, sources: {}, n: 1, bytes: 42 }),
    remove: () => undefined,
    list: () => [item()],
    baked: name => name === "ares" ? "/tmp/ares/ares.eikon" : undefined,
    has: name => name === "ares",
    setActive: name => { active = name },
    getActive: () => active,
    ...overrides,
  }
}

describe("eikon headless CLI", () => {
  test("ignores non-eikon argv", async () => {
    expect(await handleEikonCli(["--version"], deps(), capture().io)).toBeNull()
  })

  test("prints eikon usage without launching the TUI", async () => {
    const c = capture()
    expect(await handleEikonCli(["eikon", "--help"], deps(), c.io)).toBe(0)
    expect(c.stdout()).toContain("herm eikon install <name|url|dir>")
    expect(EIKON_CLI_USAGE).toContain("herm eikon use <name>")
  })

  test("install passes name/media options, emits json, and can skip activation", async () => {
    const calls: Array<{ source: string; opts: { name?: string; media?: boolean } }> = []
    const c = capture()
    const d = deps({
      fetchSource: async (source, opts) => {
        calls.push({ source, opts: opts ?? {} })
        return { name: opts?.name ?? "ares", sources: {}, n: 0, bytes: 0 }
      },
    })

    expect(await handleEikonCli(["eikon", "install", "ares", "--name", "war", "--no-source", "--no-use", "--json"], d, c.io)).toBe(0)

    expect(calls).toEqual([{ source: "ares", opts: { name: "war", media: false } }])
    expect(JSON.parse(c.stdout())).toEqual({ ok: true, name: "war", n: 0, bytes: 0, sources: {}, active: null })
  })

  test("install does not activate by default", async () => {
    const c = capture()
    const d = deps()

    expect(await handleEikonCli(["eikon", "install", "ares", "--json"], d, c.io)).toBe(0)

    expect(JSON.parse(c.stdout()).active).toBeNull()
  })

  test("search and browse expose catalog lifecycle rows as json", async () => {
    const s = capture()
    expect(await handleEikonCli(["eikon", "search", "ar", "--json"], deps(), s.io)).toBe(0)
    expect(JSON.parse(s.stdout())).toEqual({
      ok: true,
      query: "ar",
      eikons: [{
        name: "ares",
        title: "Ares",
        author: "Kaio",
        version: "1.0.0",
        sourceIdentity: "ares",
        trust: "verified",
        installed: false,
        active: false,
        compatibility: { eikon: ">=1 <2", available: true },
      }],
    })

    const b = capture()
    expect(await handleEikonCli(["eikon", "browse", "--json"], deps(), b.io)).toBe(0)
    expect(JSON.parse(b.stdout()).eikons[0].name).toBe("ares")
  })

  test("inspect and info expose source, compatibility, trust, and state", async () => {
    const inspect = capture()
    expect(await handleEikonCli(["eikon", "inspect", "ares", "--json"], deps(), inspect.io)).toBe(0)
    expect(JSON.parse(inspect.stdout())).toEqual({
      ok: true,
      source: "ares",
      name: "ares",
      title: "Ares",
      author: "Kaio",
      version: "1.0.0",
      sourceKind: "default-catalog",
      sourceIdentity: "ares",
      compatibility: { eikon: ">=1 <2", available: true },
      preview: true,
      poster: false,
      installed: false,
      active: false,
      trust: "verified",
    })

    const info = capture()
    expect(await handleEikonCli(["eikon", "info", "ares", "--json"], deps({ getActive: () => "ares" }), info.io)).toBe(0)
    expect(JSON.parse(info.stdout())).toEqual({
      ok: true,
      name: "ares",
      source: { kind: "default-catalog", identity: "ares" },
      trust: "verified",
      active: true,
      removable: true,
      updateable: true,
      updateAvailable: false,
      dirty: false,
    })
  })

  test("peek and list expose machine-readable json", async () => {
    const p = capture()
    expect(await handleEikonCli(["eikon", "peek", "ares", "--json"], deps(), p.io)).toBe(0)
    expect(JSON.parse(p.stdout())).toEqual({ ok: true, source: "ares", n: 2, bytes: 2048 })

    const l = capture()
    expect(await handleEikonCli(["eikon", "list", "--json"], deps({ getActive: () => "ares" }), l.io)).toBe(0)
    expect(JSON.parse(l.stdout())).toEqual({
      ok: true,
      active: "ares",
      eikons: [{
        name: "ares",
        file: "/tmp/ares/ares.eikon",
        hasSource: true,
        sourceUrl: "https://eikon.liftaris.dev/eikons/ares/",
        lifecycle: {
          name: "ares",
          source: { kind: "default-catalog", identity: "ares" },
          trust: "verified",
          active: false,
          removable: true,
          updateable: true,
          updateAvailable: false,
          dirty: false,
        },
      }],
    })
  })

  test("use rejects unknown eikons", async () => {
    const c = capture()

    expect(await handleEikonCli(["eikon", "use", "missing", "--json"], deps(), c.io)).toBe(1)

    expect(JSON.parse(c.stderr())).toEqual({ ok: false, error: "No installed or bundled eikon named 'missing'" })
  })

  test("remove and update require active acknowledgement before mutation", async () => {
    const remove = capture()
    expect(await handleEikonCli(["eikon", "remove", "ares", "--json"], deps({
      getActive: () => "ares",
      remove: () => ({
        type: "active-consequence",
        action: "remove",
        name: "ares",
        message: "Removing 'ares' will clear the active avatar. Pass confirmActive to remove it.",
      }),
    }), remove.io)).toBe(1)
    expect(JSON.parse(remove.stderr())).toEqual({
      ok: false,
      error: "Removing 'ares' will clear the active avatar. Pass --active-ok to remove it.",
      consequence: "active",
      action: "remove",
      name: "ares",
    })

    const update = capture()
    expect(await handleEikonCli(["eikon", "update", "ares", "--json"], deps({
      getActive: () => "ares",
      update: async () => ({
        type: "active-consequence",
        action: "update",
        name: "ares",
        message: "Updating 'ares' will change the active avatar's backing package. Pass confirmActive to update it.",
      }),
    }), update.io)).toBe(1)
    expect(JSON.parse(update.stderr())).toEqual({
      ok: false,
      error: "Updating 'ares' will change the active avatar's backing package. Pass --active-ok to update it.",
      consequence: "active",
      action: "update",
      name: "ares",
    })
  })

  test("remove missing returns a stable json error without mutation", async () => {
    const removed: string[] = []
    const c = capture()

    expect(await handleEikonCli(["eikon", "remove", "missing", "--json"], deps({
      remove: name => { removed.push(name); return undefined },
    }), c.io)).toBe(1)

    expect(removed).toEqual([])
    expect(JSON.parse(c.stderr())).toEqual({ ok: false, error: "No installed eikon named 'missing'" })
  })

  test("remove and update mutate only with active acknowledgement flag", async () => {
    const removed: Array<{ name: string; confirmActive?: boolean }> = []
    const r = capture()
    expect(await handleEikonCli(["eikon", "remove", "ares", "--active-ok", "--json"], deps({
      remove: (name, opts) => { removed.push({ name, confirmActive: opts?.confirmActive }); return undefined },
    }), r.io)).toBe(0)
    expect(removed).toEqual([{ name: "ares", confirmActive: true }])
    expect(JSON.parse(r.stdout())).toEqual({ ok: true, name: "ares", removed: true, activeCleared: false })

    const updates: Array<{ name: string; confirmActive?: boolean }> = []
    const u = capture()
    expect(await handleEikonCli(["eikon", "update", "ares", "--active-ok", "--json"], deps({
      update: async (name, opts) => { updates.push({ name, confirmActive: opts?.confirmActive }); return { name, sources: {}, n: 2, bytes: 84 } },
    }), u.io)).toBe(0)
    expect(updates).toEqual([{ name: "ares", confirmActive: true }])
    expect(JSON.parse(u.stdout())).toEqual({ ok: true, name: "ares", n: 2, bytes: 84, active: null })
  })

  test("entrypoint routes eikon help before global help", async () => {
    const repo = resolve(import.meta.dir, "..")
    const p = Bun.spawn([process.execPath, "src/index.tsx", "eikon", "--help"], {
      cwd: repo,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CONTROL: "", PERF: "" },
    })
    const [code, stdout, stderr] = await Promise.all([
      p.exited,
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ])

    expect(code).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("herm eikon install <name|url|dir>")
    expect(stdout).not.toContain("OpenTUI client")
  })
})
