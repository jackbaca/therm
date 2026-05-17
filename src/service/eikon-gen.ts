// Direct subprocess bridge to hermes-agent's image_generate /
// video_generate tool functions. No gateway RPC — the installed
// hermes-agent venv is on disk and the tool modules are plain
// synchronous Python that returns a JSON string. We call them with
// `python -c`, parse stdout, and normalize to a local file path.
//
// `GenerateFn` is the injectable surface so tests (and future
// providers) can swap the backend without touching callers.

import { existsSync } from "node:fs"
import { hermesPath } from "./hermes-home"

export type GenerateKind = "image" | "video"
export type GenerateOpts = { seed?: string; seconds?: number; aspect?: string }
export type GenerateOut = { path: string } | { err: string }
export type GenerateFn = (kind: GenerateKind, prompt: string, opts: GenerateOpts) => Promise<GenerateOut>

const ROOT = () => hermesPath("hermes-agent")
const PY = () => {
  for (const v of ["venv", ".venv"]) {
    const p = `${ROOT()}/${v}/bin/python`
    if (existsSync(p)) return p
  }
  return "python3"
}

const q = (s: string) => JSON.stringify(s)

function code(kind: GenerateKind, prompt: string, o: GenerateOpts): string {
  if (kind === "image") return [
    "from tools.image_generation_tool import image_generate_tool as g",
    `print(g(${q(prompt)}, aspect_ratio=${q(o.aspect ?? "square")}))`,
  ].join("; ")
  const args: string[] = [`"prompt":${q(prompt)}`, `"aspect_ratio":${q(o.aspect ?? "1:1")}`]
  if (o.seconds) args.push(`"duration":${o.seconds}`)
  if (o.seed) args.push(`"image_url":${q(o.seed)}`)
  return [
    "from tools.video_generation_tool import _handle_video_generate as g",
    `print(g({${args.join(",")}}))`,
  ].join("; ")
}

/** Probe whether each gen backend is configured — cheaper than
 *  `toolsets.list` and checks provider availability, not just the
 *  toolset toggle. */
export async function probe(): Promise<{ image: boolean; video: boolean }> {
  const root = ROOT()
  if (!existsSync(root)) return { image: false, video: false }
  const src = [
    "import json",
    "from tools.image_generation_tool import check_image_generation_requirements as ci",
    "from tools.video_generation_tool import check_video_generation_requirements as cv",
    "print(json.dumps({'image': bool(ci()), 'video': bool(cv())}))",
  ].join("; ")
  const r = Bun.spawn([PY(), "-c", src], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const out = await new Response(r.stdout).text()
  if ((await r.exited) !== 0) return { image: false, video: false }
  const last = out.trim().split("\n").pop()!
  try { return JSON.parse(last) } catch { return { image: false, video: false } }
}

async function fetchTo(url: string, ext: string): Promise<string> {
  const tmp = `${process.env.TMPDIR ?? "/tmp"}/eikon-gen-${Date.now()}${ext}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status}`)
  await Bun.write(tmp, await res.arrayBuffer())
  return tmp
}

export const generate: GenerateFn = async (kind, prompt, opts) => {
  const r = Bun.spawn([PY(), "-c", code(kind, prompt, opts)],
    { cwd: ROOT(), stdout: "pipe", stderr: "pipe" })
  const [out, err, exit] = await Promise.all([
    new Response(r.stdout).text(),
    new Response(r.stderr).text(),
    r.exited,
  ])
  if (exit !== 0) return { err: (err || out).trim().split("\n").slice(-3).join(" ") || `python exited ${exit}` }
  const last = out.trim().split("\n").pop()
  if (!last) return { err: "no output" }
  let j: { success?: boolean; image?: string; video?: string; error?: string }
  try { j = JSON.parse(last) } catch { return { err: `unparseable: ${last.slice(0, 200)}` } }
  if (j.success === false || j.error) return { err: j.error ?? "provider error" }
  const ref = j.image ?? j.video
  if (!ref) return { err: "provider returned no asset" }
  if (ref.startsWith("/") || ref.startsWith("file://"))
    return { path: ref.replace(/^file:\/\//, "") }
  if (/^https?:\/\//.test(ref))
    return fetchTo(ref, kind === "image" ? ".png" : ".mp4")
      .then(p => ({ path: p }))
      .catch(e => ({ err: `download: ${e instanceof Error ? e.message : e}` }))
  return { err: `unrecognized asset ref: ${ref.slice(0, 80)}` }
}

// Swappable for tests; callers take GenerateFn as a parameter.
let impl: GenerateFn = generate
let probeImpl = probe
export const current = (): GenerateFn => impl
export const setImpl = (fn: GenerateFn | null) => { impl = fn ?? generate }
export const setProbe = (fn: typeof probe | null) => { probeImpl = fn ?? probe }
export const probeCached = () => probeImpl()

export * as gen from "./eikon-gen"
