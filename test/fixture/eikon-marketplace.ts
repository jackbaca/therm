import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const stream = (name = "remote") => [
  JSON.stringify({ type: "header", asset: { version: "2.0", width: 6, height: 2 }, name, glyph: "◆" }),
  JSON.stringify({ type: "clip", name: "idle", fps: 4, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["idle  ", "......"] }),
  JSON.stringify({ type: "clip", name: "listening", fps: 4, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "listening", index: 0, rows: ["listen", "......"] }),
  JSON.stringify({ type: "clip", name: "thinking", fps: 4, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "thinking", index: 0, rows: ["think ", "......"] }),
  JSON.stringify({ type: "clip", name: "speaking", fps: 4, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "speaking", index: 0, rows: ["speak ", "......"] }),
  JSON.stringify({ type: "clip", name: "working", fps: 4, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "working", index: 0, rows: ["work  ", "......"] }),
  JSON.stringify({ type: "clip", name: "error", fps: 4, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "error", index: 0, rows: ["error ", "......"] }),
].join("\n") + "\n"

export const manifest = (name = "remote") => ({
  kind: "eikon.package",
  schemaVersion: "1.0",
  id: `pkg.${name}`,
  name,
  version: "1.0.0",
  display: { title: "Remote Eikon", author: "Eikon CI", glyph: "◆", tags: ["launch"] },
  compatibility: { eikon: ">=2 <3", hosts: { herm: ">=0" } },
  entrypoints: { default: "avatar.eikonl" },
  files: [{ path: "avatar.eikonl", role: "stream", mediaType: "application/vnd.eikon.stream+jsonl" }],
  poster: "poster.txt",
  preview: "avatar.eikonl",
  signals: { "state.working": { clip: "working", fallback: "state.idle" } },
  triggers: [{ signal: "state.error", when: "error", fallback: "state.idle" }],
  extensions: { used: ["eikon.palette.v1"] },
})

export function packageDir(root: string, name = "remote") {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest(name), null, 2) + "\n")
  writeFileSync(join(dir, "avatar.eikonl"), stream(name))
  writeFileSync(join(dir, "poster.txt"), "poster")
  return dir
}
