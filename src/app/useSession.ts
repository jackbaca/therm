// Session lifecycle: create, resume, switch, interrupt, branch, compress, undo.

import { useMemo, useCallback } from "react"
import * as preferences from "../utils/preferences"
import * as sdb from "../utils/sessions-db"
import { useGateway } from "./gateway"
import { transcriptToMessages } from "./turnReducer"
import type { Launch } from "./launch"
import type {
  SessionResumeResponse,
  SessionCreateResponse,
  SessionInfo,
  TranscriptMessage,
} from "../utils/gateway-types"
import type { Message, Usage } from "../types/message"

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
    const res = await gw.request<SessionResumeResponse>("session.resume", { session_id: sid })
    const id = res.session_id
    gw.setSession(id)
    preferences.set("lastSessionId", res.resumed ?? sid)
    const messages = res.messages?.length ? transcriptToMessages(res.messages) : []
    return { id, messages }
  }, [gw])

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
      catch { return fresh(`resume ${target} failed — starting fresh`) }
    }

    // mode:"new" — reuse our own abandoned empty stub instead of
    // creating another row every launch.
    const last = preferences.get("lastSessionId")
    if (last && sdb.byId(last)?.message_count === 0) {
      try { return await resume(last) } catch { /* fall through */ }
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
