import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { readFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TabShell } from "../ui/shell"
import { HintBar } from "../ui/hint"
import { VBAR } from "../ui/table"
import { useKeys, handleListKey, useFollow } from "../keys"
import { openConfirm } from "../dialogs/confirm"
import { openEikonSubmit } from "../dialogs/eikon-submit"
import { openNewEikon } from "../dialogs/new-eikon"
import * as submitSvc from "../service/eikon-submit"
import { useKeyboard } from "@opentui/react"
import * as perf from "../utils/perf"
import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar"
import { listEikons, parseEikon, type ParsedEikon } from "../components/avatar/eikon"
import { BUNDLED_EIKON_DIR } from "../components/avatar/bundled"
import { hermesPath } from "../service/hermes-home"
import * as prefs from "../context/preferences"
import { eikon } from "../service/eikon"
import * as market from "../service/eikon-marketplace"
import type { MarketplaceRow, MarketplaceState } from "../service/eikon-marketplace"
import type { SidebarPreview } from "../components/sidebar/Sidebar"
import type { AvatarState } from "../components/avatar/states"

type Row = {
  path: string; name: string; slug: string; author?: string; bundled: boolean
  w: number; h: number; url?: string; hasSource: boolean
}

type Mode = "gallery" | "market"
type Pane = "grid" | "detail"

const NO_MARKET: MarketplaceState = { status: "empty", query: "", rows: [] }

