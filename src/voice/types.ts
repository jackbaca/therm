// Voice mode types for herm TUI.
// Mirrors upstream hermes-ink voice state management, adapted for OpenTUI.

/** Modifier portion of a parsed voice record key (ctrl+b → ctrl). */
export type VoiceMod = "ctrl" | "alt"

/** Parsed voice record key from `voice.record_key` config. */
export type VoiceKey = {
  mod: VoiceMod
  ch: string
  raw: string
}

/** Gateway `voice.toggle` response shape. */
export type VoiceToggleResponse = {
  enabled?: boolean
  record_key?: string
  tts?: boolean
  available?: boolean
  audio_available?: boolean
  stt_available?: boolean
  details?: string
}

/** Gateway `voice.record` response shape. */
export type VoiceRecordResponse = {
  status?: string
}

/** Runtime voice state. */
export type VoiceState = {
  /** Voice mode umbrella flag (on/off, toggled via /voice on|off). */
  enabled: boolean
  /** Currently recording (microphone open, VAD active). */
  recording: boolean
  /** Transcribing in progress (post-capture, pre-text). */
  processing: boolean
  /** Parsed record key binding from config (default: ctrl+b). */
  recordKey: VoiceKey
  /** TTS auto-speak enabled. */
  tts: boolean
}
