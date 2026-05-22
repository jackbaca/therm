// Session lifecycle: create, resume, switch, interrupt, branch, compress, undo.

import { useMemo, useCallback } from "react"
import * as preferences from "../context/preferences"
import { sdb, byId } from "../service/sessions-db"
import { useGateway } from "../context/gateway"
import { transcriptToMessages } from "./turnReducer"
import type { Launch } from "./launch"
import type {
  SessionResumeResponse,
  SessionCreateResponse,
  SessionInfo,
  TranscriptMessage,
} from "../context/wire"
import type { Message, Usage } from "../types/message"

const spec = (row: ReturnType<typeof byId>) => {
  if (!row?.model) return null
  if (!row.billing_provider) return row.model
  return `${row.model} --provider ${row.billing_provider}`
}

/** session.compress response shape — see upstream fc7f55f49.
 *
 *  `messages` + `info` carry the post-compaction transcript and fresh
 *  session metadata; the gateway rewrites history in place and rotates
 *  session_id (agent._compress_context ends the old DB session and opens
 *  a continuation). Callers MUST re-hydrate local transcript state from
 *  `messages` — otherwise the TUI keeps the pre-compaction list and the
 *  next resume snaps it to the compacted history, looking like data loss. */
export type CompressResult = {
  status?: "compressed" | "skipped"
  removed?: number
  before_messages?: number
  after_messages?: number
  before_tokens?: number
  after_tokens?: number
  messages?: TranscriptMessage[]
  info?: SessionInfo
  usage?: Usage
  summary?: {
    noop?: boolean
    headline?: string
    token_line?: string
    note?: string | null
  }
}

type Booted = { id: string; messages: Message[]; note?: string }

export const normalize = (sid: string): string =>
  sid.trim().replace(/\.json$/i, "").replace(/^session_(?=\d{8}_)/, "")

type SessionOps = {
  /** Establish the initial session per launch intent. */
  boot: (launch: Launch) => Promise<Booted>
  create: () => Promise<string>
  resume: (sid: string) => Promise<{ id: string; messages: Message[] }>
  /** Finalize a gateway session (best-effort — swallows errors). */
  close: (sid: string) => Promise<void>
  interrupt: () => Promise<void>
  branch: (name?: string) => Promise<string | null>
  compress: () => Promise<CompressResult | null>
  undo: () => Promise<void>
}

export function useSession(): SessionOps {
  const gw = useGateway()

  const resume = useCallback(async (sid: string) => {
    // Normalize at the edge (argv / slash-arg can be `session_*.json`).
    // No tip-chasing here: Sessions-tab lineage walk and `/resume <id>`
    // pass exact ids on purpose; boot() resolves tips itself.
    const target = normalize(sid)
    const row = byId(target)
    const res = await gw.request<SessionResumeResponse>("session.resume", { session_id: target })
    const id = res.session_id
    gw.setSession(id)
    preferences.set("lastSessionId", res.resumed ?? target)
    const model = spec(row)
    if (model) await gw.request("config.set", { key: "model", value: model }).catch(() => {})
    const messages = res.messages?.length ? transcriptToMessages(res.messages) : []
    return { id, messages }
  }, [gw])

  // No `cols` param and no `terminal.resize` RPC on SIGWINCH: herm renders
  // markdown via OpenTUI's <markdown> from raw payload.text, so wrapping is
  // handled client-side by the layout tree on resize. The agent-side width
  // (session["cols"], fed to make_stream_renderer) only populates the
  // payload.rendered field that herm ignores, plus render_diff for the
  // checkpoint diff RPC — both default-80 is fine for our flow.
  const create = useCallback(async () => {
    const res = await gw.request<SessionCreateResponse>("session.create", {})
    gw.setSession(res.session_id)
    return res.session_id
  }, [gw])

  // Finalize a gateway session: marks the DB row ended, tears down the
  // per-session slash_worker subprocess, unregisters the approval
  // notifier, and drops the AIAgent from the gateway's `_sessions` map.
  // Without this, /new and session-switch leak one HermesCLI child
  // (slash_worker) + one live AIAgent per hop until quit, and the row's
  // `ended_at IS NULL` throws off lineage classification in Sessions
  // tab (sessions-db.ts SUB/CONT predicates). Parity with Ink TUI's
  // useSessionLifecycle.closeSession. Pass `session_id` explicitly so
  // auto-injection doesn't close whatever sid the gateway already
  // switched to.
  const close = useCallback(async (sid: string) => {
    if (!sid) return
    try { await gw.request("session.close", { session_id: sid }) } catch {}
  }, [gw])

  const boot = useCallback(async (launch: Launch): Promise<Booted> => {
    const fresh = async (note?: string) => ({ id: await create(), messages: [], note })

    if (launch.mode === "resume") {
      const target = launch.sid ?? sdb.lastReal()?.id
      if (!target) return fresh("no prior session to resume — starting fresh")
      try { return await resume(target) }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return fresh(`resume ${target} failed: ${msg} — starting fresh`)
      }
    }

    // mode:"new" — bare launch is fresh unless we can reuse our own
    // abandoned root stub. Do not chase compression tips here: a stored
    // old continuation can point at a 0-msg child and silently keep bare
    // `herm` attached to old lineage.
    const last = preferences.get("lastSessionId")
    const row = last ? sdb.byId(last) : null
    if (row?.message_count === 0 && row.parent_session_id == null) {
      try { return await resume(row.id) } catch { /* fall through */ }
    }
    return fresh()
  }, [create, resume])

  const interrupt = useCallback(async () => {
    try { await gw.request("session.interrupt") } catch {}
  }, [gw])

  const branch = useCallback(async (name?: string) => {
    try {
      const res = await gw.request<{ session_id?: string }>("session.branch", name ? { name } : {})
      return res.session_id ?? null
    } catch { return null }
  }, [gw])

  const compress = useCallback(async (): Promise<CompressResult | null> => {
    try { return await gw.request<CompressResult>("session.compress") }
    catch { return null }
  }, [gw])

  const undo = useCallback(async () => {
    try { await gw.request("session.undo") } catch {}
  }, [gw])

  return useMemo(
    () => ({ boot, create, resume, close, interrupt, branch, compress, undo }),
    [boot, create, resume, close, interrupt, branch, compress, undo],
  )
}
