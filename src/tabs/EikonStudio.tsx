// Eikon Studio — three-pane editor over the active eikon folder.
//
//   Preview (left)  48×24 frame; mouse drag-pan, wheel-zoom, arrows pan.
//                   Minimap overlay bottom-right (half-block viewport).
//   Knobs   (right) rasterizer/source/name + actions + rasterizer-
//                   declared tonal rows rendered generically.
//   States  (bottom-left) six 16×8 thumbnails; Enter → per-state menu.
//
// Tab cycles panes (knobs→preview→strip). Ctrl+S saves via
// service/eikon.save(). Esc on a dirty draft confirms discard.
// nav.md: no letter mnemonics beyond `n` (new) on knobs-onNew.

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { extend, useKeyboard, useTerminalDimensions } from "@opentui/react"
import { SliderRenderable } from "@opentui/core"
import type { ParsedKey } from "@opentui/core"
import { basename } from "node:path"
import { useTheme } from "../theme"
import { useKeys, handleListKey } from "../keys"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TabShell } from "../ui/shell"
import { HintBar } from "../ui/hint"
import { DialogSelect } from "../ui/dialog-select"
import { openConfirm } from "../dialogs/confirm"
import { openTextPrompt } from "../dialogs/text-prompt"
import * as prefs from "../context/preferences"
import { eikon } from "../service/eikon"
import { W, H, caps, thumb, cached, resetCache,
         type Rasterizer, type KnobDef, type Spatial, type Frame } from "../utils/eikon-render"
import { knobs, STATES, type Session } from "../utils/eikon-knobs"
import type { AvatarState } from "../components/avatar/states"

// SliderRenderable ships in @opentui/core but isn't in react's default
// catalogue; register it once so `<slider>` is a valid intrinsic.
extend({ slider: SliderRenderable })
declare module "@opentui/react" {
  interface OpenTUIComponents { slider: typeof SliderRenderable }
}

type Pane = "knobs" | "preview" | "strip"
const PANES: readonly Pane[] = ["knobs", "preview", "strip"]

type RowKind = "select" | "prompt" | "action" | "divider" | "knob"
type Row = {
  id: string; kind: RowKind; label: string
  knob?: KnobDef
  show?: (s: Session) => boolean
}

const HEAD: readonly Row[] = [
  { id: "rasterizer", kind: "select", label: "rasterizer" },
  { id: "source",     kind: "prompt", label: "source" },
  { id: "name",       kind: "prompt", label: "name" },
  // { id: "glyph",   kind: "prompt", label: "glyph" }, // reserved — PRD § 3
  { id: "-1",         kind: "divider", label: "" },
  { id: "fork",       kind: "action", label: "fork state" },
  { id: "reset",      kind: "action", label: "reset knobs" },
  { id: "fetch",      kind: "action", label: "fetch source",
    show: s => !eikon.findSource(s.name) && !!eikon.header(eikon.file(s.name))?.source_url },
  { id: "-2",         kind: "divider", label: "" },
]

function buildRows(r: Rasterizer, s: Session): Row[] {
  const dyn = Object.entries(r.knobs).map<Row>(([id, def]) =>
    ({ id, kind: "knob", label: def.label ?? id, knob: def }))
  return [...HEAD.filter(h => h.show ? h.show(s) : true), ...dyn]
}

// ── Minimap (read-only) ──────────────────────────────────────────────

const MINI_W = 12

function Mini(props: { sp: Spatial; dims: Session["dims"] }) {
  const theme = useTheme().theme
  const d = props.dims ?? { w: 1, h: 1 }
  const ar = d.w / d.h
  // Half-block rows: render on a bw×bh virtual grid, two v-cells per
  // text line, so the viewport rect has sub-row precision.
  const bw = ar >= 1 ? MINI_W : Math.max(4, Math.round(MINI_W * ar))
  const bh = ar >= 1 ? Math.max(4, Math.round(MINI_W / ar)) : MINI_W
  const short = Math.min(bw, bh)
  const cw = Math.max(1, short * props.sp.zoom)
  const cx = (bw - cw) * props.sp.ox
  const cy = (bh - cw) * props.sp.oy
  const on = (x: number, y: number) => x >= cx && x < cx + cw && y >= cy && y < cy + cw
  const cell = (x: number, ty: number) => {
    const up = on(x, ty * 2), dn = on(x, ty * 2 + 1)
    return up && dn ? "█" : up ? "▀" : dn ? "▄" : "·"
  }
  return (
    <box flexDirection="column" flexShrink={0} backgroundColor={theme.backgroundElement}>
      {Array.from({ length: Math.ceil(bh / 2) }, (_, ty) => (
        <text key={ty} fg={theme.textMuted}>
          {Array.from({ length: bw }, (_, x) => cell(x, ty)).join("")}
        </text>
      ))}
    </box>
  )
}

