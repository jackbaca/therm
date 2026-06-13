import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { isIP } from "node:net"
import { basename, dirname, join } from "node:path"
import {
  githubSubmitBackend,
  previewSubmitBundle,
  type SubmitBackend,
  type SubmitBundle,
  type SubmitFailure,
  type SubmitRequest,
  type SubmitResult,
} from "eikon"
import { file, header } from "./eikon"
import { hermesPath, makeSource, type Source } from "./hermes-home"
export type { SubmitResult } from "eikon"

const TOKEN = /(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+[A-Za-z0-9._~+/=-]+|token\s+[A-Za-z0-9._~+/=-]+|\*{3,})/gi
const CTRL = /[\u0000-\u001f\u007f-\u009f]/
const SECRET = /(\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa$|id_ed25519$|token|secret|credential|password)/i
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const DEFAULT_REPO = process.env.EIKON_REPO ?? "liftaris/eikon"

export type SubmitMeta = {
  title: string
  author: string
  description: string
  glyph: string
}

export type SubmitInput = {
  path: string
  meta?: SubmitMeta
  includeSource?: boolean
  target?: string
}

export type SubmitPreview = {
  name: string
  files: { path: string; bytes: number }[]
  meta: SubmitMeta
  target: string
  source: boolean
  bundleDir: string
  bundleSource: Source
  title: string
  body: string
  url: string
  steps: string[]
}

export type PreparedSubmit = SubmitPreview & {
  path: string
  bundle: SubmitBundle
  request: SubmitRequest
  snapshot: string
}

export type Submit = (input: PreparedSubmit) => Promise<SubmitResult>
export type PublishedInfo = { source: string }

type Head = { name?: unknown; title?: unknown; author?: unknown; glyph?: unknown }

export function submitPath(name: string) {
  return file(name)
}

export function targetRepo() {
  return DEFAULT_REPO
}

export function publishedInfo(path: string): PublishedInfo | undefined {
  const head = header(path)
  if (typeof head?.source_url === "string" && head.source_url.trim()) return { source: head.source_url }
  const mf = join(dirname(path), "manifest.json")
  if (!existsSync(mf)) return undefined
  try {
    const man = JSON.parse(readFileSync(mf, "utf8")) as Record<string, unknown>
    const origin = man.origin as Record<string, unknown> | undefined
    const src = origin?.source ?? man.sourceUrl ?? man.source_url
    if (typeof src === "string" && src.trim()) return { source: src }
  } catch {}
  return undefined
}

export function redact(message: string) {
  return message.replace(TOKEN, "[redacted]")
}

export function failureText(xs: SubmitFailure[]) {
  return xs.map(x => redact(x.message)).join("\n")
}

export async function defaults(input: { path: string }): Promise<SubmitMeta> {
  let bundle: SubmitBundle | undefined
  try { bundle = await previewSubmitBundle({ path: input.path }) } catch {}
  const meta = bundle?.meta as Head | undefined
  const name = typeof meta?.name === "string" ? meta.name : basename(input.path).replace(/\.eikon$/i, "")
  const author = authorName(meta?.author) ?? await ghUser() ?? process.env.USER ?? "unknown"
  const glyph = typeof meta?.glyph === "string" && meta.glyph.trim() ? meta.glyph.trim() : "◆"
  return {
    title: typeof meta?.title === "string" && meta.title.trim() ? meta.title.trim() : name,
    author,
    description: "Monochrome terminal avatar.",
    glyph,
  }
}

export async function preview(input: SubmitInput): Promise<SubmitPreview> {
  return prepare(input)
}

