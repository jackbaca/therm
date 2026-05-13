// Per-model / per-day / per-tool / per-source aggregates from state.db.
//
// The gateway's insights.get RPC returns bare counts; herm reads the
// sqlite file directly (same pattern as sessions-db) for richer
// breakdowns. All numbers come from the sessions table — it already
// carries rolled-up input/output/cache token counts and est/actual
// cost per session, so no messages join is needed except for tool
// names. Tool counts json_each() the assistant tool_calls column
// because tool_name on role='tool' rows is unpopulated outside the
// gateway writer path.

import { stateDb } from "./sessions-db"

export type ModelRow = {
  model: string; sessions: number
  input: number; output: number; cache: number; cost: number
}
export type DayRow = { date: string; sessions: number; cost: number }
export type NameRow = { name: string; n: number }

export type Analytics = {
  total: {
    sessions: number; messages: number
    input: number; output: number; cache: number; cost: number
    calls: number
  }
  byModel: ModelRow[]
  byDay: DayRow[]
  byTool: NameRow[]
  bySource: NameRow[]
}

const ZERO: Analytics = {
  total: { sessions: 0, messages: 0, input: 0, output: 0, cache: 0, cost: 0, calls: 0 },
  byModel: [], byDay: [], byTool: [], bySource: [],
}

type Row = Record<string, number | string | null>
const num = (v: unknown) => Number(v) || 0

// ISO yyyy-mm-dd for local date — used to fill gaps in byDay so the
// chart always has `days` columns even when some days had no sessions.
const iso = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const COST = "COALESCE(actual_cost_usd, estimated_cost_usd, 0)"
const CACHE = "COALESCE(cache_read_tokens,0)+COALESCE(cache_write_tokens,0)"

// Module-level cache, keyed by window. The Analytics tab remounts on
// every tab switch (app.tsx renders one body at a time), so without
// this the cold ~1.5s sqlite cost hits every re-entry. Entries are
// refreshed-in-place on mount so numbers stay live; `r` key clears.
export const cache = new Map<number, Analytics>()

export function analytics(days: number, opts?: { tools?: boolean }): Analytics {
  const since = Math.floor(Date.now() / 1000) - days * 86400
  const db = stateDb()
  if (!db) return ZERO
  const q = db.query.bind(db)
  const tot = q(
    `SELECT COUNT(*) n,
            COALESCE(SUM(message_count),0) msgs,
            COALESCE(SUM(input_tokens),0) i,
            COALESCE(SUM(output_tokens),0) o,
            COALESCE(SUM(${CACHE}),0) c,
            COALESCE(SUM(tool_call_count),0) calls,
            COALESCE(SUM(${COST}),0) cost
     FROM sessions WHERE started_at > ?`,
  ).get(since) as Row

  const models = q(
    `SELECT COALESCE(model,'(unknown)') model,
            COUNT(*) n,
            COALESCE(SUM(input_tokens),0) i,
            COALESCE(SUM(output_tokens),0) o,
            COALESCE(SUM(${CACHE}),0) c,
            COALESCE(SUM(${COST}),0) cost
     FROM sessions WHERE started_at > ?
     GROUP BY model ORDER BY i+o DESC`,
  ).all(since) as Row[]

  const daily = q(
    `SELECT date(started_at,'unixepoch','localtime') day,
            COUNT(*) n,
            COALESCE(SUM(${COST}),0) cost
     FROM sessions WHERE started_at > ?
     GROUP BY day`,
  ).all(since) as Row[]
  const byDate = new Map(daily.map(r =>
    [String(r.day), { date: String(r.day), sessions: num(r.n), cost: num(r.cost) }]))

  const sources = q(
    `SELECT COALESCE(source,'(unknown)') name, COUNT(*) n
     FROM sessions WHERE started_at > ?
     GROUP BY name ORDER BY n DESC`,
  ).all(since) as Row[]

  // json_each over assistant tool_calls. Bounded by started_at via
  // the sessions join; this is the only query that touches `messages`,
  // and on a cold 400 MB+WAL db it dominates wall time by two orders
  // of magnitude (sequential SCAN m is cheaper than index-driven
  // random seeks here, so no CROSS JOIN hint). The Analytics tab
  // defers this one behind a frame yield so the rest of the pane
  // renders first. Missing json_each (older sqlite) degrades to [].
  const tools: Row[] = (() => {
    if (opts?.tools === false) return []
    try {
      return q(
        `SELECT json_extract(j.value,'$.function.name') name, COUNT(*) n
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         , json_each(m.tool_calls) j
         WHERE s.started_at > ? AND m.role='assistant'
           AND m.tool_calls IS NOT NULL
         GROUP BY name ORDER BY n DESC LIMIT 30`,
      ).all(since) as Row[]
    } catch { return [] }
  })()

  const start = Date.now() - (days - 1) * 86400_000
  return {
    total: {
      sessions: num(tot.n), messages: num(tot.msgs),
      input: num(tot.i), output: num(tot.o), cache: num(tot.c),
      cost: num(tot.cost), calls: num(tot.calls),
    },
    byModel: models.map(r => ({
      model: String(r.model), sessions: num(r.n),
      input: num(r.i), output: num(r.o), cache: num(r.c), cost: num(r.cost),
    })),
    byDay: Array.from({ length: Math.max(1, Math.ceil(days)) }, (_, k) => {
      const key = iso(start + k * 86400_000)
      return byDate.get(key) ?? { date: key, sessions: 0, cost: 0 }
    }),
    byTool: tools.map(r => ({ name: String(r.name), n: num(r.n) })),
    bySource: sources.map(r => ({ name: String(r.name), n: num(r.n) })),
  }
}