/** Spatial sub-row ids in preview-pane nav order. */
const SP_ROWS = ["zoom", "pan x", "pan y"] as const
type SpRow = typeof SP_ROWS[number]

/** zoom + pan-x + pan-y sliders with the read-only minimap inline
 *  after them. nav.md: ↑↓ picks a row (caret + bg), ←→ steps it,
 *  slider fg is accent only on the selected row. */
function SpatialBar(props: {
  sp: Spatial; dims: Session["dims"]
  sel: number; focused: boolean
  onHover: (i: number) => void
  onSet: (k: keyof Spatial, v: number) => void
}) {
  const theme = useTheme().theme
  const key: Record<SpRow, keyof Spatial> = { zoom: "zoom", "pan x": "ox", "pan y": "oy" }
  const min: Record<SpRow, number> = { zoom: 0.1, "pan x": 0, "pan y": 0 }
  return (
    <box flexDirection="row" marginTop={1} flexShrink={0}>
      <box flexDirection="column" gap={1} flexShrink={0}>
        {SP_ROWS.map((label, i) => {
          const on = props.focused && i === props.sel
          const k = key[label]
          return (
            <box key={label} height={1} flexDirection="row"
                 backgroundColor={on ? theme.backgroundElement : undefined}
                 onMouseMove={() => props.onHover(i)}>
              <box width={2}><text fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</text></box>
              <box width={7}><text fg={on ? theme.text : theme.textMuted}>{label}</text></box>
              <box width={20} height={1}>
                <slider orientation="horizontal" min={min[label]} max={1.0} value={props.sp[k]}
                        foregroundColor={on ? theme.accent : theme.textMuted}
                        backgroundColor={theme.border}
                        onChange={v => props.onSet(k, +v.toFixed(3))} />
              </box>
              <box width={7}><text fg={on ? theme.text : theme.textMuted}>{`  ${props.sp[k].toFixed(2)}`}</text></box>
            </box>
          )
        })}
      </box>
      <box width={2} />
      <Mini sp={props.sp} dims={props.dims} />
    </box>
  )
}

// ── Knob row renderers ───────────────────────────────────────────────

function valueOf(s: Session, r: Rasterizer, row: Row, src?: string): string {
  if (row.id === "rasterizer") return `${r.name} ▸`
  if (row.id === "source") return src ? src.replace(process.env.HOME ?? "", "~") : "(none — Enter to attach)"
  if (row.id === "name") return s.name
  if (row.id === "fork") return s.per[s.state] ? "(forked)" : "▸ copy base → " + s.state
  if (row.id === "reset") return "▸ defaults"
  if (row.id === "fetch") return "▸ download from source_url"
  if (row.kind === "knob" && row.knob) {
    const k = knobs.eff(s, s.state)[row.id] ?? row.knob.default
    if (row.knob.kind === "cycle") return `◂ ${String(k)} ▸`
    if (row.knob.kind === "toggle") return k ? "● on" : "○ off"
    if (row.knob.kind === "slider") return Number(k).toFixed(2)
  }
  return ""
}

function KnobRow(props: {
  row: Row; s: Session; r: Rasterizer; src?: string
  on: boolean; dim: boolean; id: string
  onHover: () => void; onClick: () => void
  onSlide?: (v: number) => void
}) {
  const theme = useTheme().theme
  const { row, on, dim } = props
  if (row.kind === "divider")
    return <box id={props.id} height={1}><text fg={theme.border}>{"─".repeat(24)}</text></box>
  const slider = row.knob?.kind === "slider" ? row.knob : undefined
  return (
    <box id={props.id} height={1} flexDirection="row"
         backgroundColor={on ? theme.backgroundElement : undefined}
         onMouseMove={props.onHover} onMouseDown={props.onClick}>
      <box width={2}><text fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</text></box>
      <box width={12}><text fg={dim ? theme.textMuted : on ? theme.text : theme.textMuted}>{row.label}</text></box>
      {slider ? (
        <>
          <box width={20} height={1}>
            <slider orientation="horizontal" min={slider.min} max={slider.max}
                    value={Number(knobs.eff(props.s, props.s.state)[row.id] ?? slider.default)}
                    foregroundColor={on ? theme.accent : theme.textMuted}
                    backgroundColor={theme.border}
                    onChange={props.onSlide} />
          </box>
          <box width={1} />
        </>
      ) : null}
      <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
        <text fg={dim ? theme.textMuted : theme.text}>{valueOf(props.s, props.r, row, props.src)}</text>
      </box>
    </box>
  )
}

