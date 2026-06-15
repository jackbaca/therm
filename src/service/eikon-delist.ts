import { Buffer } from "node:buffer"
import type { PublicCatalogEntry as CatalogEntry } from "eikon"

export type Run = (args: string[], input?: string) => Promise<string>
export type Info = {
  eligible: boolean
  user?: string
  author?: string
  pr?: number
  url?: string
  reason?: string
}
export type Result = { url: string; info: Info }
export type Opts = { repo?: string; run?: Run }

type Pr = {
  number: number
  title?: string
  headRefName?: string
  url?: string
  mergedAt?: string
  author?: { login?: string } | null
}
type File = { path: string }
type Tree = { tree?: Array<{ path?: string; type?: string; sha?: string }> }
type Content = { content?: string; sha?: string }

const REPO = process.env.EIKON_REPO ?? "liftaris/eikon"
const enc = new TextEncoder()

async function gh(args: string[], input?: string) {
  const p = Bun.spawn(["gh", ...args], { stdin: input ? enc.encode(input) : undefined, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error(err.trim() || out.trim() || `gh ${args[0]} failed`)
  return out.trim()
}

function json<T>(text: string): T {
  return JSON.parse(text) as T
}

function clean(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

function pkg(entry: CatalogEntry) {
  const parts = entry.id.includes("/") ? entry.id.split("/") : ["liftaris", entry.name]
  return { ns: parts[0] || "liftaris", name: parts[1] || entry.name }
}

function dirs(entry: CatalogEntry) {
  const p = pkg(entry)
  return [`eikons/${entry.name}/`, `packages/${p.ns}/${p.name}/`]
}

function touches(entry: CatalogEntry, path: string) {
  return dirs(entry).some(dir => path.startsWith(dir))
}

async function user(run: Run) {
  return run(["api", "user", "-q", ".login"])
}

async function prs(entry: CatalogEntry, repo: string, run: Run) {
  const fields = "number,title,headRefName,url,mergedAt,author"
  const first = json<Pr[]>(await run(["pr", "list", "-R", repo, "--state", "merged", "--search", `eikons: submit ${entry.name}`, "--json", fields, "--limit", "20"]))
  if (first.length) return first
  return json<Pr[]>(await run(["pr", "list", "-R", repo, "--state", "merged", "--json", fields, "--limit", "50"]))
}

async function files(repo: string, pr: number, run: Run) {
  const raw = await run(["pr", "view", String(pr), "-R", repo, "--json", "files"])
  return json<{ files?: File[] }>(raw).files ?? []
}

async function found(entry: CatalogEntry, repo: string, run: Run) {
  for (const pr of await prs(entry, repo, run)) {
    const title = pr.title === `eikons: submit ${entry.name}`
    const head = pr.headRefName === `submit/${entry.name}`
    if (!title && !head) continue
    if ((await files(repo, pr.number, run)).some(f => touches(entry, f.path))) return pr
  }
  return undefined
}

export async function info(entry: CatalogEntry, opts: Opts = {}): Promise<Info> {
  const run = opts.run ?? gh
  const repo = opts.repo ?? REPO
  let login: string
  try { login = await user(run) }
  catch (err) { return { eligible: false, reason: err instanceof Error ? err.message : String(err) } }
  const pr = await found(entry, repo, run)
  const author = pr?.author?.login
  if (!pr || !author) return { eligible: false, user: login, reason: "No merged GitHub submission found" }
  if (author !== login) return { eligible: false, user: login, author, pr: pr.number, url: pr.url, reason: `Submitted by @${author}` }
  return { eligible: true, user: login, author, pr: pr.number, url: pr.url }
}

async function exists(run: Run, repo: string, branch: string, path: string) {
  try {
    const raw = await run(["api", "-X", "GET", `repos/${repo}/contents/${path}`, "-f", `ref=${branch}`])
    return json<Content>(raw).sha
  } catch { return undefined }
}

async function put(run: Run, repo: string, branch: string, path: string, text: string, msg: string) {
  const sha = await exists(run, repo, branch, path)
  await run(["api", "-X", "PUT", `repos/${repo}/contents/${path}`, "--input", "-"], JSON.stringify({
    message: msg,
    branch,
    content: Buffer.from(text).toString("base64"),
    ...(sha ? { sha } : {}),
  }))
}

async function del(run: Run, repo: string, branch: string, path: string, sha: string, msg: string) {
  await run(["api", "-X", "DELETE", `repos/${repo}/contents/${path}`, "--input", "-"], JSON.stringify({ message: msg, branch, sha }))
}

async function main(run: Run, repo: string) {
  const sha = await run(["api", `repos/${repo}/git/ref/heads/main`, "-q", ".object.sha"])
  const tree = await run(["api", `repos/${repo}/git/commits/${sha}`, "-q", ".tree.sha"])
  return { sha, tree }
}

async function tree(run: Run, repo: string, sha: string) {
  return json<Tree>(await run(["api", "-X", "GET", `repos/${repo}/git/trees/${sha}`, "-f", "recursive=1"])).tree ?? []
}

async function index(run: Run, repo: string) {
  const raw = json<Content>(await run(["api", "-X", "GET", `repos/${repo}/contents/eikons/index.json`, "-f", "ref=main"]))
  return { sha: raw.sha, text: Buffer.from((raw.content ?? "").replace(/\s/g, ""), "base64").toString("utf8") }
}

async function pr(run: Run, repo: string, user: string, branch: string, name: string, body: string) {
  try {
    return await run(["pr", "create", "-R", repo, "-H", `${user}:${branch}`, "-B", "main", "-t", `eikons: delist ${name}`, "-b", body])
  } catch {
    const raw = await run(["api", "-X", "GET", `repos/${repo}/pulls`, "-f", "state=open", "-f", `head=${user}:${branch}`])
    const hit = json<Array<{ url?: string }>>(raw)[0]?.url
    if (hit) return hit
    throw new Error("GitHub PR creation failed")
  }
}

export async function submit(entry: CatalogEntry, opts: Opts = {}): Promise<Result> {
  const run = opts.run ?? gh
  const repo = opts.repo ?? REPO
  const own = await info(entry, { repo, run })
  if (!own.eligible || !own.user) throw new Error(own.reason ?? "not authorized to delist this eikon")
  await run(["repo", "fork", repo, "--clone=false"]).catch(() => "")
  const fork = `${own.user}/${repo.split("/")[1]}`
  const branch = `delist/${clean(entry.name)}`
  const base = await main(run, repo)
  await run(["api", "-X", "POST", `repos/${fork}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${base.sha}`]).catch(() => "")
  const msg = `eikons: delist ${entry.name}`
  const ix = await index(run, repo)
  const next = json<Array<Record<string, unknown>>>(ix.text).filter(e => e.name !== entry.name && e.id !== entry.id)
  await put(run, fork, branch, "eikons/index.json", `${JSON.stringify(next, null, 2)}\n`, msg)
  for (const item of await tree(run, repo, base.tree)) {
    if (!item.path || item.type !== "blob" || !item.sha || !touches(entry, item.path)) continue
    const sha = await exists(run, fork, branch, item.path) ?? item.sha
    await del(run, fork, branch, item.path, sha, msg)
  }
  const url = await pr(run, repo, own.user, branch, entry.name, `Requests delisting \`${entry.name}\` from the Eikon registry.`)
  return { url, info: own }
}

export * as delistSvc from "./eikon-delist"
