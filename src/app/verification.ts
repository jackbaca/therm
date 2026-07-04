import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useGateway, useGatewayEvent } from "../context/gateway"
import type { GatewayEvent, VerificationStatusRequest, VerificationStatusResponse, VerificationState, VerificationStatus } from "../context/wire"

const MUTATES = new Set([
  "patch",
  "write_file",
  "terminal",
  "execute_code",
  "image_generate",
])

const LABELS: Record<VerificationStatus, string> = {
  not_applicable: "verify n/a",
  unverified: "verify unverified",
  passed: "verify passed",
  failed: "verify failed",
  stale: "verify stale",
}

const GLYPHS: Record<VerificationStatus, string> = {
  not_applicable: "○",
  unverified: "◇",
  passed: "✓",
  failed: "×",
  stale: "△",
}

const TONES: Record<VerificationStatus, VerificationModel["tone"]> = {
  not_applicable: "muted",
  unverified: "warn",
  passed: "ok",
  failed: "err",
  stale: "warn",
}

export type VerificationModel = {
  status: VerificationStatus
  glyph: string
  label: string
  detail: string
  tone: "muted" | "warn" | "ok" | "err"
}

function evidence(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
  const rec = v as Record<string, unknown>
  return ["command", "canonical_command", "message", "summary", "kind", "scope"]
    .map(key => {
      const val = rec[key]
      if (typeof val !== "string") return false
      return val.trim() && `${key}: ${val.trim()}`
    })
    .find(Boolean) || undefined
}

export function model(v: VerificationState | null | undefined): VerificationModel | null {
  if (!v) return null
  const paths = v.changed_paths?.filter(Boolean) ?? []
  const detail = evidence(v.evidence)
  const stale = v.status === "stale" && paths.length > 0
    ? `changed: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` +${paths.length - 3}` : ""}`
    : undefined
  return {
    status: v.status,
    glyph: GLYPHS[v.status],
    label: LABELS[v.status],
    detail: stale ?? detail ?? LABELS[v.status],
    tone: TONES[v.status],
  }
}

function mutates(ev: GatewayEvent): boolean {
  if (ev.type !== "tool.complete") return false
  const name = ev.payload.name?.trim()
  if (!name) return Boolean(ev.payload.inline_diff)
  return MUTATES.has(name) || Boolean(ev.payload.inline_diff)
}

export function useVerification(sid: string, cwd?: string): VerificationModel | null {
  const gw = useGateway()
  const [state, setState] = useState<VerificationState | null>(null)
  const disabled = useRef(false)
  const seq = useRef(0)
  const sidRef = useRef(sid); sidRef.current = sid
  const cwdRef = useRef(cwd); cwdRef.current = cwd

  const refresh = useCallback(() => {
    if (disabled.current || !sidRef.current || !cwdRef.current) {
      setState(null)
      return
    }
    const n = ++seq.current
    const params: VerificationStatusRequest = {
      session_id: sidRef.current,
      cwd: cwdRef.current,
    }
    gw.request<VerificationStatusResponse>("verification.status", params).then(r => {
      if (n === seq.current) setState(r.verification ?? null)
    }).catch(() => {
      disabled.current = true
      setState(null)
    })
  }, [gw])

  useEffect(() => {
    disabled.current = false
    refresh()
  }, [sid, cwd, refresh])

  useGatewayEvent(ev => {
    if (ev.session_id && sidRef.current && ev.session_id !== sidRef.current) return
    if (ev.type === "message.complete" || mutates(ev)) refresh()
  })

  return useMemo(() => model(state), [state])
}

export * as verification from "./verification"
