// Full-width Eikon tab. Left: 48×24 preview + state-strip (six posters).
// Right: knob list. The sidebar_avatar slot mirrors the same `doc` via
// the shared store, so the herm sidebar stays in sync while you edit.

import { useMemo, useRef, useState } from "react"
import { useKeyboard } from "@opentui/react"
import type { ParsedKey } from "@opentui/core"
import type { HermPluginApi } from "../../types"
import { caps, K0, type Knobs } from "./render"
import { STATES, ROWS, liveRows, rowDef, step, pan, eff, edit, cycle, fork, fresh, resetKnobs, type Row, type Session } from "./knobs"
import type { AvatarState } from "../../../components/avatar/states"
import { useStore } from "./store"

const W = 48
const H = 24

const bar = (v: number, lo: number, hi: number, n = 20) => {
  const i = Math.round(((v - lo) / (hi - lo)) * (n - 1))
  return "─".repeat(Math.max(0, i)) + "●" + "─".repeat(Math.max(0, n - 1 - i))
}

const flipLabel = (k: Knobs) =>
  k.flipH && k.flipV ? "⇔⇕ both" : k.flipH ? "⇔ horiz" : k.flipV ? "⇕ vert" : "none"

type Line = { row: Row; label: string; value: string; dim?: boolean }

function lines(s: Session, k: Knobs): Line[] {
  const ff = caps.ffmpeg
  const need = "(needs ffmpeg)"
  return [
    { row: "source",   label: "source",   value: s.src.replace(process.env.HOME ?? "", "~") },
    { row: "state",    label: "state",    value: `◂ ${s.state}${s.per[s.state] ? " *" : ""} ▸` },
    { row: "symbols",  label: "symbols",  value: `◂ ${k.symbols} ▸` },
    { row: "invert",   label: "invert",   value: k.invert ? "● on" : "○ off" },
    { row: "flip",     label: "flip",     value: ff ? `◂ ${flipLabel(k)} ▸` : need, dim: !ff },
    { row: "contrast", label: "contrast", value: ff ? `${bar(k.contrast, 0.5, 3.0)}  ${k.contrast.toFixed(1)}` : need, dim: !ff },
    { row: "zoom",     label: "zoom",     value: ff ? `${bar(k.zoom, 0.3, 1.0)}  ${k.zoom.toFixed(2)}` : need, dim: !ff },
    { row: "pan",      label: "pan",      value: ff ? "↑↓←→  (shift: fine)" : need, dim: !ff },
    { row: "name",     label: "name",     value: s.name },
    { row: "glyph",    label: "glyph",    value: s.glyph },
  ]
}

function Mini(props: { k: Knobs; dims: Session["dims"]; theme: HermPluginApi["theme"]["current"] }) {
  const d = props.dims ?? { w: 1, h: 1 }
  const ar = d.w / d.h
  const bw = ar >= 1 ? 16 : Math.max(4, Math.round(16 * ar))
  const bh = ar >= 1 ? Math.max(3, Math.round(8 / ar)) : 8
  const short = Math.min(bw, bh)
  const cw = Math.max(1, Math.round(short * props.k.zoom))
  const cx = Math.round((bw - cw) * props.k.ox)
  const cy = Math.round((bh - cw) * props.k.oy)
  return (
    <box flexDirection="column" paddingLeft={12}>
      {Array.from({ length: bh }, (_, y) => (
        <text key={y} fg={props.theme.textMuted}>
          {Array.from({ length: bw }, (_, x) =>
            x >= cx && x < cx + cw && y >= cy && y < cy + cw ? "▣" : "·").join("")}
        </text>
      ))}
    </box>
  )
}

function Frame(props: { lines: string[]; fg: import("@opentui/core").ColorInput }) {
  return (
    <box flexDirection="column">
      {props.lines.map((ln, i) => <text key={i} fg={props.fg} wrapMode="none">{ln}</text>)}
    </box>
  )
}

function Strip(props: { s: Session; doc: import("../../../components/avatar/eikon").ParsedEikon; api: HermPluginApi }) {
  const t = props.api.theme.current
  return (
    <box flexDirection="row" gap={2}>
      {STATES.map(st => {
        const clip = props.doc.states.get(st)
        const own = !!props.s.per[st]
        const on = props.s.state === st
        return (
          <box key={st} flexDirection="column" alignItems="center">
            <box border borderStyle="rounded" borderColor={on ? t.accent : t.border} paddingX={1}
                 width={18} height={10} overflow="hidden" alignItems="center" justifyContent="center">
              <Frame fg={on ? t.text : t.textMuted}
                     lines={(clip?.frames[0] ?? []).filter((_, i) => i % 3 === 0).map(l => l.slice(0, 32).replace(/.(.)/g, "$1"))} />
            </box>
            <box height={1}><text fg={on ? t.accent : t.textMuted}>{`${own ? "*" : " "}${st}`}</text></box>
          </box>
        )
      })}
    </box>
  )
}

