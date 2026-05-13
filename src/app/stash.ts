import { join } from "path"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { configDir } from "../utils/paths"

export type Entry = { text: string; at: number }

const MAX = 50
const file = () => join(configDir(), "stash.jsonl")

function load(): Entry[] {
  if (!existsSync(file())) return []
  return readFileSync(file(), "utf-8").split("\n").filter(Boolean)
    .map(l => JSON.parse(l) as Entry).slice(-MAX)
}

function save(list: Entry[]) {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(file(), list.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8")
}

export function push(text: string): number {
  const list = load()
  // Monotonic key: two pushes in the same ms must not collide, since
  // drop() keys on `at` alone.
  const at = Math.max(Date.now(), (list[list.length - 1]?.at ?? 0) + 1)
  list.push({ text, at })
  if (list.length > MAX) list.shift()
  save(list)
  return list.length
}

export function pop(): Entry | null {
  const list = load()
  const e = list.pop()
  if (!e) return null
  save(list)
  return e
}

export function all(): Entry[] {
  return load().reverse()
}

export function drop(at: number) {
  save(load().filter(e => e.at !== at))
}

export * as Stash from "./stash"