export const EikonGallery = memo((props: {
  focused: boolean
  onEdit?: (name: string) => void
  sidebarPreview?: (preview?: SidebarPreview) => void
  submitReview?: submitSvc.SubmitReview
  sidebarHidden?: boolean
}) => {
  const theme = useTheme().theme
  const dialog = useDialog()
  const toast = useToast()
  const keys = useKeys()
  const rev = useSyncExternalStore(eikon.onRevision, eikon.revision)

  const rows = useMemo<Row[]>(() => {
    const user = hermesPath("eikons")
    const own = new Map(eikon.list().map(x => [x.name.toLowerCase(), x]))
    return listEikons([BUNDLED_EIKON_DIR, user]).map(e => {
      const slug = e.path.startsWith(BUNDLED_EIKON_DIR)
        ? e.meta.name.toLowerCase() : basename(dirname(e.path))
      const mine = own.get(slug)
      return {
        path: e.path, name: e.meta.name, slug, author: e.meta.author,
        bundled: e.path.startsWith(BUNDLED_EIKON_DIR),
        w: e.meta.width, h: e.meta.height,
        url: (mine?.sourceUrl ?? e.meta.source_url) as string | undefined,
        hasSource: mine?.hasSource ?? !!eikon.findSource(slug),
      }
    })
  }, [rev])

  const active = prefs.usePref("eikon")
  const [mode, setMode] = useState<Mode>("gallery")
  const [pane, setPane] = useState<Pane>("grid")
  const [sel, setSel] = useState(() => Math.max(0, rows.findIndex(r => r.slug === active)))
  const [marketSel, setMarketSel] = useState(0)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [state, setState] = useState<MarketplaceState>(NO_MARKET)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [previewState, setPreviewState] = useState<AvatarState>("idle")
  const [detailPreview, setDetailPreview] = useState<ParsedEikon | undefined>(undefined)
  const previewSeq = useRef(0)
  const galleryFollow = useFollow("gal", i => rows[i]?.slug ?? i)
  const marketFollow = useFollow("market", i => state.rows[i]?.entry.identityKey ?? i)

  useEffect(() => { if (sel >= rows.length) setSel(Math.max(0, rows.length - 1)) }, [rows.length, sel])
  useEffect(() => { if (marketSel >= state.rows.length) setMarketSel(Math.max(0, state.rows.length - 1)) }, [state.rows.length, marketSel])

  const cur = rows[sel]
  const parsed = useMemo<ParsedEikon | undefined>(() => {
    if (!cur) return undefined
    try { return parseEikon(readFileSync(cur.path, "utf8")) } catch { return undefined }
  }, [cur])

  const selected = state.rows[marketSel]

  useEffect(() => {
    setDetailPreview(undefined)
    if (mode !== "market" || !selected || !state.service || (!props.sidebarPreview && !props.sidebarHidden)) {
      props.sidebarPreview?.(undefined)
      return
    }
    const id = ++previewSeq.current
    const key = selected.entry.identityKey
    perf.count("market:preview:load")
    state.service.preview(key)
      .then(text => {
        if (previewSeq.current !== id) return
        const e = parseEikon(text)
        const st = e.states.has(previewState) ? previewState : "idle"
        if (props.sidebarHidden) setDetailPreview(e)
        else props.sidebarPreview?.({ key: `${key}:${st}`, eikon: e, state: st })
        perf.count("market:preview:ready")
      })
      .catch(() => {
        if (previewSeq.current !== id) return
        setDetailPreview(undefined)
        props.sidebarPreview?.(undefined)
        perf.count("market:preview:error")
      })
  }, [mode, selected?.entry.identityKey, state.service, previewState, props.sidebarPreview, props.sidebarHidden])

  useEffect(() => () => {
    previewSeq.current++
    setDetailPreview(undefined)
    props.sidebarPreview?.(undefined)
  }, [props.sidebarPreview])

  const loadMarket = useCallback((q = query) => {
    setLoading(true)
    const end = perf.mark("market:list:load")
    void market.load({ catalog: process.env.EIKON_URL, allowPrivate: true, query: q })
      .then(next => {
        perf.count("market:list:rows", next.rows.length)
        setState(next)
        setMarketSel(p => Math.max(0, Math.min(next.rows.length - 1, p)))
      })
      .finally(() => { end(); setLoading(false) })
  }, [query])

  useEffect(() => {
    if (mode !== "market") return
    loadMarket(query)
  }, [mode, query, rev, loadMarket])

  const activate = () => {
    if (!cur) return
    prefs.set("eikon", cur.slug)
    toast.show({ variant: "success", message: `Avatar → ${cur.name}` })
  }

  const openMarket = () => {
    setMode("market")
    setPane("grid")
    setSearching(false)
    setQuery("")
    setMarketSel(0)
  }

  const closeMarket = () => {
    previewSeq.current++
    props.sidebarPreview?.(undefined)
    setMode("gallery")
    setSearching(false)
    setQuery("")
    setPane("grid")
  }

  const doNew = useCallback(async () => {
    const res = await openNewEikon(dialog, {})
    if (!res) return
    if (res.from === "blank") {
      eikon.ensure(res.name)
      return props.onEdit?.(res.name)
    }
    if (res.from === "file") {
      eikon.ensure(res.name)
      try { eikon.adopt(res.name, res.file, "base") }
      catch (e) { return toast.error(e instanceof Error ? e : new Error(String(e))) }
      return props.onEdit?.(res.name)
    }
    toast.show({ variant: "info", message: `Installing '${res.name}' from ${res.src}…` })
    await eikon.fetchSource(res.src, { name: res.name })
      .then(out => {
        toast.show({ variant: "success", message: `Installed '${out.name}' (${out.n} files)` })
        prefs.set("eikon", out.name)
      })
      .catch(e => toast.error(e instanceof Error ? e : new Error(String(e))))
  }, [dialog, toast, props])

  const submitLocal = useCallback(async () => {
    if (!cur || cur.bundled) return
    await openEikonSubmit(dialog, {
      name: cur.name,
      path: submitSvc.submitPath(cur.slug),
      submitReview: props.submitReview ?? submitSvc.submit,
    })
  }, [cur, dialog, props.submitReview])

  const del = async () => {
    if (!cur || cur.bundled) return
    const ok = await openConfirm(dialog, {
      title: `Delete '${cur.name}'?`, danger: true,
      body: `Removes ${dirname(cur.path)} and all its sources. This cannot be undone.`,
    })
    if (!ok) return
    eikon.remove(cur.slug)
    toast.show({ variant: "info", message: `Deleted ${cur.name}` })
  }

  const primary = useCallback((idx?: number) => {
    const row = state.rows[idx ?? marketSel]
    const svc = state.service
    if (!row || !svc || installing) return
    if (row.action === "active") return
    if (row.action === "use") {
      const name = row.installedManifest?.name ?? row.entry.name
      prefs.set("eikon", name)
      toast.show({ variant: "success", message: `Avatar → ${name}` })
      loadMarket(query)
      return
    }
    setInstalling(true)
    void svc.install(row.entry.identityKey)
      .then(out => {
        toast.show({ variant: "success", message: `Installed '${out.name}' (${out.n} files)` })
        loadMarket(query)
      })
      .catch(err => {
        const e = err instanceof Error ? err : new Error(String(err))
        toast.show({ variant: "error", title: "Install failed", message: e.message, duration: 6000 })
        loadMarket(query)
      })
      .finally(() => setInstalling(false))
  }, [state.rows, state.service, marketSel, installing, toast, loadMarket, query])

  useKeyboard(key => {
    if (!props.focused || dialog.open()) return
    if (mode === "market") {
      if (searching) {
        if (key.name === "escape") { setSearching(false); return }
        if (key.name === "backspace") { setQuery(q => q.slice(0, -1)); setMarketSel(0); return }
        if (key.raw && key.raw.length === 1 && key.raw >= " ") { setQuery(q => q + key.raw); setMarketSel(0); return }
        return
      }
      if (key.name === "escape") return closeMarket()
      if (key.shift && key.name === "tab") { setPane(p => p === "detail" ? "grid" : "detail"); return }
      if (key.name === "tab") { setPane(p => p === "grid" ? "detail" : "grid"); return }
      if (key.name === "left" || key.name === "right") { setPreviewState(s => s === "idle" ? "thinking" : "idle"); return }
      if (handleListKey(keys, key, {
        count: state.rows.length, setSel: setMarketSel, ...marketFollow.opts,
        onActivate: primary,
        onSearch: () => setSearching(true),
        onRefresh: () => loadMarket(query),
      })) return
      return
    }
    if (handleListKey(keys, key, {
      count: rows.length, setSel, ...galleryFollow.opts,
      onActivate: activate,
      onDelete: () => void del(),
      onNew: doNew,
    })) return
    if (key.name === "u" && cur && !cur.bundled) return void submitLocal()
    if (keys.match("eikon.marketplace", key)) return openMarket()
    if (key.name === "e" && cur && props.onEdit) props.onEdit(cur.slug)
  })

  if (mode === "market") {
    perf.count("market:render")
    return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
      <box height={1} flexDirection="row">
        <box width={10} onMouseDown={closeMarket}><text fg={theme.primary}>‹ Back</text></box>
      </box>
      <box flexDirection="row" flexGrow={1}>
        <TabShell title={`Marketplace (${state.rows.length})${searching ? ` Search: ${query}` : ""}`} focus={props.focused && pane === "grid"} grow={3}>
          <MarketplaceGrid rows={state.rows} sel={marketSel} active={active} follow={marketFollow}
            loading={loading} error={state.error} onSel={setMarketSel} onUse={primary} />
        </TabShell>
        <TabShell title={selected ? `Details — ${selected.entry.name}` : "Details"} focus={props.focused && pane === "detail"} grow={2}>
          <MarketplaceDetail row={selected} loading={loading} installing={installing} onUse={() => primary()}
            preview={props.sidebarHidden ? detailPreview : undefined} previewState={previewState} />
        </TabShell>
      </box>
      <HintBar pairs={[
        ["↑↓/Pg/Home/End", "select"], [keys.print("list.activate"), actionLabel(selected)],
        [keys.print("list.search"), searching ? "typing search" : "search"], [keys.print("list.refresh"), "reload"],
        [keys.print("focus.cycle"), "pane"], ["Esc", searching ? "exit search" : "back"],
      ]} />
    </box>
  )
  }

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
      <box flexDirection="row" flexGrow={1}>
        <TabShell title={`Gallery (${rows.length})`} focus={props.focused} grow={2}>
          <scrollbox ref={galleryFollow.ref} scrollY flexGrow={1} verticalScrollbarOptions={VBAR}>
            {rows.length === 0
              ? <text fg={theme.textMuted}>No eikons found.</text>
              : rows.map((r, i) => {
                  const on = i === sel
                  const here = r.slug === active
                  return (
                    <box key={r.path} id={galleryFollow.id(i)} flexDirection="row" height={2}
                         backgroundColor={on ? theme.backgroundElement : undefined}
                         onMouseMove={() => setSel(i)} onMouseDown={activate}>
                      <box width={2}><text fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</text></box>
                      <box flexDirection="column" flexGrow={1} minWidth={0}>
                        <box height={1}><text fg={here ? theme.accent : theme.text}>
                          {here ? "● " : "  "}<strong>{r.name}</strong>
                          <span fg={theme.textMuted}>{r.bundled ? "  (bundled)" : ""}</span>
                        </text></box>
                        <box height={1}><text fg={theme.textMuted}>
                          {`  ${r.author ?? "—"} · ${r.w}×${r.h} · `}
                          <span fg={r.hasSource ? theme.success : r.url ? theme.textMuted : theme.border}>
                            {r.hasSource ? "● source" : r.url ? "○ source available" : "— no source"}
                          </span>
                        </text></box>
                      </box>
                    </box>
                  )
                })}
          </scrollbox>
        </TabShell>
        <TabShell title={cur ? `Preview — ${cur.name}` : "Preview"} grow={3}>
          <box alignItems="center" justifyContent="center" flexGrow={1}>
            {parsed
              ? <AnimatedAvatar key={cur!.path} state="idle" eikon={parsed} />
              : <text fg={theme.textMuted}>No preview.</text>}
          </box>
        </TabShell>
      </box>
      <HintBar pairs={[
        ["↑↓", "select"], [keys.print("list.activate"), "use"], [keys.print("eikon.marketplace"), "marketplace"],
        ["e", "edit in studio"], ...(cur && !cur.bundled ? [["u", "submit"] as const] : []), [keys.print("list.new"), "new / install"],
        ...(cur && !cur.bundled ? [[keys.print("list.delete"), "delete"] as const] : []),
      ]} />
    </box>
  )
})

