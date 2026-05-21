// Up/down history for composer input, persisted under the herm config dir.
// On-disk format is JSONL of { input, parts? }. Legacy raw-string lines
// (newlines NUL-encoded) still load.

import { useState, useRef, useCallback } from "react"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "fs"
import { configDir } from "../utils/paths"
import type { Part, PartsSnapshot } from "./parts"

const MAX = 500

export type HistEntry = { input: string; parts: readonly Part[] }

const file = () => join(configDir(), "history")

function parse(line: string): HistEntry {
  if (line[0] === "{") {
    const j = safe(line)
    if (j && typeof j.input === "string") {
      return { input: j.input, parts: Array.isArray(j.parts) ? j.parts : [] }
    }
  }
  return { input: line.replace(/\0/g, "\n"), parts: [] }
}

function safe(s: string): { input?: unknown; parts?: unknown } | null {
  try { return JSON.parse(s) } catch { return null }
}

// In-memory order is newest-first (index 0 = most recent); on-disk is
// append-only newest-last, so load() reverses.
function load(): HistEntry[] {
  const FILE = file()
  if (!existsSync(FILE)) return []
  return readFileSync(FILE, "utf-8").split("\n").filter(Boolean)
    .map(parse).slice(-MAX).reverse()
}

function enc(e: HistEntry) {
  if (e.parts.length === 0) return JSON.stringify({ input: e.input })
  return JSON.stringify({ input: e.input, parts: e.parts })
}

export function useInputHistory(input: string, restore: (e: HistEntry) => void) {
  const hist = useRef<HistEntry[]>(null)
  if (hist.current === null) hist.current = load()
  const [, bump] = useState(0)
  const idx = useRef(-1)
  const stash = useRef<HistEntry>({ input: "", parts: [] })

  const push = useCallback((entry: HistEntry | string) => {
    idx.current = -1
    stash.current = { input: "", parts: [] }
    const e: HistEntry = typeof entry === "string" ? { input: entry, parts: [] } : entry
    if (!e.input && e.parts.length === 0) return
    const h = hist.current!
    const top = h[0]
    if (top && top.input === e.input && sameParts(top.parts, e.parts)) return
    h.unshift(e)
    const DIR = configDir()
    const FILE = file()
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
    if (h.length > MAX) {
      h.length = MAX
      writeFileSync(FILE, [...h].reverse().map(enc).join("\n") + "\n", "utf-8")
    } else {
      appendFileSync(FILE, enc(e) + "\n", "utf-8")
    }
    bump(n => n + 1)
  }, [])

  const up = useCallback(() => {
    const h = hist.current!
    if (h.length === 0) return
    if (idx.current === -1) stash.current = { input, parts: [] }
    const next = Math.min(idx.current + 1, h.length - 1)
    idx.current = next
    restore(h[next])
  }, [input, restore])

  const down = useCallback(() => {
    if (idx.current === -1) return
    const next = idx.current - 1
    idx.current = next
    restore(next === -1 ? stash.current : hist.current![next])
  }, [restore])

  return { push, up, down }
}

function sameParts(a: readonly Part[], b: readonly Part[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i]?.type !== b[i]?.type) return false
  return true
}

export type { PartsSnapshot }

