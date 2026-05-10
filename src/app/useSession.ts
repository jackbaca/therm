// Session lifecycle: create, resume, switch, interrupt, branch, compress, undo.

import { useMemo, useCallback } from "react"
import * as preferences from "../utils/preferences"
import * as sdb from "../utils/sessions-db"
import { useGateway } from "./gateway"
import { transcriptToMessages } from "./turnReducer"
import type { Launch } from "./launch"
import type { SessionResumeResponse, SessionCreateResponse } from "../utils/gateway-types"
import type { Message } from "../types/message"

/** session.compress response shape — see upstream fc7f55f49. */
export type CompressResult = {
  status?: "compressed" | "skipped"
  removed?: number
  before_messages?: number
  after_messages?: number
  before_tokens?: number
  after_tokens?: number
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
    const res = await gw.request<SessionResumeResponse>("session.resume", { session_id: target })
    const id = res.session_id
    gw.setSession(id)
    preferences.set("lastSessionId", res.resumed ?? target)
    const messages = res.messages?.length ? transcriptToMessages(res.messages) : []
    return { id, messages }
  }, [gw])

  const create = useCallback(async () => {
    const res = await gw.request<SessionCreateResponse>("session.create", {})
    gw.setSession(res.session_id)
    return res.session_id
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

    // mode:"new" — bare launch is ALWAYS a fresh session (herm-1jd). The
    // stored id exists only to reuse our own abandoned empty stub instead
    // of creating another row every launch. It may point at an ended
    // compression parent (the stub is its continuation), so chase the
    // chain tip before checking emptiness.
    const last = preferences.get("lastSessionId")
    const tip = last ? sdb.chainTip(last) : null
    if (tip && sdb.byId(tip)?.message_count === 0) {
      try { return await resume(tip) } catch { /* fall through */ }
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
    () => ({ boot, create, resume, interrupt, branch, compress, undo }),
    [boot, create, resume, interrupt, branch, compress, undo],
  )
}
