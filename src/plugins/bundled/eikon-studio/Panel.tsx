import { memo } from "react"
import type { HermPluginApi } from "../../types"
import { caps, type Knobs } from "./render"
import { ROWS, type Row, type Session, eff } from "./knobs"

import type { ColorInput } from "@opentui/core"

// Sidebar inner width after border+padding (see Sidebar.tsx: WIDTH=48, pad=1, border=1 each side → 44).
const W = 44

const bar = (v: number, lo: number, hi: number, n = 16) => {
  const i = Math.round(((v - lo) / (hi - lo)) * (n - 1))
  return "─".repeat(i) + "●" + "─".repeat(n - 1 - i)
}

function Mini(props: { k: Knobs; dims: Session["dims"]; fg: ColorInput; dim: ColorInput }) {
  // 12×6 cell minimap: outer = source aspect, inner = crop window at (ox,oy,zoom).
  const d = props.dims ?? { w: 1, h: 1 }
  const ar = d.w / d.h
  const bw = ar >= 1 ? 12 : Math.max(4, Math.round(12 * ar))
  const bh = ar >= 1 ? Math.max(3, Math.round(6 / ar)) : 6
  // crop is square side = min(w,h)*zoom → normalized to outer box
  const short = Math.min(bw, bh)
  const cw = Math.max(1, Math.round(short * props.k.zoom))
  const ch = cw
  const cx = Math.round((bw - cw) * props.k.ox)
  const cy = Math.round((bh - ch) * props.k.oy)
  const rows: string[] = []
  for (let y = 0; y < bh; y++) {
    let r = ""
    for (let x = 0; x < bw; x++) {
      const inX = x >= cx && x < cx + cw
      const inY = y >= cy && y < cy + ch
      r += inX && inY ? "▣" : "·"
    }
    rows.push(r)
  }
  return (
    <box flexDirection="column" paddingLeft={12}>
      {rows.map((r, i) => <text key={i} fg={props.dim}>{r}</text>)}
    </box>
  )
}

const Line = (props: { on: boolean; label: string; value: string; fg: ColorInput; hi: ColorInput; dim: ColorInput }) => (
  <box height={1}>
    <text>
      <span fg={props.on ? props.hi : props.dim}>{props.on ? "▸ " : "  "}</span>
      <span fg={props.on ? props.fg : props.dim}>{props.label.padEnd(10)}</span>
      <span fg={props.fg}>{props.value}</span>
    </text>
  </box>
)

export const Panel = memo((props: {
  api: HermPluginApi
  sess: Session
  row: Row
}) => {
  const t = props.api.theme.current
  const k = eff(props.sess, props.sess.state)
  const has = !!props.sess.per[props.sess.state]
  const ff = caps.ffmpeg
  const on = (r: Row) => props.row === r

  const trunc = (s: string, n: number) => s.length <= n ? s : "…" + s.slice(-(n - 1))

  return (
    <box flexDirection="column" flexGrow={1}>
      <box height={1}><text fg={t.accent}><strong>EIKON STUDIO</strong></text></box>
      <box height={1}><text fg={t.textMuted}>{trunc(props.sess.src, W)}</text></box>
      <box height={1} />

      <Line on={on("state")} label="state" fg={t.text} hi={t.accent} dim={t.textMuted}
            value={`◂ ${props.sess.state}${has ? " *" : ""} ▸`} />
      <Line on={on("symbols")} label="symbols" fg={t.text} hi={t.accent} dim={t.textMuted}
            value={`◂ ${k.symbols} ▸`} />
      <Line on={on("invert")} label="invert" fg={t.text} hi={t.accent} dim={t.textMuted}
            value={k.invert ? "● on" : "○ off"} />
      <Line on={on("contrast")} label="contrast" fg={ff ? t.text : t.textMuted} hi={t.accent} dim={t.textMuted}
            value={ff ? `${bar(k.contrast, 0.5, 3.0)}  ${k.contrast.toFixed(1)}` : "(needs ffmpeg)"} />
      <Line on={on("zoom")} label="zoom" fg={ff ? t.text : t.textMuted} hi={t.accent} dim={t.textMuted}
            value={ff ? `${bar(k.zoom, 0.3, 1.0)}  ${k.zoom.toFixed(2)}` : "(needs ffmpeg)"} />

      <box height={1} />
      <Line on={on("pan")} label="pan" fg={ff ? t.text : t.textMuted} hi={t.accent} dim={t.textMuted}
            value={ff ? "↑↓←→  (shift: fine)" : "(needs ffmpeg)"} />
      {ff ? <Mini k={k} dims={props.sess.dims} fg={t.text} dim={t.textMuted} /> : null}

      <box flexGrow={1} />
      <box height={1}><text fg={t.textMuted}>j/k row · h/l adj · = fork · r reset</text></box>
      <box height={1}><text fg={t.textMuted}>enter commit · b bake · esc discard</text></box>
    </box>
  )
})
