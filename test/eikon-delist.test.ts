import { describe, expect, test } from "bun:test"
import type { PublicCatalogEntry } from "eikon"
import * as delist from "../src/service/eikon-delist"

const entry = {
  kind: "eikon.catalog.entry",
  schemaVersion: "1.0",
  id: "liftaris/ovo",
  version: "1.0.0",
  sourceKey: "registry:eikon.liftaris.dev:liftaris/ovo@1.0.0",
  name: "ovo",
  title: "ovo",
  author: "kaio",
  poster: "",
  runtimeUrl: "https://eikon.liftaris.dev/packages/liftaris/ovo/blobs/sha256/abc",
  packageUrl: "https://eikon.liftaris.dev/packages/liftaris/ovo/1.0.0.json",
  compatibility: { eikon: ">=1 <2", available: true },
  trust: {},
  w: 48,
  h: 24,
  width: 48,
  height: 24,
  identityKey: "registry:eikon.liftaris.dev:liftaris/ovo@1.0.0",
  raw: { name: "ovo" },
} satisfies PublicCatalogEntry

function b64(text: string) {
  return Buffer.from(text).toString("base64")
}

function run(opts: { user?: string; submitter?: string; createFails?: boolean; branchExists?: boolean } = {}) {
  const calls: Array<{ args: string[]; input?: string }> = []
  const user = opts.user ?? "liftaris"
  const submitter = opts.submitter ?? "liftaris"
  const fn: delist.Run = async (args, input) => {
    calls.push({ args, input })
    const key = args.join(" ")
    if (key === "api user -q .login") return user
    if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("merged"))
      return JSON.stringify([{ number: 25, title: "eikons: submit ovo", headRefName: "submit/ovo", mergedAt: "2026-06-01T00:00:00Z", author: { login: submitter }, url: "https://github.com/liftaris/eikon/pull/25" }])
    if (key === "api --paginate -X GET repos/liftaris/eikon/pulls/25/files --jq .[].filename")
      return "eikons/ovo/ovo.eikon\neikons/ovo/manifest.json\npackages/liftaris/ovo/1.0.0.json\n"
    if (args[0] === "repo") return ""
    if (key === "api repos/liftaris/eikon/git/ref/heads/main -q .object.sha") return "main-sha"
    if (key === "api repos/liftaris/eikon/git/commits/main-sha -q .tree.sha") return "tree-sha"
    if (args[0] === "api" && args[3] === "repos/liftaris/eikon/git/refs") {
      if (opts.branchExists) throw new Error("exists")
      return ""
    }
    if (args[0] === "api" && args[2] === "PATCH") return ""
    if (key === "api -X GET repos/liftaris/eikon/contents/eikons/index.json -f ref=main")
      return JSON.stringify({ sha: "index-main", content: b64(JSON.stringify([entry])) })
    if (key === "api -X GET repos/liftaris/eikon/git/trees/tree-sha -f recursive=1")
      return JSON.stringify({ tree: [
        { path: "eikons/ovo/ovo.eikon", type: "blob", sha: "runtime-sha" },
        { path: "eikons/ovo/manifest.json", type: "blob", sha: "manifest-sha" },
        { path: "packages/liftaris/ovo/1.0.0.json", type: "blob", sha: "pkg-sha" },
      ] })
    if (key === "api -X GET repos/liftaris/eikon/pulls -f state=open -f head=liftaris:delist/ovo") return opts.createFails ? JSON.stringify([{ url: "https://github.com/liftaris/eikon/pull/98" }]) : "[]"
    if (args[0] === "api" && args[1] === "-X" && args[2] === "GET" && args[4] === "-f")
      return JSON.stringify({ sha: `${args[3]!.split("/").pop()}-branch-sha` })
    if (args[0] === "api" && args[1] === "-X" && (args[2] === "PUT" || args[2] === "DELETE")) return ""
    if (args[0] === "pr" && args[1] === "create") {
      if (opts.createFails) throw new Error("already exists")
      return "https://github.com/liftaris/eikon/pull/99"
    }
    throw new Error(`unexpected ${key}`)
  }
  return { fn, calls }
}

