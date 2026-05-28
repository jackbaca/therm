import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"

const HH = process.env.HERMES_HOME!
let HomeStore: typeof import("../src/home/store").HomeStore

const writeConfig = (provider: string) =>
  writeFileSync(
    join(HH, "config.yaml"),
    `memory:\n  provider: ${provider}\n  memory_char_limit: 2200\n  user_char_limit: 1375\n`,
  )

beforeAll(async () => {
  mkdirSync(HH, { recursive: true })
  mkdirSync(join(HH, "memories"), { recursive: true })
  mkdirSync(join(HH, "sessions"), { recursive: true })
  mkdirSync(join(HH, "hermes-agent", "plugins", "memory", "mem0"), { recursive: true })
  writeConfig("mem0")
  writeFileSync(join(HH, "SOUL.md"), "# Soul\ncontent")
  writeFileSync(join(HH, "sessions", "sessions.json"),
    JSON.stringify({ a: { session_id: "sid-1", platform: "tui", active: true } }))
  writeFileSync(join(HH, "mem0.json"), JSON.stringify({ api_key: "***", user_id: "u" }))
  writeFileSync(join(HH, "memories", "MEMORY.md"), "one\n§\ntwo\n§\nthree")
  writeFileSync(join(HH, "memories", "USER.md"), "name: test")
  writeFileSync(join(HH, ".env"), "FOO=bar\nBAZ=qux\n")
  // Import after fixtures exist so module-level hermesPath resolves to the sandbox.
  HomeStore = (await import("../src/home/store")).HomeStore
})

const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

// Watch-dependent tests run first against a single shared store. Bun's
// fs.watch(dir) degrades under rapid arm/close cycling on the same dir; a
// shared store mirrors production (singleton, never closed) and avoids it.
describe("HomeStore > reactive", () => {
  let h: InstanceType<typeof HomeStore>
  beforeAll(async () => {
    h = new HomeStore()
    await h.ensure("config")
    await h.ensure("env")
    // Bun's watch() may drop writes landing in the same tick as arm; yield so
    // the first trigger is observed. Real UI never writes <1ms after mount.
    await settle(10)
  })
  afterAll(() => h.close())

  test("config re-reads on external write", async () => {
    const seen: string[] = []
    const off = h.subscribe("config", () => {
      const v = h.get("config")
      if (v) seen.push(v.memory.provider)
    })
    writeConfig("honcho")
    // Debounce is 50ms; fs.watch latency varies. 200ms is comfortably past both.
    await settle(200)
    expect(seen).toContain("honcho")
    writeConfig("mem0")
    await settle(200)
    expect(seen).toContain("mem0")
    off()
  })

  test("env parses and re-reads on external write", async () => {
    expect(h.get("env")?.FOO).toBe("bar")
    expect(h.get("env")?.BAZ).toBe("qux")
    const off = h.subscribe("env", () => {})
    writeFileSync(join(HH, ".env"), "FOO=updated\n")
    await settle(200)
    expect(h.get("env")?.FOO).toBe("updated")
    expect(h.get("env")?.BAZ).toBeUndefined()
    off()
  })
})

describe("HomeStore > core", () => {
  const stores: InstanceType<typeof HomeStore>[] = []
  const mk = () => {
    const s = new HomeStore()
    stores.push(s)
    return s
  }
  afterEach(() => {
    while (stores.length) stores.pop()!.close()
  })

  test("ensure reads and caches; get is sync", async () => {
    const h = mk()
    expect(h.get("config")).toBeUndefined()
    const c = await h.ensure("config")
    expect(c?.memory.provider).toBe("mem0")
    expect(h.get("config")).toBe(c)
    // Second ensure returns the cached value, not a re-read.
    expect(await h.ensure("config")).toBe(c)
  })

  test("concurrent ensure dedupes inflight", async () => {
    const h = mk()
    const [a, b] = await Promise.all([h.ensure("config"), h.ensure("config")])
    expect(a).toBe(b)
  })

  test("deps resolve before read", async () => {
    const h = mk()
    const providers = await h.ensure("memoryProviders")
    // memoryProviders depends on config for the active name; config must be populated.
    expect(h.get("config")).not.toBeUndefined()
    expect(providers.find(p => p.name === "mem0")?.active).toBe(true)
  })

  test("invalidate cascades to dependents", async () => {
    const h = mk()
    const c0 = await h.ensure("config")
    await h.ensure("memoryProviders")
    let fired = 0
    h.subscribe("memoryProviders", () => { fired++ })
    h.invalidate("config")
    // Dependent has a subscriber → re-ensure cascades, which re-pulls config.
    await settle(10)
    expect(fired).toBeGreaterThan(0)
    expect(h.get("config")).not.toBe(c0)
  })

  test("subscribe + unsubscribe", async () => {
    const h = mk()
    let n = 0
    const off = h.subscribe("config", () => { n++ })
    await h.ensure("config")
    expect(n).toBe(1)
    off()
    h.invalidate("config")
    await h.ensure("config")
    expect(n).toBe(1)
  })

  test("memory slice consumes config limit via deps", async () => {
    const h = mk()
    const m = await h.ensure("memory")
    expect(m?.charLimit).toBe(2200)
    expect(m?.entryCount).toBe(3)
  })

  test("env slice handles missing file; invalidate forces re-read", async () => {
    rmSync(join(HH, ".env"), { force: true })
    const h = mk()
    expect(Object.keys(await h.ensure("env"))).toHaveLength(0)
    let fired = 0
    h.subscribe("env", () => { fired++ })
    writeFileSync(join(HH, ".env"), "LATE=arrival\n")
    h.invalidate("env")
    await settle(10)
    expect(h.get("env")?.LATE).toBe("arrival")
    expect(fired).toBeGreaterThan(0)
  })

  test("soul + liveSessions slices read fixtures", async () => {
    const h = mk()
    const soul = await h.ensure("soul")
    expect(soul?.content).toContain("# Soul")
    expect(soul?.charCount).toBe(14)
    const live = await h.ensure("liveSessions")
    expect(live.a?.session_id).toBe("sid-1")
  })

  test("db-backed slices are safe without state.db", async () => {
    // Other suites may have seeded the shared sandbox state.db before
    // this runs; can't assert emptiness, only that the readers don't
    // throw and return the declared shape.
    const h = mk()
    expect(Array.isArray(await h.ensure("recentSessions"))).toBe(true)
    expect(Array.isArray(await h.ensure("memoryActivity"))).toBe(true)
    expect(await h.ensure("systemPrompt")).toBeNull()
    // toolsInfo is a legacy/debug snapshot fallback; fixture has none.
    expect(await h.ensure("toolsInfo")).toBeNull()
  })

  test("close disposes watchers and state", async () => {
    const h = mk()
    await h.ensure("config")
    h.close()
    expect(h.get("config")).toBeUndefined()
    // Writing after close must not throw (watcher gone) and must not revive state.
    writeConfig("mem0")
    await settle(100)
    expect(h.get("config")).toBeUndefined()
  })
})