export async function prepare(input: SubmitInput): Promise<PreparedSubmit> {
  const base = await previewSubmitBundle({ path: input.path })
  const meta = sanitize(input.meta ?? await defaults(input))
  const target = repo(input.target ?? DEFAULT_REPO)
  const rel = `eikon-submissions/${base.meta.name}-${Date.now()}-${Math.random().toString(36).slice(2)}/${base.meta.name}`
  const root = hermesPath(rel)
  mkdirSync(root, { recursive: true })
  stage(base, root, meta, input.includeSource === true)
  const bundle = await previewSubmitBundle({ path: join(root, basename(base.packed)) })
  const req = request(bundle, meta, target)
  return {
    path: input.path,
    name: bundle.meta.name,
    files: bundle.files.map(f => ({ path: f.path, bytes: f.bytes })),
    meta,
    target,
    source: input.includeSource === true,
    bundleDir: root,
    bundleSource: makeSource(rel, rel),
    title: req.title,
    body: req.body,
    url: fallbackUrl(target, bundle.meta.name),
    steps: steps(target, bundle.meta.name),
    bundle,
    request: req,
    snapshot: snap(bundle),
  }
}

export async function submit(input: PreparedSubmit, backend?: SubmitBackend): Promise<SubmitResult> {
  let bundle: SubmitBundle
  try { bundle = await previewSubmitBundle({ path: join(input.bundleDir, basename(input.bundle.packed)) }) }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: "validation-failed", failures: [{ code: "invalid-eikon", message }] }
  }
  if (snap(bundle) !== input.snapshot) return {
    kind: "validation-failed",
    failures: [{ code: "invalid-eikon", message: "staged submission changed after preview; review the bundle again" }],
  }
  const be = backend ?? githubSubmitBackend(input.target)
  const setup = await be.check()
  if (!setup.ok) return { kind: "setup-needed", failures: [{ code: "missing-auth", message: redact(setup.reason) }] }
  try { return await be.create(request(bundle, input.meta, input.target)) }
  catch (err) { return { kind: "backend-failed", failures: [{ code: "backend-failed", message: redact(err instanceof Error ? err.message : String(err)) }] } }
}

function stage(bundle: SubmitBundle, root: string, meta: SubmitMeta, source: boolean) {
  const picked = source ? bundle.files : bundle.files.filter(f => f.abs === bundle.packed || f.path === basename(bundle.packed))
  for (const entry of picked) {
    if (entry.path === "manifest.json") continue
    const out = join(root, entry.path)
    mkdirSync(dirname(out), { recursive: true })
    copyFileSync(entry.abs, out)
  }
  const old = source && existsSync(join(bundle.root, "manifest.json"))
    ? JSON.parse(readFileSync(join(bundle.root, "manifest.json"), "utf8")) as Record<string, unknown>
    : {}
  writeFileSync(join(root, "manifest.json"), JSON.stringify({
    name: bundle.meta.name,
    version: typeof old.version === "number" ? old.version : 1,
    ...(typeof old.eikon_requires === "string" ? { eikon_requires: old.eikon_requires } : {}),
    ...(source && typeof old.source === "string" ? { source: old.source } : {}),
    states: source && old.states && typeof old.states === "object" && !Array.isArray(old.states) ? old.states : {},
    display: {
      title: meta.title,
      author: meta.author,
      description: meta.description,
      glyph: meta.glyph,
    },
  }, null, 2) + "\n", "utf8")
}

function request(bundle: SubmitBundle, meta: SubmitMeta, target: string): SubmitRequest {
  const title = `eikons: submit ${bundle.meta.name}`
  const body = [
    `Submits \`${bundle.meta.name}\` for official registry review.`,
    "",
    `Title: ${meta.title}`,
    `Author: ${meta.author}`,
    `Description: ${meta.description}`,
    `Glyph: ${meta.glyph}`,
    `Target: ${target}`,
    "",
    "Submission bundle:",
    ...bundle.files.map(f => `- ${f.path} (${f.bytes} bytes)`),
    "",
    "This PR makes the listed files public and reviewable. The Eikon is not officially listed or verified until registry review and merge.",
  ].join("\n")
  return { bundle, title, body }
}