const MarketplaceGrid = (props: {
  rows: MarketplaceRow[]; sel: number; active?: string; follow: ReturnType<typeof useFollow>
  loading: boolean; error?: string; onSel: (i: number) => void; onUse: (i: number) => void
}) => {
  const theme = useTheme().theme
  if (props.error) return <box key="error" padding={1}><text fg={theme.error} wrapMode="word">Marketplace unavailable: {props.error}</text></box>
  if (props.loading && props.rows.length === 0) return <box key="loading" padding={1}><text fg={theme.textMuted}>Loading shared eikons…</text></box>
  if (props.rows.length === 0) return <box key="empty" padding={1}><text fg={theme.textMuted}>No shared eikons match. Press / to change search or Esc to go back.</text></box>
  return (
    <scrollbox key="rows" ref={props.follow.ref} scrollY flexGrow={1} verticalScrollbarOptions={VBAR}>
      {props.rows.map((r, i) => {
        const on = i === props.sel
        return (
          <box key={r.entry.identityKey} id={props.follow.id(i)} flexDirection="column" minHeight={4}
               backgroundColor={on ? theme.backgroundElement : undefined}
               onMouseMove={() => props.onSel(i)} onMouseDown={() => { props.onSel(i); props.onUse(i) }}>
            <box height={1} flexDirection="row">
              <box width={2}><text fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</text></box>
              <box flexGrow={1} minWidth={0} height={1} overflow="hidden"><text fg={r.active ? theme.accent : theme.text} wrapMode="none">{r.active ? "● " : "  "}<strong>{r.entry.name}</strong>  <span fg={theme.textMuted}>{r.entry.author ?? "—"}</span></text></box>
              <box width={10}><text fg={actionColor(r, theme)}>{actionLabel(r)}</text></box>
            </box>
            <box height={1} paddingLeft={2} overflow="hidden"><text fg={theme.textMuted} wrapMode="none">{r.entry.poster || "(no poster)"}</text></box>
            <box height={1} paddingLeft={2} overflow="hidden"><text fg={theme.textMuted} wrapMode="none">{r.entry.description ?? "No description."}</text></box>
            <box height={1} paddingLeft={2} overflow="hidden"><text fg={theme.textMuted} wrapMode="none">{trust(r)} · {r.installed ? r.active ? "active" : "installed" : "not installed"}</text></box>
          </box>
        )
      })}
    </scrollbox>
  )
}