export function Tab(props: {
  api: HermPluginApi
  onOpen: (path: string) => void
  onCommit: () => void
  onBake: () => void
  onDiscard: () => void
  onSess: (fn: (s: Session) => Session) => void
}) {
  const t = props.api.theme.current
  const snap = useStore()
  const [row, setRow] = useState<Row>("symbols")
  const rows = useMemo(liveRows, [])
  const debounced = useRef<ReturnType<typeof setTimeout> | null>(null)

  const s = snap.sess
  const k = s ? eff(s, s.state) : K0

  const prompt = async (r: Row) => {
    if (r === "source") {
      const p = await props.api.ui.prompt({ title: "Source image", label: "path (png/jpg/webp/gif)", initial: s?.src })
      if (p) props.onOpen(p)
      return
    }
    if (!s) return
    if (r === "name") {
      const v = await props.api.ui.prompt({ title: "Name", initial: s.name })
      if (v) props.onSess(x => ({ ...x, name: v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "wip" }))
    }
    if (r === "glyph") {
      const v = await props.api.ui.prompt({ title: "Glyph (1 char)", initial: s.glyph })
      if (v) props.onSess(x => ({ ...x, glyph: [...v][0] ?? "◆" }))
    }
  }

  const nudge = (fn: (k: Knobs) => Knobs) => {
    props.onSess(x => edit(x, fn))
    if (debounced.current) clearTimeout(debounced.current)
    debounced.current = setTimeout(() => { debounced.current = null; props.onSess(x => x) }, 0)
  }

  useKeyboard((key: ParsedKey) => {
    const name = key.name ?? ""
    if (name === "escape") return props.onDiscard()
    if (!s) {
      if (name === "return" || name === "o") return void prompt("source")
      return
    }
    if (name === "return") {
      if (rowDef(row).kind === "prompt") return void prompt(row)
      return props.onCommit()
    }
    if (name === "b") return props.onBake()
    if (name === "r") return props.onSess(resetKnobs)
    if (name === "=") return props.onSess(fork)
    if (name === "tab") return props.onSess(x => cycle(x, key.shift ? -1 : 1))
    if (name === "o") return void prompt("source")

    if (name === "j" || name === "k" || (name === "down" && row !== "pan") || (name === "up" && row !== "pan")) {
      const i = rows.indexOf(row)
      const d = name === "j" || name === "down" ? 1 : -1
      return setRow(rows[Math.max(0, Math.min(rows.length - 1, i + d))]!)
    }

    if (row === "state" && (name === "h" || name === "l" || name === "left" || name === "right"))
      return props.onSess(x => cycle(x, name === "h" || name === "left" ? -1 : 1))

    if (row === "pan" && caps.ffmpeg) {
      const d: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], h: [-1, 0], l: [1, 0] }
      const v = d[name]; if (!v) return
      return nudge(kk => pan(kk, v[0], v[1], !!key.shift))
    }

    if (name === "h" || name === "l" || name === "left" || name === "right") {
      const def = rowDef(row)
      if (def.ff && !caps.ffmpeg) return
      if (def.kind === "prompt") return void prompt(row)
      return nudge(kk => step(kk, row, name === "h" || name === "left" ? -1 : 1))
    }
    if (name === "space" && rowDef(row).kind === "toggle")
      return nudge(kk => step(kk, row, 1))
  })

  if (!s || !snap.doc) return (
    <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
      <text fg={t.textMuted}>No image loaded.</text>
      <box height={1} />
      <text fg={t.text}>Press <span fg={t.accent}>o</span> or <span fg={t.accent}>Enter</span> to open a source image.</text>
      <box height={1} />
      <text fg={t.textMuted}>Or ask the agent — the eikon skill writes the WIP and this tab picks it up.</text>
    </box>
  )

  const clip = snap.doc.states.get(s.state)

  return (
    <box flexGrow={1} flexDirection="column" padding={1}>
      <box height={1}>
        <text>
          <span fg={t.accent}><strong>EIKON STUDIO</strong></span>
          <span fg={t.textMuted}>{`  ·  ${s.name} ${s.glyph}  ·  ${s.dims ? `${s.dims.w}×${s.dims.h}` : "?"}  ·  ${Object.keys(s.per).length} forked`}</span>
        </text>
      </box>
      <box height={1} />

      <box flexDirection="row" flexGrow={1} gap={3}>
        <box flexDirection="column" alignItems="center">
          <box border borderStyle="rounded" borderColor={t.accent} width={W + 4} height={H + 2}
               alignItems="center" justifyContent="center" overflow="hidden">
            <Frame lines={clip?.frames[0] ?? []} fg={t.hermAvatar ?? t.text} />
          </box>
          <box height={1}><text fg={t.textMuted}>{`state: ${s.state}${s.per[s.state] ? " (forked)" : " (base)"}`}</text></box>
        </box>

        <box flexDirection="column" minWidth={46}>
          {lines(s, k).map(ln => {
            const on = ln.row === row
            const dim = ln.dim && !on
            return (
              <box key={ln.row} height={1} onMouseDown={() => setRow(ln.row)}>
                <text>
                  <span fg={on ? t.accent : t.textMuted}>{on ? "▸ " : "  "}</span>
                  <span fg={dim ? t.textMuted : on ? t.text : t.textMuted}>{ln.label.padEnd(10)}</span>
                  <span fg={dim ? t.textMuted : t.text}>{ln.value}</span>
                </text>
              </box>
            )
          })}
          <box height={1} />
          {caps.ffmpeg ? <Mini k={k} dims={s.dims} theme={t} /> : null}
          <box flexGrow={1} />
          <box height={1}><text fg={t.textMuted}>j/k row · h/l adj · tab state · = fork · r reset · o open</text></box>
          <box height={1}><text fg={t.textMuted}>enter commit · b bake · esc discard</text></box>
        </box>
      </box>

      <box height={1} />
      <Strip s={s} doc={snap.doc} api={props.api} />
    </box>
  )
}
