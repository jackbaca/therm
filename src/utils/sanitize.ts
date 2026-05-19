// Render-safety: strip ANSI/control bytes from provider-, tool-, and
// gateway-sourced strings before they reach OpenTUI `<text>`. Pasted
// escapes in tool output, partial provider streams, and raw stderr
// can otherwise be interpreted by the terminal (mouse mode flips,
// cursor jumps, color leaks) or render as garbage cells.
//
// Markdown formatting, file links, and intentional spans/strong/u
// are unaffected — none of those carry literal C0/C1 bytes.

// ESC = 0x1B. The patterns below are anchored on it.
//
// Order matters: parameterized sequences (CSI/OSC/DCS/SOS/PM/APC)
// must match before the lone-ESC fallback or we'd eat the introducer
// and leave the parameter bytes as visible garbage.
//
//  - CSI: ESC [ params(0x30-0x3F)* intermediates(0x20-0x2F)* final(0x40-0x7E)
//         Dangling/unterminated CSI (no final byte yet, e.g. mid-stream
//         truncation) is matched too so a partial escape doesn't leak.
//  - OSC: ESC ] data* (BEL | ESC \) — terminator is BEL (0x07) or ST
//         (ESC \). Unterminated OSC tails are dropped to end-of-string.
//  - DCS/SOS/PM/APC: ESC (P|X|^|_) data* ST — same ST/EOS rule.
//  - Single-shift / two-byte: ESC followed by one byte in 0x20-0x7E
//         (charset designations, ESC 7, etc.). Must come after the
//         multi-byte forms.
//  - Lone trailing ESC: just drop.
const ANSI = new RegExp(
  [
    "\\x1B\\[[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]",   // CSI complete
    "\\x1B\\[[\\x30-\\x3F]*[\\x20-\\x2F]*",                // CSI dangling
    "\\x1B\\][^\\x07\\x1B]*(?:\\x07|\\x1B\\\\)?",          // OSC + tail
    "\\x1B[PX^_][^\\x1B]*(?:\\x1B\\\\)?",                  // DCS/SOS/PM/APC + tail
    "\\x1B[\\x20-\\x7E]",                                  // ESC + one printable
    "\\x1B",                                               // lone ESC
  ].join("|"),
  "g",
)

// C0 controls (except TAB \t = 0x09, LF \n = 0x0A, CR \r = 0x0D) plus
// DEL (0x7F) and C1 controls (0x80-0x9F). These can flip cursor state,
// trigger bells, or render as replacement glyphs inside OpenTUI.
const CTRL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g

/**
 * Strip ANSI escape sequences and stray control bytes from a string
 * intended for an OpenTUI `<text>` (or `<markdown>`) child. Returns
 * empty string for `null`/`undefined` so callers can compose without
 * a guard.
 */
export function sanitize(s: string | null | undefined): string {
  if (!s) return ""
  return s.replace(ANSI, "").replace(CTRL, "")
}