function sanitize(meta: SubmitMeta): SubmitMeta {
  const next = {
    title: clean(meta.title),
    author: clean(meta.author),
    description: clean(meta.description),
    glyph: clean(meta.glyph),
  }
  const errs = Object.entries(next).flatMap(([key, value]) => {
    if (!value) return [`${key} required`]
    if (CTRL.test(value)) return [`${key} contains control characters`]
    if (secretLike(value)) return [`${key} looks secret-like`]
    if (unsafeUrl(value)) return [`${key} contains private or unsafe URL`]
    return []
  })
  if (Array.from(next.glyph).length > 2) errs.push("glyph must be one or two characters")
  if (errs.length) throw new Error(errs.join("\n"))
  return next
}

function secretLike(value: string) {
  TOKEN.lastIndex = 0
  return TOKEN.test(value) || SECRET.test(value)
}

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function authorName(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const name = (value as { name?: unknown }).name
    if (typeof name === "string" && name.trim()) return name.trim()
  }
  return undefined
}

function repo(value: string) {
  const clean = value.trim()
  if (!REPO.test(clean)) throw new Error(`invalid submit repo: ${value}`)
  return clean
}

function unsafeUrl(value: string) {
  const matches = value.match(/\b(?:https?|file|data|javascript):[^\s]+/gi) ?? []
  return matches.some(raw => {
    let url: URL
    try { url = new URL(raw) } catch { return false }
    if (url.protocol !== "http:" && url.protocol !== "https:") return true
    return privateHost(url.hostname)
  })
}

function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (!h || h === "::" || h === "localhost" || h.endsWith(".localhost")) return true
  const ipv4 = h.match(/^(\d+)\.(\d+)\./)
  if (ipv4 && privateIpv4(Number(ipv4[1]), Number(ipv4[2]))) return true
  if (h.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(h)) return true
  const mapped = h.match(/^::ffff:(?:(\d+)\.(\d+)\.|([0-9a-f]{1,4}):([0-9a-f]{1,4}))/)
  if (mapped?.[1] && privateIpv4(Number(mapped[1]), Number(mapped[2]))) return true
  if (mapped?.[3] && mapped?.[4]) {
    const n = Number.parseInt(mapped[3], 16) * 0x10000 + Number.parseInt(mapped[4], 16)
    return privateIpv4(Math.floor(n / 0x1000000), Math.floor(n / 0x10000) & 0xff)
  }
  return isIP(h) !== 0 && (h === "0.0.0.0" || h === "::1")
}

function privateIpv4(a: number, b: number): boolean {
  if (a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function fallbackUrl(target: string, name: string) {
  return `https://github.com/${target}/compare/main...submit%2F${encodeURIComponent(name)}`
}

function steps(target: string, name: string) {
  return [
    `Fork or open ${target} on GitHub.`,
    `Copy the prepared bundle from this machine into eikons/${name}/ on a submit/${name} branch.`,
    "Open a pull request with the title and body shown here.",
  ]
}

function stageRoot() {
  const root = hermesPath("eikon-submissions")
  mkdirSync(root, { recursive: true })
  return root
}

function snap(bundle: SubmitBundle) {
  const hash = createHash("sha256")
  for (const file of bundle.files) {
    hash.update(file.path)
    hash.update("\0")
    hash.update(String(file.bytes))
    hash.update("\0")
    hash.update(readFileSync(file.abs))
    hash.update("\0")
  }
  return hash.digest("hex")
}

async function ghUser() {
  try {
    const p = Bun.spawn(["gh", "api", "user", "-q", ".login"], { stdout: "pipe", stderr: "pipe" })
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited])
    return code === 0 && out.trim() ? out.trim() : undefined
  } catch {
    return undefined
  }
}

export function cleanup(input: PreparedSubmit) {
  const root = stageRoot()
  const parent = dirname(input.bundleDir)
  if (!parent.startsWith(`${root}/`)) return
  rmSync(parent, { recursive: true, force: true })
}

export * as submitSvc from "./eikon-submit"
