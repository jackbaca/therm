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

function run(opts: { user?: string; submitter?: string } = {}) {
  const calls: Array<{ args: string[]; input?: string }> = []
  const user = opts.user ?? "liftaris"
  const submitter = opts.submitter ?? "liftaris"
  const fn: delist.Run = async (args, input) => {
    calls.push({ args, input })
    const key = args.join(" ")
    if (key === "api user -q .login") return user
    if (args[0] === "pr" && args[1] === "list" && args.includes("--state") && args.includes("merged"))
      return JSON.stringify([{ number: 25, title: "eikons: submit ovo", headRefName: "submit/ovo", author: { login: submitter }, url: "https://github.com/liftaris/eikon/pull/25" }])
    if (args[0] === "pr" && args[1] === "view" && args[2] === "25")
      return JSON.stringify({ files: [{ path: "eikons/ovo/ovo.eikon" }, { path: "eikons/ovo/manifest.json" }, { path: "packages/liftaris/ovo/1.0.0.json" }] })
    if (args[0] === "repo") return ""
    if (key === "api repos/liftaris/eikon/git/ref/heads/main -q .object.sha") return "main-sha"
    if (key === "api repos/liftaris/eikon/git/commits/main-sha -q .tree.sha") return "tree-sha"
    if (args[0] === "api" && args[3] === "repos/liftaris/eikon/git/refs") return ""
    if (key === "api repos/liftaris/eikon/contents/eikons/index.json -f ref=main")
      return JSON.stringify({ sha: "index-main", content: b64(JSON.stringify([entry])) })
    if (key === "api repos/liftaris/eikon/git/trees/tree-sha -f recursive=1")
      return JSON.stringify({ tree: [
        { path: "eikons/ovo/ovo.eikon", type: "blob", sha: "runtime-sha" },
        { path: "eikons/ovo/manifest.json", type: "blob", sha: "manifest-sha" },
        { path: "packages/liftaris/ovo/1.0.0.json", type: "blob", sha: "pkg-sha" },
      ] })
    if (args[0] === "api" && args[1] === "-X" && args[2] === "GET" && args[4] === "-f")
      return JSON.stringify({ sha: `${args[3]!.split("/").pop()}-branch-sha` })
    if (args[0] === "api" && args[1] === "-X" && (args[2] === "PUT" || args[2] === "DELETE")) return ""
    if (args[0] === "pr" && args[1] === "create") return "https://github.com/liftaris/eikon/pull/99"
    throw new Error(`unexpected ${key}`)
  }
  return { fn, calls }
}

describe("eikon delist service", () => {
  test("author eligibility follows original merged submission PR author", async () => {
    expect(await delist.info(entry, { run: run().fn })).toMatchObject({ eligible: true, user: "liftaris", author: "liftaris", pr: 25 })
    expect(await delist.info(entry, { run: run({ user: "other" }).fn })).toMatchObject({ eligible: false, user: "other", author: "liftaris" })
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
  })
})
