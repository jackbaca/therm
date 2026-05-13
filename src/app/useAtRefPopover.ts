// @-ref completion for the composer. Triggers when the word under the
// cursor starts with `@` (and we're not in slash mode). A fixed keyword
// set (diff/staged/git:N/url:/folder:) is defined client-side and
// prepended to whatever the gateway's `complete.path` returns — the
// gateway still handles path completion for `@file:…` / `@folder:…`
// (and maps bare `@<path>` → `@file:` / `@folder:`).
//
// Expansion itself happens server-side in `prompt.submit`; this hook
// only drives the popover UI and text insertion.

import { useEffect, useRef, useState } from "react"
import { useGateway, useGatewayReady } from "../context/gateway"
import { frecency } from "./frecency"

export type AtRefItem = {
  readonly text: string
  readonly display: string
  readonly meta: string
}

// Fixed hermes @-keywords. Shown above file results; `text` is what
// gets inserted (trailing `:` keeps the popover open for further input).
export const KEYWORDS: ReadonlyArray<AtRefItem> = [
  { text: "@diff",    display: "@diff",          meta: "working-tree diff" },
  { text: "@staged",  display: "@staged",        meta: "staged changes" },
  { text: "@git:1",   display: "@git:1",         meta: "last 1 commit" },
  { text: "@git:3",   display: "@git:3",         meta: "last 3 commits" },
  { text: "@git:5",   display: "@git:5",         meta: "last 5 commits" },
  { text: "@url:",    display: "@url:<…>",       meta: "fetch a URL" },
  { text: "@folder:", display: "@folder:<path>", meta: "recurse directory" },
]

// Keywords whose text strictly extends `word` (case-insensitive).
// Exact matches are dropped so e.g. accepting `@url:` closes the
// popover and `@folder:` hands off cleanly to path completion.
export function match(word: string): AtRefItem[] {
  const q = word.toLowerCase()
  return KEYWORDS.filter(k => k.text.toLowerCase().startsWith(q) && k.text !== word)
}

// Find the @-word the caret sits inside. Walks back from `cursor`
// (byte offset into the full buffer, defaults to end) to the nearest
// word boundary and checks for a leading `@`. Bails when line 1
// starts with `/` so the slash and @-ref popovers never contend.
export function atWordAt(input: string, cursor = input.length): { word: string; start: number } | null {
  if (input.startsWith("/")) return null
  let i = cursor
  while (i > 0 && !/\s/.test(input[i - 1])) i--
  if (input[i] !== "@") return null
  let j = cursor
  while (j < input.length && !/\s/.test(input[j])) j++
  return { word: input.slice(i, j), start: i }
}

export function useAtRefPopover(input: string, cursor?: number) {
  const gw = useGateway()
  const ready = useGatewayReady()
  const [items, setItems] = useState<AtRefItem[]>([])
  const [sel, setCursor] = useState(0)
  const seq = useRef(0)
  const dismissed = useRef<string | null>(null)

  const spot = atWordAt(input, cursor)

  useEffect(() => {
    if (!spot || !ready) { setItems([]); setCursor(0); return }
    if (dismissed.current === spot.word) return
    dismissed.current = null
    const me = ++seq.current
    const fixed = match(spot.word)
    const t = setTimeout(() => {
      gw.request<{ items: AtRefItem[] }>("complete.path", { word: spot.word })
        .then(r => {
          if (seq.current !== me) return
          const seen = new Set(fixed.map(k => k.text))
          // Frecency lifts previously-accepted paths above alphabetic/
          // relevance order from the gateway; ties preserve server
          // order (stable sort).
          const ranked = (r.items ?? []).filter(i => !seen.has(i.text))
            .map(i => ({ i, s: frecency.score(i.text) }))
            .sort((a, b) => b.s - a.s)
            .map(x => x.i)
          setItems([...fixed, ...ranked])
          setCursor(0)
        })
        .catch(() => { if (seq.current === me) { setItems(fixed); setCursor(0) } })
    }, 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot?.word, ready, gw])

  const open = spot !== null && items.length > 0

  const accept = (src: string, idx = sel, off?: number): string | null => {
    const at = atWordAt(src, off)
    const it = items[idx]
    if (!at || !it) return null
    // Bump for path-like completions (has `:` and not a fixed keyword
    // prefix like `@url:`/`@folder:`).
    if (it.text.includes(":") && !it.text.endsWith(":")) frecency.bump(it.text)
    const trail = it.text.endsWith(":") || it.text.endsWith("/") ? "" : " "
    return src.slice(0, at.start) + it.text + trail + src.slice(at.start + at.word.length)
  }

  const dismiss = () => {
    seq.current++
    dismissed.current = spot?.word ?? null
    setItems([])
  }

  return { open, items, cursor: sel, setCursor, accept, dismiss }
}
