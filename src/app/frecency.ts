// Frecency scoring for @-ref path completion. Append-only jsonl under
// configDir(); compacts to newest MAX on load/overflow. Score =
// frequency × 1/(1+days_since). Module-level — single consumer
// (useAtRefPopover) and the store doesn't need React.

import { join } from "path"
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs"
import { configDir } from "../utils/paths"

type Entry = { path: string; n: number; at: number }

const MAX = 1000
const file = () => join(configDir(), "frecency.jsonl")

let data: Record<string, Entry> | null = null

function load(): Record<string, Entry> {
  if (!existsSync(file())) return {}
  const rows = readFileSync(file(), "utf-8").split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l) as Entry } catch { return null } })
    .filter((e): e is Entry => e !== null)
  // Last write wins (append-only log), then cap by recency.
  const latest: Record<string, Entry> = {}
  for (const e of rows) latest[e.path] = e
  const kept = Object.values(latest).sort((a, b) => b.at - a.at).slice(0, MAX)
  if (kept.length < rows.length) {
    mkdirSync(configDir(), { recursive: true })
    writeFileSync(file(), kept.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8")
  }
  return Object.fromEntries(kept.map(e => [e.path, e]))
}

function ensure() { return data ??= load() }

export function score(p: string): number {
  const e = ensure()[p]
  if (!e) return 0
  const days = (Date.now() - e.at) / 86_400_000
  return e.n / (1 + days)
}

export function bump(p: string) {
  const d = ensure()
  const prev = d[p]
  const e: Entry = { path: p, n: (prev?.n ?? 0) + 1, at: Date.now() }
  d[p] = e
  mkdirSync(configDir(), { recursive: true })
  appendFileSync(file(), JSON.stringify(e) + "\n", "utf-8")
  if (Object.keys(d).length > MAX) {
    const kept = Object.values(d).sort((a, b) => b.at - a.at).slice(0, MAX)
    data = Object.fromEntries(kept.map(x => [x.path, x]))
    writeFileSync(file(), kept.map(x => JSON.stringify(x)).join("\n") + "\n", "utf-8")
  }
}

/** Test-only: drop the in-memory cache so the next read re-loads from disk. */
export function _reset() { data = null }

export * as frecency from "./frecency"
