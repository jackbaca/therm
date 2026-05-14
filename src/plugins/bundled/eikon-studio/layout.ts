// ~/.hermes/eikons/ directory layout. Each eikon lives in its own folder:
//
//   eikons/
//     <name>/
//       <name>.eikon        packed NDJSON
//       source/             images/videos that built it (base.png, idle.mp4, …)
//
// Flat <name>.eikon at the top level is still read (legacy + install
// side-channel) — listEikons scans recursively — but new writes go to the
// folder form. `source/` lets the studio reopen an existing eikon for
// editing without the user re-supplying the image.

import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs"
import { join, extname, basename } from "node:path"
import { hermesPath } from "../../../service/hermes-home"

const ROOT = () => hermesPath("eikons")

export const dir = (name: string) => join(ROOT(), name)
export const file = (name: string) => join(dir(name), `${name}.eikon`)
export const source = (name: string) => join(dir(name), "source")

export function ensure(name: string) {
  mkdirSync(source(name), { recursive: true })
  return { dir: dir(name), file: file(name), source: source(name) }
}

/** List installed eikons that have the folder layout. */
export function list(): { name: string; file: string; source: string; hasSource: boolean }[] {
  const root = ROOT()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(root, e.name, `${e.name}.eikon`)))
    .map(e => {
      const src = join(root, e.name, "source")
      const has = existsSync(src) && readdirSync(src).length > 0
      return { name: e.name, file: join(root, e.name, `${e.name}.eikon`), source: src, hasSource: has }
    })
}

const IMG = /\.(png|jpe?g|webp|gif|bmp)$/i
const VID = /\.(mp4|webm|mov|mkv)$/i

/** Find a usable base source file for editing. Preference:
 *  base.* → idle.* → <name>.* → first image → first video. */
export function findSource(name: string): string | undefined {
  const src = source(name)
  if (!existsSync(src)) return undefined
  const files = readdirSync(src).filter(f => IMG.test(f) || VID.test(f))
  if (files.length === 0) return undefined
  const by = (stem: string) => files.find(f => basename(f, extname(f)).toLowerCase() === stem)
  return join(src, by("base") ?? by("idle") ?? by(name) ?? files.find(f => IMG.test(f)) ?? files[0]!)
}

/** Copy an external source file into <name>/source/, named by role.
 *  Returns the destination path. No-op if already inside that source/. */
export function adopt(name: string, from: string, role = "base"): string {
  const dst = join(ensure(name).source, `${role}${extname(from).toLowerCase()}`)
  if (from === dst) return dst
  copyFileSync(from, dst)
  return dst
}
