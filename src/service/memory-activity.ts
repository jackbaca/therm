// Recent memory-tool invocations scraped from state.db.
//
// No gateway RPC or audit log exists for this; messages.tool_calls on
// assistant rows carries the full invocation JSON, so read sqlite
// directly (same pattern as hermes-analytics.ts).

import { stateDb } from "./sessions-db"

type MemoryOp = "write" | "read"

export type MemoryActivity = {
  ts: number
  provider: string
  tool: string
  op: MemoryOp
  /** Human verb: add, replace, remove, conclude, search, … */
  verb: string
  /** Short payload summary (query text, content head, target). */
  summary: string
  sessionId: string
  sessionTitle: string
}

// Tool-name → provider. Built from plugins/memory/*/__init__.py tool
// defs + the core `memory` tool.
const WRITE: Record<string, string> = {
  memory: "builtin",
  mem0_conclude: "mem0",
  honcho_conclude: "honcho",
  hindsight_retain: "hindsight", hindsight_reflect: "hindsight",
  fact_store: "holographic", fact_feedback: "holographic",
  viking_remember: "openviking", viking_add_resource: "openviking",
  retaindb_remember: "retaindb", retaindb_forget: "retaindb",
  supermemory_store: "supermemory", supermemory_forget: "supermemory",
  brv_curate: "byterover",
}
const READ: Record<string, string> = {
  mem0_search: "mem0", mem0_profile: "mem0",
  honcho_search: "honcho", honcho_profile: "honcho",
  honcho_reasoning: "honcho", honcho_context: "honcho",
  hindsight_recall: "hindsight",
  viking_search: "openviking", viking_read: "openviking", viking_browse: "openviking",
  retaindb_search: "retaindb", retaindb_profile: "retaindb", retaindb_context: "retaindb",
  supermemory_search: "supermemory", supermemory_profile: "supermemory",
  brv_query: "byterover", brv_status: "byterover",
}

const MEMORY_TOOLS = { ...WRITE, ...READ }

const trunc = (s: unknown, n = 80): string => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}

const stripPrefix = (name: string): string =>
  name.replace(/^(mem0|honcho|hindsight|viking|retaindb|supermemory|brv|fact)_/, "")

type Args = Record<string, unknown>

const describe = (name: string, args: Args): { verb: string; summary: string } => {
  if (name === "memory") {
    const action = String(args.action ?? "")
    const target = String(args.target ?? "")
    const body = action === "remove" ? args.old_text : args.content ?? args.old_text
    return { verb: action, summary: `${target}: ${trunc(body)}` }
  }
  const verb = stripPrefix(name)
  for (const k of ["conclusion", "content", "query", "text", "fact", "question", "note", "path"])
    if (k in args) return { verb, summary: trunc(args[k]) }
  const first = Object.values(args).find(v => typeof v === "string")
  return { verb, summary: trunc(first ?? "") }
}

type Row = {
  ts: number
  tool_calls: string
  session_id: string
  title: string | null
}

/** Parse memory-tool calls out of a single assistant row. Exported for test. */
export const extract = (r: Row): MemoryActivity[] => {
  let calls: Array<{ function?: { name?: string; arguments?: string } }>
  try { calls = JSON.parse(r.tool_calls) } catch { return [] }
  if (!Array.isArray(calls)) return []
  const out: MemoryActivity[] = []
  for (const c of calls) {
    const name = c.function?.name
    if (!name || !(name in MEMORY_TOOLS)) continue
    let args: Args = {}
    try { args = JSON.parse(c.function?.arguments ?? "{}") } catch { /* keep {} */ }
    const { verb, summary } = describe(name, args)
    out.push({
      ts: r.ts,
      provider: MEMORY_TOOLS[name],
      tool: name,
      op: name in WRITE ? "write" : "read",
      verb, summary,
      sessionId: r.session_id,
      sessionTitle: r.title ?? r.session_id,
    })
  }
  return out
}

/**
 * Scan recent assistant rows for memory-tool invocations.
 *
 * Bounded by `scan` (row window), not DB size — tool_calls isn't indexed
 * and json_each over the whole table is unbounded. 2000 rows ≈ a few
 * days of heavy use.
 */
export function readMemoryActivity(limit = 100, scan = 2000): MemoryActivity[] {
  const db = stateDb()
  if (!db) return []
  const rows = db.query<Row, [number]>(
    `SELECT m.timestamp ts, m.tool_calls, m.session_id,
            s.title
     FROM messages m LEFT JOIN sessions s ON m.session_id = s.id
     WHERE m.role = 'assistant' AND m.tool_calls IS NOT NULL
     ORDER BY m.id DESC LIMIT ?`,
  ).all(scan)
  const out: MemoryActivity[] = []
  for (const r of rows) {
    for (const a of extract(r)) {
      out.push(a)
      if (out.length >= limit) return out
    }
  }
  return out
}