const MarketplaceDetail = (props: {
  row?: MarketplaceRow
  loading: boolean
  installing: boolean
  onUse: () => void
  preview?: ParsedEikon
  previewState: AvatarState
}) => {
  const theme = useTheme().theme
  const r = props.row
  if (!r) return <box padding={1}><text fg={theme.textMuted}>{props.loading ? "Loading shared eikons…" : "No marketplace entry selected."}</text></box>
  return (
    <box flexDirection="column" padding={1} gap={1}>
      {props.preview ? (
        <box alignItems="center" justifyContent="center" height={8} overflow="hidden">
          <AnimatedAvatar key={r.entry.identityKey} state={props.previewState} eikon={props.preview} />
        </box>
      ) : null}
      <text fg={r.active ? theme.accent : theme.text}><strong>{r.active ? "● " : ""}{r.entry.name}</strong></text>
      <text fg={theme.textMuted}>by {r.entry.author ?? "unknown"}</text>
      <text fg={theme.text} wrapMode="word">{r.entry.description ?? "No description."}</text>
      <text fg={theme.textMuted}>review: {r.entry.trust.reviewStatus ?? "unreviewed"}</text>
      <text fg={theme.textMuted}>license: {r.entry.trust.license ?? "unknown"}</text>
      <text fg={theme.textMuted}>provenance: {r.entry.trust.provenance ?? r.entry.provenanceUrl ?? "unknown"}</text>
      <text fg={theme.textMuted}>state: {r.installed ? r.active ? "active" : "installed" : "not installed"}</text>
      <box height={1} onMouseDown={props.onUse}>
        <text fg={r.action === "active" ? theme.textMuted : theme.primary}>{props.installing ? "Installing…" : actionLabel(r)}</text>
      </box>
    </box>
  )
}

const actionLabel = (row?: MarketplaceRow) => {
  if (!row) return "action"
  if (row.action === "install") return "Install"
  if (row.action === "use") return "Use"
  if (row.action === "retry") return "Retry"
  return "Active"
}

const trust = (row: MarketplaceRow) => {
  const r = row.entry.trust.reviewStatus ?? "unreviewed"
  const l = row.entry.trust.license ?? "unknown license"
  const p = row.entry.trust.provenance ?? "unknown provenance"
  return `${r} · ${l} · ${p}`
}

const actionColor = (row: MarketplaceRow, theme: ReturnType<typeof useTheme>["theme"]) => {
  if (row.action === "active") return theme.textMuted
  if (row.action === "use") return theme.success
  return theme.primary
}
