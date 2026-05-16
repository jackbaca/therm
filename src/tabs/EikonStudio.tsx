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
import { readFileSync } from "node:fs"
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
import type { ParsedEikon } from "../components/avatar/eikon"
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
  show?: (s: Session, live: boolean, url?: string) => boolean
}

const mb = (n: number) => n < 1024 ? `${n} B`
  : n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`

const HEAD: readonly Row[] = [
  { id: "rasterizer", kind: "select", label: "rasterizer" },
  { id: "source",     kind: "prompt", label: "source" },
  { id: "name",       kind: "prompt", label: "name" },
  // { id: "glyph",   kind: "prompt", label: "glyph" }, // reserved — PRD § 3
  { id: "-1",         kind: "divider", label: "" },
  { id: "fetch",      kind: "action", label: "fetch source",
    show: (s, live, url) => !live && !!url },
  { id: "fork",       kind: "action", label: "fork state",  show: (_s, live) => live },
  { id: "reset",      kind: "action", label: "reset knobs", show: (_s, live) => live },
  { id: "-2",         kind: "divider", label: "", show: (_s, live) => live },
]

function buildRows(r: Rasterizer, s: Session, live: boolean, url?: string): Row[] {
  const dyn = live
    ? Object.entries(r.knobs).map<Row>(([id, def]) =>
        ({ id, kind: "knob", label: def.label ?? id, knob: def }))
    : []
  return [...HEAD.filter(h => h.show ? h.show(s, live, url) : true), ...dyn]
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

/** SliderRenderable's viewPortSize setter clamps to ≤ range, so its
 *  scrollbar model can never reach thumb=track (z→1 is asymptotic).
 *  Render the thumb directly instead: length = z·track exactly.
 *  pan-x is a single W-char █-run; pan-y is a 2-wide half-block
 *  column (2H virtual rows, same trick as Mini) for sub-row
 *  precision. Drag scrubs by cell-delta from the grab point. */
function PanBars(props: {
  sp: Spatial; sel: number; focused: boolean
  onHover: (i: number) => void; onSet: (k: SpKey, v: number) => void
  onWheel: (k: SpKey, d: 1 | -1) => void
  children: import("react").ReactNode
}) {
  const theme = useTheme().theme
  const z = props.sp.zoom
  const slack = 1 - z
  const on = (i: number) => props.focused && props.sel === i
  const fg = (i: number) => on(i) ? theme.accent : theme.textMuted
  const wheel = (k: SpKey) => (e: { scroll?: { direction: string } }) => {
    const d = e.scroll?.direction
    if (d === "up" || d === "left") props.onWheel(k, -1)
    if (d === "down" || d === "right") props.onWheel(k, 1)
  }
  const drag = useRef<{ at: number; v: number; k: "ox" | "oy" } | null>(null)
  const grab = (k: "ox" | "oy", at: number) => { drag.current = { at, v: props.sp[k], k } }
  const scrub = (at: number, L: number) => {
    const d = drag.current
    if (!d || slack <= 0) return
    props.onSet(d.k, Math.max(0, Math.min(1, +(d.v + (at - d.at) / (slack * L)).toFixed(3))))
  }
  const drop = () => { drag.current = null }
  const tw = Math.max(1, Math.round(z * W))
  const tl = Math.min(W - tw, Math.round(props.sp.ox * slack * W))
  const hbar = " ".repeat(tl) + "█".repeat(tw) + " ".repeat(W - tl - tw)
  const vh = H * 2, th = Math.max(1, z * vh), ty = props.sp.oy * slack * vh
  const vbar = Array.from({ length: H }, (_, y) => {
    const up = y * 2 >= ty && y * 2 < ty + th, dn = y * 2 + 1 >= ty && y * 2 + 1 < ty + th
    return up && dn ? "██" : up ? "▀▀" : dn ? "▄▄" : "  "
  })
  return (
    <box flexDirection="row" flexShrink={0}>
      <box flexDirection="column" flexShrink={0}>
        {props.children}
        <box width={W} height={1} backgroundColor={theme.border}
             onMouseMove={() => props.onHover(0)} onMouseScroll={wheel("ox")}
             onMouseDown={(e: { x: number }) => grab("ox", e.x)}
             onMouseDrag={(e: { x: number }) => scrub(e.x, W)}
             onMouseUp={drop} onMouseDragEnd={drop}>
          <text fg={fg(0)}>{hbar}</text>
        </box>
      </box>
      <box flexDirection="column" width={2} height={H} backgroundColor={theme.border}
           onMouseMove={() => props.onHover(1)} onMouseScroll={wheel("oy")}
           onMouseDown={(e: { y: number }) => grab("oy", e.y)}
           onMouseDrag={(e: { y: number }) => scrub(e.y, H)}
           onMouseUp={drop} onMouseDragEnd={drop}>
        {vbar.map((g, y) => <text key={y} fg={fg(1)}>{g}</text>)}
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

function valueOf(s: Session, r: Rasterizer, row: Row, src?: string,
                 peek?: { n: number; bytes: number }, busy?: boolean): string {
  if (row.id === "rasterizer") return `${r.name} ▸`
  if (row.id === "source") return src ? src.replace(process.env.HOME ?? "", "~") : "(none — Enter to attach)"
  if (row.id === "name") return s.name
  if (row.id === "fork") return s.per[s.state] ? "(forked)" : "▸ copy base → " + s.state
  if (row.id === "reset") return "▸ defaults"
  if (row.id === "fetch") return busy ? "fetching…"
    : peek ? `▸ download to edit  (${peek.n} files, ${mb(peek.bytes)})` : "▸ download to edit"
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
  peek?: { n: number; bytes: number }; busy?: boolean
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
        {props.busy && row.id === "fetch"
          ? <Spinner color={theme.accent} label="fetching…" />
          : <text fg={dim ? theme.textMuted : theme.text}>
              {valueOf(props.s, props.r, row, props.src, props.peek, props.busy)}
            </text>}
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
  const [fetching, setFetching] = useState(false)
  const [peek, setPeek] = useState<{ n: number; bytes: number } | undefined>(undefined)
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

  const src = useMemo(() => (s ? eikon.findSource(s.name, s.state) : undefined), [s?.name, s?.state, s?.sources])
  const live = useMemo(() => !!(s && eikon.findSource(s.name)), [s?.name, s?.sources])
  // Sourceless → fall back to the packed .eikon's baked frames so the
  // preview is never blank. One readFileSync per open(); the whole
  // animation is string[] already, so tick stays 0.005ms.
  const baked = useMemo<ParsedEikon | undefined>(() => {
    if (live || !s) return undefined
    const p = eikon.baked(s.name)
    if (!p) return undefined
    try { return eikon.parseEikon(readFileSync(p, "utf8")) } catch { return undefined }
  }, [live, s?.name])
  const url = useMemo(() => {
    if (!s) return undefined
    const p = eikon.baked(s.name)
    return p ? eikon.header(p)?.source_url as string | undefined : undefined
  }, [s?.name])
  useEffect(() => {
    setPeek(undefined)
    if (!url || live) return
    let dead = false
    void eikon.peekSource(url).then(x => { if (!dead) setPeek(x) })
    return () => { dead = true }
  }, [url, live])

  const rows = useMemo(() => (s ? buildRows(r, s, live, url) : []), [r, s, live, url])
  const navRows = useMemo(() => rows.map((x, i) => ({ ...x, i })).filter(x => x.kind !== "divider"), [rows])

  // Render the current state's full clip. Sourceless falls through
  // to the baked .eikon's frames for the current state — Studio's
  // own ticker still drives playback so the play/pause + title
  // counter keep working in baked mode.
  useEffect(() => {
    if (!s) return
    if (!src) {
      const clip = baked?.states.get(s.state)
      setFrames(clip?.frames.length ? clip.frames : [BLANK])
      setErr(null); setBusy(false); setTick(0)
      return
    }
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
  }, [s?.spatial, s?.base, s?.per, s?.state, s?.fps, s?.rasterizer, src, r, baked])

  // Playback ticker — pure index advance over the already-rendered
  // `frames`. Zero work per tick; the filmstrip effect above did it
  // all once. Stops when paused, unfocused, still (1 frame), or busy.
  useEffect(() => {
    if (!play || !props.focused || frames.length <= 1 || busy) return
    const fps = live ? (s?.fps ?? FPS0) : (baked?.states.get(s?.state ?? "idle")?.fps ?? FPS0)
    const id = setInterval(() => setTick(t => t + 1), 1000 / Math.max(1, fps))
    return () => clearInterval(id)
  }, [play, props.focused, frames.length, busy, live, s?.fps, s?.state, baked])

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
        if (!sp) {
          const f = baked?.states.get(st)?.frames[0]
          return Promise.resolve([st, f ? thumb(f) : undefined] as const)
        }
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
  }, [frames, s?.per, s?.sources, s?.name, s?.fps, r, baked])

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
      if (!url || fetching) return
      setFetching(true)
      await eikon.fetchSource(s.name, url)
        .then(out => {
          toast.show({ variant: "success", message: `Fetched ${out.n} file(s) · ${mb(out.bytes)}` })
          open(s.name)
        })
        .catch(e => toast.error(e instanceof Error ? e : new Error(String(e))))
        .finally(() => setFetching(false))
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
      // Space toggles play/pause (nav.md: Space = toggle).
      if (keys.match("list.toggle", key)) return setPlay(p => !p)
      if (!spatialOk || !live) return
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
    if (!spatialOk || !live || !e.scroll) return
    const d = e.scroll.direction
    if (d !== "up" && d !== "down") return
    mutate(p => ({ ...p, spatial: knobs.zoom(p.spatial, d === "up" ? -1 : 1), dirty: true }))
  }

  const n = frames.length
  const title = s
    ? `Preview — ${s.state}${s.per[s.state] ? " (forked)" : ""}`
      + (n > 1 ? `  ·  ${play ? "▶" : "⏸"} ${(tick % n) + 1}/${n}` : "")
      + (live ? "" : baked ? "  ·  (baked)" : "")
    : "Preview"
  const previewErr = err ?? (!s || src || baked ? null
    : url ? "no source — Enter on 'fetch source' to download"
    :       "no source — Enter on 'source' to attach")

  const hint: Array<readonly [string, string]> =
    pane === "knobs"   ? [["↑↓", "row"], ["←→", "adjust"], [keys.print("list.activate"), "open"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]
  : pane === "preview" ? [["↑↓", "row"], ["←→", "adjust"], [keys.print("list.toggle"), "play/pause"], ["wheel", "zoom"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]
  :                      [["←→", "state"], [keys.print("list.activate"), "actions"], [keys.print("eikon.save"), "save"], ["Tab", "pane"]]

  // TabShell chrome = border(2) + padding(2) + title(1) + gap(1).
  // PanBars adds +1 row (pan-x) and +2 col (pan-y) around the frame.
  // SpatialBar = max(minimap height, 2 rows + 1 gap) + 1 margin.
  // Baked mode drops both — body sits alone at W×H.
  const BAR_H = spatialOk && live ? Math.max(Math.ceil(MINI_W / 2), 3) + 1 : 0
  const PREVIEW_W = Math.max(W + 2, 36 + 2 + MINI_W) + 6
  const PREVIEW_H = H + (spatialOk && live ? 1 : 0) + BAR_H + 6 + (previewErr ? 1 : 0)
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
      {spatialOk && live && s
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
                       on={on} dim={dim} peek={peek} busy={row.id === "fetch" && fetching}
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