// ── State strip ──────────────────────────────────────────────────────

function Strip(props: {
  s: Session; frames: Map<AvatarState, Frame | undefined>
  focused: boolean; onPick: (st: AvatarState) => void
}) {
  const theme = useTheme().theme
  return (
    <box flexDirection="row" gap={1}>
      {STATES.map(st => {
        const on = props.s.state === st
        const own = !!props.s.per[st]
        const has = !!props.s.sources[st]
        const f = props.frames.get(st)
        return (
          <box key={st} flexDirection="column" alignItems="center"
               onMouseDown={() => props.onPick(st)}>
            <box border borderStyle="rounded"
                 borderColor={on && props.focused ? theme.primary : on ? theme.accent : theme.border}
                 width={18} height={10} overflow="hidden" alignItems="center" justifyContent="center">
              {f ? f.map((ln, i) => <text key={i} fg={on ? theme.text : theme.textMuted}>{ln}</text>)
                 : <text fg={theme.textMuted}>·</text>}
            </box>
            <box height={1}><text fg={on ? theme.accent : theme.textMuted}>
              {`${own ? "*" : " "}${has ? "📎" : " "}${st}`}
            </text></box>
          </box>
        )
      })}
    </box>
  )
}

// ── Main ─────────────────────────────────────────────────────────────

const BLANK: Frame = Array.from({ length: H }, () => " ".repeat(W))

