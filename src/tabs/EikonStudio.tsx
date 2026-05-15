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
import { Spinner } from "../ui/spinner"
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
import { W, H, FPS0, caps, thumb, cached, resetCache, prewarm,
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

/** Preview-pane nav order. pan-x/pan-y render as scrollbar-style
 *  sliders flanking the frame (no label); zoom/fps stay as labeled
 *  rows beside the minimap. ↑↓ still walks all four. */
const SP_ROWS = ["pan x", "pan y", "zoom", "fps"] as const
type SpRow = typeof SP_ROWS[number]
type SpKey = keyof Spatial | "fps"

/** SliderRenderable's viewPortSize *setter* clamps to ≤ (max−min),
 *  but its constructor doesn't — and the scrollbar model (thumbRatio
 *  = vp/(range+vp)) needs vp > range whenever z > 0.5. So: fix range
 *  at V, set vp = V·z/(1−z) so thumbRatio = z exactly, and key the
 *  element on zoom so prop updates never hit the clamped setter
 *  (each zoom step remounts via the constructor). Value is the
 *  window's left/top edge mapped from slack-normalized ox/oy. */
const V = 100
const vpOf = (z: number) => z >= 0.995 ? V * 200 : V * z / (1 - z)
const fromEdge = (v: number) => +Math.max(0, Math.min(1, v / V)).toFixed(3)

function PanBars(props: {
  sp: Spatial; sel: number; focused: boolean
  onHover: (i: number) => void; onSet: (k: SpKey, v: number) => void
  onWheel: (k: SpKey, d: 1 | -1) => void
  children: import("react").ReactNode
}) {
  const theme = useTheme().theme
  const z = props.sp.zoom
  const vp = vpOf(z)
  const on = (i: number) => props.focused && props.sel === i
  const fg = (i: number) => on(i) ? theme.accent : theme.textMuted
  const wheel = (k: SpKey) => (e: { scroll?: { direction: string } }) => {
    const d = e.scroll?.direction
    if (d === "up" || d === "left") props.onWheel(k, -1)
    if (d === "down" || d === "right") props.onWheel(k, 1)
  }
  return (
    <box flexDirection="row" flexShrink={0}>
      <box flexDirection="column" flexShrink={0}>
        {props.children}
        <box width={W} height={1}
             onMouseMove={() => props.onHover(0)} onMouseScroll={wheel("ox")}>
          <slider key={`px:${z.toFixed(3)}`} orientation="horizontal" width={W} height={1}
                  min={0} max={V} viewPortSize={vp}
                  value={props.sp.ox * V}
                  foregroundColor={fg(0)} backgroundColor={theme.border}
                  onChange={v => props.onSet("ox", fromEdge(v))} />
        </box>
      </box>
      <box width={2} height={H}
           onMouseMove={() => props.onHover(1)} onMouseScroll={wheel("oy")}>
        <slider key={`py:${z.toFixed(3)}`} orientation="vertical" width={2} height={H}
                min={0} max={V} viewPortSize={vp}
                value={props.sp.oy * V}
                foregroundColor={fg(1)} backgroundColor={theme.border}
                onChange={v => props.onSet("oy", fromEdge(v))} />
      </box>
    </box>
  )
}

/** zoom + fps labeled sliders + read-only minimap. */
function SpatialBar(props: {
  sp: Spatial; fps: number; dims: Session["dims"]
  sel: number; focused: boolean
  onHover: (i: number) => void
  onSet: (k: SpKey, v: number) => void
  onWheel: (k: SpKey, d: 1 | -1) => void
}) {
  const theme = useTheme().theme
  const rows: Array<{ label: SpRow; k: SpKey; min: number; max: number; v: number; i: number }> = [
    { label: "zoom", k: "zoom", min: 0.1, max: 1.0, v: props.sp.zoom, i: 2 },
    { label: "fps",  k: "fps",  min: 4,   max: 30,  v: props.fps,     i: 3 },
  ]
  const wheel = (k: SpKey) => (e: { scroll?: { direction: string } }) => {
    const d = e.scroll?.direction
    if (d === "up") props.onWheel(k, -1)
    if (d === "down") props.onWheel(k, 1)
  }
  return (
    <box flexDirection="row" marginTop={1} flexShrink={0}>
      <box flexDirection="column" gap={1} flexShrink={0}>
        {rows.map(d => {
          const on = props.focused && d.i === props.sel
          return (
            <box key={d.label} height={1} flexDirection="row"
                 backgroundColor={on ? theme.backgroundElement : undefined}
                 onMouseMove={() => props.onHover(d.i)} onMouseScroll={wheel(d.k)}>
              <box width={2}><text fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</text></box>
              <box width={7}><text fg={on ? theme.text : theme.textMuted}>{d.label}</text></box>
              <box width={20} height={1}>
                <slider orientation="horizontal" min={d.min} max={d.max} value={d.v}
                        foregroundColor={on ? theme.accent : theme.textMuted}
                        backgroundColor={theme.border}
                        onChange={v => props.onSet(d.k, d.k === "fps" ? Math.round(v) : +v.toFixed(3))} />
              </box>
              <box width={7}><text fg={on ? theme.text : theme.textMuted}>
                {`  ${d.k === "fps" ? d.v.toFixed(0) : d.v.toFixed(2)}`}
              </text></box>
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
  const [frames, setFrames] = useState<Frame[]>([BLANK])
  const [tick, setTick] = useState(0)
  const [play, setPlay] = useState(true)
  const [busy, setBusy] = useState(false)
  const [thumbs, setThumbs] = useState<Map<AvatarState, Frame | undefined>>(new Map())
  const [err, setErr] = useState<string | null>(null)
  const frame = frames[tick % frames.length] ?? BLANK

  const r = useMemo(() => eikon.pick(s?.rasterizer ?? prefs.get("eikonRasterizer")), [s?.rasterizer])
  // Spatial is studio-owned now — every rasterizer gets it for free.
  // Only gate on ffmpeg (the shared decoder).
  const spatialOk = caps.ffmpeg

  // Open by name: read studio.json + probe + seed session.
  const open = useCallback((name: string) => {
    resetCache()
    const seed = eikon.readStudio(name)
    const ra = eikon.pick(seed?.rasterizer ?? prefs.get("eikonRasterizer"))
    const next = knobs.fresh(name, ra, seed)
    const src = eikon.findSource(name, "idle")
    next.dims = src ? (eikon.probe(src) ?? null) : null
    // Pre-warm every source's clip so the first spatial/knob change
    // is decode-free. Fire-and-forget; the preview effect awaits
    // the one it needs (shared Promise from the clip cache).
    for (const st of STATES) {
      const p = eikon.findSource(name, st)
      if (p) prewarm(p, next.fps)
    }
    setS(next)
    setSel(0); setPane("knobs"); setErr(null); setTick(0); setFrames([BLANK])
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

  // Render the current state's full clip (all frames) on any change
  // to (src, spatial, knobs, fps, rasterizer). The filmstrip render
  // is abortable — a mid-render slider move kills the chafa process.
  useEffect(() => {
    if (!s) return
    if (!src) { setFrames([BLANK]); setErr(null); setBusy(false); return }
    const ctrl = new AbortController()
    setBusy(true)
    void cached(r, src, s.spatial, s.fps, knobs.eff(s, s.state), ctrl.signal).then(out => {
      if (ctrl.signal.aborted) return
      setBusy(false)
      if ("err" in out) { setErr(out.err); return }
      setErr(null); setFrames(out.frames)
      setTick(t => t % out.frames.length)
    })
    return () => ctrl.abort()
  }, [s?.spatial, s?.base, s?.per, s?.state, s?.fps, s?.rasterizer, src, r])

  // Playback ticker — pure index advance over the already-rendered
  // `frames`. Zero work per tick; the filmstrip effect above did it
  // all once. Stops when paused, unfocused, still (1 frame), or busy.
  useEffect(() => {
    if (!play || !props.focused || frames.length <= 1 || busy) return
    const ms = 1000 / Math.max(1, s?.fps ?? FPS0)
    const id = setInterval(() => setTick(t => t + 1), ms)
    return () => clearInterval(id)
  }, [play, props.focused, frames.length, busy, s?.fps])

  // Thumbnails are second-class: frame-0 only, same spatial, long
  // debounce, stale during scrub, one setThumbs when the batch lands.
  // No abort plumbing — they fire after the preview has settled and
  // a new preview change just supersedes them at the setThumbs gate.
  useEffect(() => {
    if (!s) return
    let dead = false
    const t = setTimeout(() => {
      if (dead) return
      const jobs = STATES.map(st => {
        const sp = eikon.findSource(s.name, st)
        if (!sp) return Promise.resolve([st, undefined] as const)
        return cached(r, sp, s.spatial, s.fps, knobs.eff(s, st))
          .then(res => [st, "err" in res ? undefined : thumb(res.frames[0]!)] as const)
      })
      void Promise.all(jobs).then(done => {
        if (dead) return
        setThumbs(new Map(done))
      })
    }, 400)
    return () => { dead = true; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, s?.per, s?.sources, s?.name, s?.fps, r])

  const mutate = (fn: (prev: Session) => Session) => setS(p => (p ? fn(p) : p))

  const setSpatial = (sp: Partial<Spatial>) =>
    mutate(p => ({ ...p, spatial: { ...p.spatial, ...sp }, dirty: true }))

  const setBar = (k: SpKey, v: number) =>
    k === "fps"
      ? mutate(p => ({ ...p, fps: Math.round(v), dirty: true }))
      : setSpatial({ [k]: v })

  const stepBar = (k: SpKey, d: 1 | -1) => {
    const cur = sRef.current; if (!cur) return
    if (k === "fps") return setBar("fps", Math.max(4, Math.min(30, cur.fps + d * 2)))
    if (k === "zoom") return setSpatial({ zoom: Math.max(0.1, Math.min(1, +(cur.spatial.zoom + d * 0.03).toFixed(3))) })
    return setSpatial({ [k]: Math.max(0, Math.min(1, +(cur.spatial[k] + d * 0.03).toFixed(3))) })
  }

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

  /** Step a knob row (cycle/toggle forward, slider ±). */
  const stepRow = (row: Row, d: 1 | -1) => {
    if (row.kind !== "knob" || !row.knob) return
    mutate(p => knobs.edit(p, k => knobs.step(k, row.id, row.knob!, d)))
  }

  /** nav.md: Enter activates; Space toggles/cycles; when a row has
   *  only one semantic, both keys and click do that. High-commitment
   *  actions (reset → confirm dialog) are Enter/click only. */
  const act = (row: Row | undefined, via: "enter" | "space" | "click") => {
    if (!row || !sRef.current) return
    if (row.kind === "select") return doSelectRasterizer()
    if (row.kind === "prompt") return void doPrompt(row.id)
    if (row.kind === "action") {
      if (via === "space" && row.id === "reset") return
      return void doAction(row.id)
    }
    if (row.kind === "knob") {
      // slider has neither toggle nor activate semantics → Enter/Space
      // are inert (←→ and drag are the inputs).
      if (row.knob!.kind === "slider") return
      return stepRow(row, 1)
    }
  }

  const activate = () => act(navRows[selRef.current], "enter")
  const toggle   = () => act(navRows[selRef.current], "space")
  const adjust = (d: 1 | -1) => {
    const row = navRows[selRef.current]
    if (row) stepRow(row, d)
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
        onToggle: toggle,
        onNew: () => void doPrompt("source"),
      })) return
      if (key.name === "left") return adjust(-1)
      if (key.name === "right") return adjust(1)
      return
    }
    if (pane === "preview") {
      if (!spatialOk) return
      // Space toggles play/pause (nav.md: Space = toggle).
      if (keys.match("list.toggle", key)) return setPlay(p => !p)
      // ↑↓ moves spatial-row selection; ←→ steps the selected knob.
      if (handleListKey(keys, key, { count: SP_ROWS.length, setSel: setSpSel })) return
      const spec: readonly SpKey[] = ["ox", "oy", "zoom", "fps"]
      const k = spec[spRef.current]!
      const fine = key.shift && k !== "fps"
      const d = (name: string) => name === "left" ? -1 : 1
      if (key.name === "left" || key.name === "right") {
        if (fine && (k === "ox" || k === "oy" || k === "zoom")) {
          const cur = sRef.current!.spatial[k]
          return setSpatial({ [k]: Math.max(k === "zoom" ? 0.1 : 0, Math.min(1, +(cur + d(key.name) * 0.01).toFixed(3))) })
        }
        return stepBar(k, d(key.name))
      }
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

  const n = frames.length
  const title = s
    ? `Preview — ${s.state}${s.per[s.state] ? " (forked)" : ""}`
      + (n > 1 ? `  ·  ${play ? "▶" : "⏸"} ${(tick % n) + 1}/${n}` : "")
    : "Preview"
  const previewErr = err ?? (s && !src ? "no source — Enter on 'source' row to attach" : null)

  const hint: Array<readonly [string, string]> =
    pane === "knobs"   ? [["↑↓", "row"], ["←→", "adjust"], [keys.print("list.activate"), "open"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]
  : pane === "preview" ? [["↑↓", "row"], ["←→", "adjust"], [keys.print("list.toggle"), "play/pause"], ["wheel", "zoom"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]
  :                      [["←→", "state"], [keys.print("list.activate"), "actions"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]

  // TabShell chrome = border(2) + padding(2) + title(1) + gap(1).
  // PanBars adds +1 row (pan-x) and +1 col (pan-y) around the frame.
  // SpatialBar = max(minimap height, 2 rows + 1 gap) + 1 margin.
  const BAR_H = spatialOk ? Math.max(Math.ceil(MINI_W / 2), 3) + 1 : 0
  const PREVIEW_W = Math.max(W + 2, 36 + 2 + MINI_W) + 6
  const PREVIEW_H = H + 1 + BAR_H + 6 + (previewErr ? 1 : 0)
  const body = (
    <box position="relative" flexDirection="column" width={W} height={H} flexShrink={0}
         backgroundColor={theme.background} onMouseScroll={onScroll}
         onMouseDown={() => setPlay(p => !p)}>
      {frame.map((ln, i) =>
        <text key={i} fg={err ? theme.textMuted : theme.hermAvatar}>{ln}</text>)}
      {busy && frames[0] === BLANK
        ? <box position="absolute" left={0} top={H >> 1} width={W} justifyContent="center">
            <Spinner color={theme.textMuted} label="decoding…" />
          </box>
        : null}
    </box>
  )
  const preview = (
    <TabShell title={spatialOk ? title : `${title}  ·  (ffmpeg not installed)`}
              error={previewErr} focus={pane === "preview"}>
      {spatialOk && s
        ? <>
            <PanBars sp={s.spatial} sel={spSel} focused={pane === "preview"}
              onHover={i => { setPane("preview"); setSpSel(i) }}
              onSet={setBar} onWheel={stepBar}>
              {body}
            </PanBars>
            <SpatialBar sp={s.spatial} fps={s.fps} dims={s.dims} sel={spSel} focused={pane === "preview"}
              onHover={i => { setPane("preview"); setSpSel(i) }}
              onSet={setBar} onWheel={stepBar} />
          </>
        : body}
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
              <KnobRow key={`${r.name}:${row.id}`} id={`knob-${row.id}`} row={row} s={s} r={r} src={src}
                       on={on} dim={dim}
                       onHover={() => { if (ni >= 0) { setPane("knobs"); setSel(ni) } }}
                       onClick={() => { if (ni >= 0) { setSel(ni); setPane("knobs"); act(row, "click") } }}
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