describe("eikon delist service", () => {
  test("rejects non-official catalog entries before GitHub lookup", async () => {
    const calls: string[][] = []
    const fake = { ...entry, sourceKey: "http://localhost/eikons/ovo/", identityKey: "http://localhost/eikons/ovo/", packageUrl: "http://localhost/eikons/ovo/manifest.json" }
    const out = await delist.info(fake, { run: async args => { calls.push(args); return "" } })

    expect(out).toMatchObject({ eligible: false, reason: "Registry delist is only available for official Eikon catalog entries" })
    expect(calls).toEqual([])
  })

  test("author eligibility follows original merged submission PR author", async () => {
    expect(await delist.info(entry, { run: run().fn })).toMatchObject({ eligible: true, user: "liftaris", author: "liftaris", pr: 25 })
    expect(await delist.info(entry, { run: run({ user: "other" }).fn })).toMatchObject({ eligible: false, user: "other", author: "liftaris" })
  })

  test("submitter lookup requires exact submit PR metadata and picks the oldest match", async () => {
    const fn: delist.Run = async args => {
      const key = args.join(" ")
      if (key === "api user -q .login") return "liftaris"
      if (args[0] === "pr" && args[1] === "list") return JSON.stringify([
        { number: 30, title: "eikons: submit ovo", headRefName: "submit/ovo", mergedAt: "2026-06-10T00:00:00Z", author: { login: "other" }, url: "new" },
        { number: 20, title: "eikons: submit ovo", headRefName: "submit/ovo", mergedAt: "2026-06-01T00:00:00Z", author: { login: "liftaris" }, url: "old" },
        { number: 10, title: "eikons: submit ovo", headRefName: "misc/ovo", mergedAt: "2026-05-01T00:00:00Z", author: { login: "wrong" }, url: "wrong" },
      ])
      if (key === "api --paginate -X GET repos/liftaris/eikon/pulls/20/files --jq .[].filename") return "eikons/ovo/manifest.json\n"
      if (key === "api --paginate -X GET repos/liftaris/eikon/pulls/30/files --jq .[].filename") return "eikons/ovo/manifest.json\n"
      throw new Error(`unexpected ${key}`)
    }

    expect(await delist.info(entry, { run: fn })).toMatchObject({ eligible: true, author: "liftaris", pr: 20 })
  })

  test("submit creates a destination deletion PR", async () => {
    const mock = run()
    const out = await delist.submit(entry, { run: mock.fn })
    const puts = mock.calls.filter(c => c.args[2] === "PUT")
    const dels = mock.calls.filter(c => c.args[2] === "DELETE")

    expect(out.url).toBe("https://github.com/liftaris/eikon/pull/99")
    expect(puts).toHaveLength(1)
    expect(JSON.parse(puts[0]!.input!).content).toBe(b64("[]\n"))
    expect(dels.map(c => c.args[3])).toEqual([
      "repos/liftaris/eikon/contents/eikons/ovo/ovo.eikon",
      "repos/liftaris/eikon/contents/eikons/ovo/manifest.json",
      "repos/liftaris/eikon/contents/packages/liftaris/ovo/1.0.0.json",
    ])
    expect(mock.calls.some(c => c.args.join(" ") === "api -X GET repos/liftaris/eikon/contents/eikons/index.json -f ref=main")).toBe(true)
    expect(mock.calls.some(c => c.args.join(" ") === "api -X GET repos/liftaris/eikon/git/trees/tree-sha -f recursive=1")).toBe(true)
  })

  test("submit resets an existing delist branch to current main before writing", async () => {
    const mock = run({ branchExists: true })

    await delist.submit(entry, { run: mock.fn })

    const patch = mock.calls.find(c => c.args.join(" ") === "api -X PATCH repos/liftaris/eikon/git/refs/heads/delist/ovo --input -")
    expect(patch).toBeDefined()
    expect(JSON.parse(patch!.input!)).toEqual({ sha: "main-sha", force: true })
  })

  test("submit returns an existing delist PR when create reports one", async () => {
    const mock = run({ createFails: true })

    const out = await delist.submit(entry, { run: mock.fn })

    expect(out.url).toBe("https://github.com/liftaris/eikon/pull/98")
    expect(mock.calls.some(c => c.args.join(" ") === "api -X GET repos/liftaris/eikon/pulls -f state=open -f head=liftaris:delist/ovo")).toBe(true)
  })
})