export const EikonStudio = memo((props: {
  focused: boolean
  /** Name to open on mount / when Gallery hands over. Empty → fresh. */
  name?: string
}) => {
  const theme = useTheme().theme
  const keys = useKeys()
  const dialog = useDialog()
  const toast = useToast()
  const dims = useTerminalDimensions()
  const wide = dims.width >= 120

  useSyncExternalStore(eikon.onRegistry, () => eikon.rasterizers().length)

  const [s, setS] = useState<Session | null>(null)
  const [pane, setPane] = useState<Pane>("knobs")
  const [sel, setSel] = useState(0)
  const [spSel, setSpSel] = useState(0)
  // Rapid keypresses (held arrow) can fire before React commits the
  // new `sel`; read through a ref so adjust()/activate() see the
  // latest target row regardless of render timing.
  const selRef = useRef(0); selRef.current = sel
  const spRef = useRef(0); spRef.current = spSel
  const sRef = useRef<Session | null>(null); sRef.current = s
  const [frame, setFrame] = useState<Frame>(BLANK)
  const [thumbs, setThumbs] = useState<Map<AvatarState, Frame | undefined>>(new Map())
  const [err, setErr] = useState<string | null>(null)

  const r = useMemo(() => eikon.pick(s?.rasterizer ?? prefs.get("eikonRasterizer")), [s?.rasterizer])
  const spatialOk = r.spatial && (r.name !== "chafa" || caps.ffmpeg)

  // Open by name: read studio.json + probe + seed session.
  const open = useCallback((name: string) => {
    resetCache()
    const seed = eikon.readStudio(name)
    const ra = eikon.pick(seed?.rasterizer ?? prefs.get("eikonRasterizer"))
    const next = knobs.fresh(name, ra, seed)
    const src = eikon.findSource(name, "idle")
    next.dims = src ? (ra.probe?.(src) ?? null) : null
    setS(next)
    setSel(0); setPane("knobs"); setErr(null)
  }, [])

  // Auto-open the active eikon (eikonPath) on first focused mount.
  const tried = useRef(false)
  useEffect(() => {
    if (tried.current) return
    tried.current = true
    if (props.name) return open(props.name || knobs.slug("new"))
    const p = prefs.get("eikonPath")
    if (p) open(basename(basename(p, ".eikon")))
  }, [open, props.name])

  useEffect(() => { if (props.name !== undefined) open(props.name || knobs.slug("new")) }, [props.name, open])

  const rows = useMemo(() => (s ? buildRows(r, s) : []), [r, s])
  const navRows = useMemo(() => rows.map((x, i) => ({ ...x, i })).filter(x => x.kind !== "divider"), [rows])
  const src = useMemo(() => (s ? eikon.findSource(s.name, s.state) : undefined), [s?.name, s?.state, s?.sources])

  // Re-render preview whenever the effective (src, spatial, knobs, rasterizer) changes.
  useEffect(() => {
    if (!s) return
    if (!src) { setFrame(BLANK); setErr(null); return }
    let dead = false
    void cached(r, src, s.spatial, knobs.eff(s, s.state)).then(out => {
      if (dead) return
      if ("err" in out) { setErr(out.err); return }
      setErr(null); setFrame(out.frames[0]!)
    })
    return () => { dead = true }
  }, [s?.spatial, s?.base, s?.per, s?.state, s?.rasterizer, src, r])

  // Thumbnails — render each distinct state once, nearest-neighbor down.
  useEffect(() => {
    if (!s) return
    let dead = false
    void (async () => {
      const out = new Map<AvatarState, Frame | undefined>()
      for (const st of STATES) {
        const sp = eikon.findSource(s.name, st)
        if (!sp) { out.set(st, undefined); continue }
        const res = await cached(r, sp, s.spatial, knobs.eff(s, st))
        out.set(st, "err" in res ? undefined : thumb(res.frames[0]!))
      }
      if (!dead) setThumbs(out)
    })()
    return () => { dead = true }
  }, [s?.spatial, s?.base, s?.per, s?.sources, s?.name, s?.rasterizer, r])

  const mutate = (fn: (prev: Session) => Session) => setS(p => (p ? fn(p) : p))

  const setSpatial = (sp: Partial<Spatial>) =>
    mutate(p => ({ ...p, spatial: { ...p.spatial, ...sp }, dirty: true }))

  // Knob-row actions.
  const doSave = useCallback(async () => {
    if (!s) return
    await eikon.save({ ...s, dirty: false })
      .then(f => { mutate(p => ({ ...p, dirty: false })); toast.show({ variant: "success", message: `Saved → ${basename(f)}` }) })
      .catch(e => toast.error(e instanceof Error ? e : new Error(String(e))))
  }, [s, toast])

  const doSelectRasterizer = () => {
    const opts = eikon.rasterizers().map(x => {
      const a = x.available()
      return { title: x.name, value: x.name, description: Object.keys(x.knobs).join(" · "),
               hint: a === true ? undefined : a }
    })
    dialog.replace(
      <DialogSelect title="Rasterizer" filterable={false} current={r.name} options={opts}
        onSelect={o => {
          dialog.clear()
          const next = eikon.rasterizer(o.value)
          if (!next) return
          const a = next.available()
          if (a !== true) return toast.show({ variant: "warning", message: `${o.value}: ${a}` })
          prefs.set("eikonRasterizer", o.value)
          mutate(p => knobs.swap(p, next))
        }} />,
      () => {},
    )
  }

  const doPrompt = async (id: string) => {
    if (!s) return
    if (id === "source") {
      const v = await openTextPrompt(dialog, { title: "Source image", label: `for state '${s.state}' (png/jpg/webp/gif/mp4)` })
      if (!v) return
      const role = s.state === "idle" && !s.sources.base ? "base" : s.state
      try { const f = eikon.adopt(s.name, v, role); mutate(p => ({ ...p, sources: { ...p.sources, [role]: f }, dirty: true })) }
      catch (e) { toast.error(e instanceof Error ? e : new Error(String(e))) }
      return
    }
    if (id === "name") {
      const v = await openTextPrompt(dialog, { title: "Name", initial: s.name })
      if (v) mutate(p => ({ ...p, name: knobs.slug(v), dirty: true }))
    }
  }

  const doAction = async (id: string) => {
    if (!s) return
    if (id === "fork") return mutate(knobs.fork)
    if (id === "reset") {
      const ok = await openConfirm(dialog, { title: "Reset knobs?", body: "Restore rasterizer defaults and drop all per-state overrides.", danger: true })
      if (ok) mutate(p => knobs.reset(p, r))
      return
    }
    if (id === "fetch") {
      const url = eikon.header(eikon.file(s.name))?.source_url as string | undefined
      if (!url) return
      toast.show({ variant: "info", message: "Fetching source…" })
      await eikon.fetchSource(s.name, url)
        .then(n => { toast.show({ variant: "success", message: `Fetched ${n} file(s)` }); mutate(p => ({ ...p, dirty: true })) })
        .catch(e => toast.error(e instanceof Error ? e : new Error(String(e))))
    }
  }

  const doStripMenu = () => {
    if (!s) return
    dialog.replace(
      <DialogSelect title={`State: ${s.state}`} filterable={false}
        options={[
          { title: "Attach source image…", value: "attach" },
          { title: s.per[s.state] ? "Clear override (back to base)" : "Fork knobs from base", value: "fork" },
        ]}
        onSelect={o => {
          dialog.clear()
          if (o.value === "attach") return void doPrompt("source")
          mutate(s.per[s.state] ? knobs.unfork : knobs.fork)
        }} />,
      () => {},
    )
  }

  const activate = () => {
    const row = navRows[selRef.current]
    if (!row || !sRef.current) return
    if (row.kind === "select") return doSelectRasterizer()
    if (row.kind === "prompt") return void doPrompt(row.id)
    if (row.kind === "action") return void doAction(row.id)
  }

  const adjust = (d: 1 | -1) => {
    const row = navRows[selRef.current]
    if (!row || !sRef.current || row.kind !== "knob" || !row.knob) return
    mutate(p => knobs.edit(p, k => knobs.step(k, row.id, row.knob!, d)))
  }

  const discard = async () => {
    const cur = sRef.current
    if (!cur?.dirty) return false
    const ok = await openConfirm(dialog, {
      title: "Discard unsaved edits?", danger: true,
      body: `Reload '${cur.name}' from disk and drop in-memory changes.`,
    })
    if (ok) open(cur.name)
    return true
  }

  useKeyboard((key: ParsedKey) => {
    if (!props.focused || dialog.open()) return
    if (key.eventType === "release") return
    if (keys.match("eikon.save", key)) return void doSave()
    if (key.name === "escape") return void discard()
    if (key.name === "tab") {
      const i = PANES.indexOf(pane)
      return setPane(PANES[(i + (key.shift ? PANES.length - 1 : 1)) % PANES.length]!)
    }
    if (!s) {
      if (key.name === "return") return void doPrompt("source")
      return
    }
    if (pane === "knobs") {
      if (handleListKey(keys, key, {
        count: navRows.length, setSel,
        onActivate: activate,
        onToggle: () => { const row = navRows[sel]; if (row?.knob?.kind === "toggle") adjust(1) },
        onNew: () => void doPrompt("source"),
      })) return
      if (key.name === "left") return adjust(-1)
      if (key.name === "right") return adjust(1)
      return
    }
    if (pane === "preview") {
      if (!spatialOk) return
      // ↑↓ moves spatial-row selection; ←→ steps the selected knob.
      if (handleListKey(keys, key, { count: SP_ROWS.length, setSel: setSpSel })) return
      const k: readonly (keyof Spatial)[] = ["zoom", "ox", "oy"]
      const id = k[spRef.current]!
      const lo = id === "zoom" ? 0.1 : 0
      const stride = key.shift ? 0.01 : 0.03
      if (key.name === "left")
        return setSpatial({ [id]: Math.max(lo, +(sRef.current!.spatial[id] - stride).toFixed(3)) })
      if (key.name === "right")
        return setSpatial({ [id]: Math.min(1, +(sRef.current!.spatial[id] + stride).toFixed(3)) })
      return
    }
    // strip
    if (key.name === "left")  return mutate(p => knobs.cycle(p, -1))
    if (key.name === "right") return mutate(p => knobs.cycle(p,  1))
    if (key.name === "return") return doStripMenu()
  })

  // Preview mouse: wheel-zoom only (drag-pan removed — sliders cover it).
  const onScroll = (e: { scroll?: { direction: string } }) => {
    if (!spatialOk || !e.scroll) return
    const d = e.scroll.direction
    if (d !== "up" && d !== "down") return
    mutate(p => ({ ...p, spatial: knobs.zoom(p.spatial, d === "up" ? -1 : 1), dirty: true }))
  }

  const title = s ? `Preview — ${s.state}${s.per[s.state] ? " (forked)" : ""}` : "Preview"
  const previewErr = err ?? (s && !src ? "no source — Enter on 'source' row to attach" : null)
    ?? (s && !r.video && src && /\.(mp4|webm|mov|mkv)$/i.test(src) ? `${r.name} does not support video` : null)

  const hint: Array<readonly [string, string]> =
    pane === "knobs"   ? [["↑↓", "row"], ["←→", "adjust"], [keys.print("list.activate"), "open"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]
  : pane === "preview" ? [["↑↓", "row"], ["←→", "adjust"], ["wheel", "zoom"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]
  :                      [["←→", "state"], [keys.print("list.activate"), "actions"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]

  // TabShell chrome = border(2) + padding(2) + title(1) + gap(1).
  // SpatialBar = max(minimap, 3 rows + 2 gaps) + 1 margin.
  const BAR_H = spatialOk ? Math.max(Math.ceil(MINI_W / 2), SP_ROWS.length * 2 - 1) + 1 : 0
  const PREVIEW_W = Math.max(W, 36 + 2 + MINI_W) + 6
  const PREVIEW_H = H + BAR_H + 6 + (previewErr ? 1 : 0)
  const preview = (
    <TabShell title={spatialOk ? title : `${title}  ·  (spatial n/a — ${r.name})`}
              error={previewErr} focus={pane === "preview"}>
      <box flexDirection="column" width={W} height={H} flexShrink={0}
           onMouseScroll={onScroll}>
        {frame.map((ln, i) =>
          <text key={i} fg={err ? theme.textMuted : theme.hermAvatar}>{ln}</text>)}
      </box>
      {spatialOk && s
        ? <SpatialBar sp={s.spatial} dims={s.dims} sel={spSel} focused={pane === "preview"}
            onHover={i => { setPane("preview"); setSpSel(i) }}
            onSet={(k, v) => setSpatial({ [k]: v })} />
        : null}
    </TabShell>
  )

  const panel = (
    <TabShell title={`Knobs${s?.dirty ? "  ·  ● unsaved" : ""}`} focus={pane === "knobs"} grow={1}>
      {!s
        ? <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.textMuted}>No eikon open. Enter to create one.</text>
          </box>
        : rows.map((row, i) => {
            const ni = navRows.findIndex(x => x.i === i)
            const on = pane === "knobs" && ni === sel
            const dim = row.kind === "knob" && !src
            return (
              <KnobRow key={row.id} id={`knob-${i}`} row={row} s={s} r={r} src={src}
                       on={on} dim={dim}
                       onHover={() => { if (ni >= 0) setSel(ni) }}
                       onClick={() => { if (ni >= 0) { setSel(ni); setPane("knobs"); activate() } }}
                       onSlide={row.knob?.kind === "slider"
                         ? v => mutate(p => knobs.edit(p, k => knobs.setSlider(k, row.id, row.knob!, v)))
                         : undefined} />
            )
          })}
    </TabShell>
  )

  // Strip cell = 10 (bordered thumb) + 1 (label). TabShell chrome =
  // border(2) + padding(2) + title(1) + gap(1). flexBasis=0 on TabShell
  // would collapse it in a column, so pin the wrapper height.
  const STRIP_H = 17
  const strip = s ? (
    <box flexShrink={0} height={STRIP_H}>
      <TabShell title="States" focus={pane === "strip"}>
        <Strip s={s} frames={thumbs} focused={pane === "strip"}
               onPick={st => { setPane("strip"); mutate(p => knobs.setState(p, st)) }} />
      </TabShell>
    </box>
  ) : null

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
      {wide ? (
        <>
          <box flexDirection="row" flexShrink={0} height={PREVIEW_H}>
            <box flexShrink={0} width={PREVIEW_W}>{preview}</box>
            <box flexGrow={1} flexBasis={0} minWidth={0}>{panel}</box>
          </box>
          {strip}
          <box flexGrow={1} />
        </>
      ) : (
        <scrollbox scrollY flexGrow={1} contentOptions={{ flexDirection: "column" }}>
          <box flexShrink={0} height={PREVIEW_H}>{preview}</box>
          <box flexShrink={0} height={rows.length + 6}>{panel}</box>
          {strip}
        </scrollbox>
      )}
      <HintBar pairs={hint} suffix={s?.dirty ? "● unsaved" : undefined} />
    </box>
  )
})

// Used by tests and app.tsx to render even when unfocused.
export default EikonStudio
