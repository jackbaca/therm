// Voice mode state hook for herm TUI.
// Manages runtime voice state: enabled/recording/processing flags,
// record key parsing from config, and actions (toggle, record start/stop).

import { useState, useCallback, useMemo } from "react"
import type { VoiceState, VoiceToggleResponse, VoiceRecordResponse } from "./types"
import { parseVoiceRecordKey, formatVoiceRecordKey, DEFAULT_VOICE_KEY } from "./platform"

/** Shape of the gateway client's `request` method — subset needed for voice. */
type GwRpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>

export type VoiceApi = {
  state: VoiceState
  /** Toggle voice mode (on/off/tts/status) via gateway. */
  toggle: (action: string, sid: string) => Promise<void>
  /** Start or stop VAD-bounded recording via gateway. */
  record: (sid: string) => Promise<void>
  /** Set voice enabled from event (e.g. no_speech_limit auto-off). */
  setEnabled: (v: boolean) => void
  /** Set recording state from voice.status event. */
  setRecording: (v: boolean) => void
  /** Set processing state from voice.status event. */
  setProcessing: (v: boolean) => void
  /** Update record key from config (called after voice.toggle response). */
  setRecordKey: (raw: string | undefined) => void
  /** Formatted display string for the record key (e.g. "Ctrl+B"). */
  keyLabel: string
  /** Callback for voice transcript — inserts text into composer. */
  onTranscript: ((text: string) => void) | null
  setOnTranscript: (fn: ((text: string) => void) | null) => void
}

export function useVoice(gw: GwRpc, sys: (text: string) => void): VoiceApi {
  const [enabled, setEnabled] = useState(false)
  const [recording, setRecording] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [recordKeyRaw, setRecordKeyRaw] = useState<string>()
  const [tts, setTts] = useState(false)
  const [onTranscript, setTranscript] = useState<((text: string) => void) | null>(null)
  const setOnTranscript = useCallback((fn: ((text: string) => void) | null) =>
    setTranscript(fn ? () => fn : null), [])

  const recordKey = useMemo(
    () => parseVoiceRecordKey(recordKeyRaw),
    [recordKeyRaw],
  )

  const keyLabel = useMemo(
    () => formatVoiceRecordKey(recordKey),
    [recordKey],
  )

  const state: VoiceState = useMemo(() => ({
    enabled, recording, processing, recordKey, tts,
  }), [enabled, recording, processing, recordKey, tts])

  const toggle = useCallback(async (action: string, sid: string) => {
    try {
      const r = await gw<VoiceToggleResponse>("voice.toggle", {
        action,
        session_id: sid,
      })
      if (r.enabled !== undefined) setEnabled(r.enabled)
      if (r.tts !== undefined) setTts(r.tts)
      if (r.record_key) setRecordKeyRaw(r.record_key)
      const label = formatVoiceRecordKey(parseVoiceRecordKey(r.record_key))
      const ttsMsg = r.tts ? " · tts on" : ""
      sys(`voice ${r.enabled ? "on" : "off"}${ttsMsg} [${label}]`)
    } catch (e) {
      sys(`voice: ${e instanceof Error ? e.message : "gateway error"}`)
    }
  }, [gw, sys])

  const record = useCallback(async (sid: string) => {
    if (!enabled) {
      sys("voice: mode is off — enable with /voice on")
      return
    }
    const starting = !recording
    const action = starting ? "start" : "stop"
    // Optimistic UI update
    if (starting) {
      setRecording(true)
    } else {
      setRecording(false)
      setProcessing(false)
    }
    try {
      const r = await gw<VoiceRecordResponse>("voice.record", {
        action,
        session_id: sid,
      })
      // Reconcile on failure
      if (starting && r.status !== "recording") {
        setRecording(false)
        if (r.status === "busy") {
          setProcessing(true)
          sys("voice: still transcribing; try again shortly")
        }
      }
    } catch (e) {
      if (starting) setRecording(false)
      sys(`voice error: ${e instanceof Error ? e.message : "gateway error"}`)
    }
  }, [enabled, recording, gw, sys])

  return {
    state, toggle, record,
    setEnabled, setRecording, setProcessing,
    setRecordKey: setRecordKeyRaw,
    keyLabel,
    onTranscript, setOnTranscript,
  }
}
