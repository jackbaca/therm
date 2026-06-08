import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { TabShell } from "../ui/shell"
import { HintBar } from "../ui/hint"
import { openConfirm } from "../dialogs/confirm"
import { openEikonMarketplaceAction } from "../dialogs/eikon-marketplace-action"
import { VBAR } from "../ui/table"
import { useKeys, handleListKey, useFollow } from "../keys"
import * as perf from "../utils/perf"
import { parseEikon } from "../components/avatar/eikon"
import { eikon } from "../service/eikon"
import * as market from "../service/eikon-marketplace"
import type { MarketplaceRow, MarketplaceState } from "../service/eikon-marketplace"
import type { SidebarPreview } from "../components/sidebar/Sidebar"
import type { AvatarState } from "../components/avatar/states"

const NO_MARKET: MarketplaceState = { status: "empty", query: "", rows: [] }

function localCatalog(raw?: string) {
  if (!raw) return false
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    return url.protocol === "file:" || host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost")
  } catch { return false }
}

export const EikonMarketplace = memo((props: {
  focused: boolean
  sidebarPreview?: (preview?: SidebarPreview) => void
  sidebarHidden?: boolean
}) => {
  const toast = useToast()
  const dialog = useDialog()
  const keys = useKeys()
  const rev = useSyncExternalStore(eikon.onRevision, eikon.revision)
  const [sel, setSel] = useState(0)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [state, setState] = useState<MarketplaceState>(NO_MARKET)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [previewState, setPreviewState] = useState<AvatarState>("idle")
  const [detailPreview, setDetailPreview] = useState<SidebarPreview | undefined>(undefined)
  const previewSeq = useRef(0)
  const follow = useFollow("market", i => state.rows[i]?.entry.identityKey ?? i)

  useEffect(() => { if (sel >= state.rows.length) setSel(Math.max(0, state.rows.length - 1)) }, [state.rows.length, sel])

  const selected = state.rows[sel]

  useEffect(() => {
    if (!selected || !state.service) {
      setDetailPreview(undefined)
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
        const preview: SidebarPreview = {
          key: `${key}:${st}`,
          eikon: e,
          state: st,
          title: selected.entry.name,
          subtitle: selected.entry.author ?? "unknown",
          body: selected.entry.description ?? "No description.",
          rows: [
            { label: "Status", value: previewStatus(selected), block: true },
            { label: "Source", value: sourceText(selected), block: true },
            { label: "Compat", value: compatText(selected) },
            { label: "State", value: st },
            { label: "Digest", value: digest(selected) ?? "unknown", block: true },
          ],
          states: [...e.states.keys()] as AvatarState[],
          onState: setPreviewState,
        }
        if (props.sidebarPreview) props.sidebarPreview(preview)
        setDetailPreview(preview)
        perf.count("market:preview:ready")
      })
      .catch(() => {
        if (previewSeq.current !== id) return
        setDetailPreview(undefined)
        props.sidebarPreview?.(undefined)
        perf.count("market:preview:error")
      })
  }, [selected, state.service, previewState, props.sidebarPreview, props.sidebarHidden])

  useEffect(() => () => {
    previewSeq.current++
    setDetailPreview(undefined)
    props.sidebarPreview?.(undefined)
  }, [props.sidebarPreview])

  const loadMarket = useCallback((q = query) => {
    setLoading(true)
    const end = perf.mark("market:list:load")
    const catalog = process.env.EIKON_URL
    void market.load({ catalog, allowPrivate: localCatalog(catalog), query: q })
      .then(next => {
        perf.count("market:list:rows", next.rows.length)
        setState(next)
        setSel(p => Math.max(0, Math.min(next.rows.length - 1, p)))
      })
      .finally(() => { end(); setLoading(false) })
  }, [query])

  const refreshMarket = useCallback((svc: market.MarketplaceService, q = query) => {
    const rows = svc.rows(q)
    setState({ status: rows.length > 0 ? "ready" : "empty", query: q, rows, selected: rows[0], service: svc })
    setSel(p => Math.max(0, Math.min(rows.length - 1, p)))
  }, [query])

  useEffect(() => { loadMarket(query) }, [query, rev, loadMarket])

  const clearPreview = useCallback(() => {
    previewSeq.current++
    props.sidebarPreview?.(undefined)
    setDetailPreview(undefined)
  }, [props.sidebarPreview])

  const primary = useCallback((idx?: number) => {
    const row = state.rows[idx ?? sel]
    const svc = state.service
    if (!row || !svc || installing) return
    const run = async () => {
      const sizes = !row.installed ? await svc.packageSizes(row.entry.identityKey).catch(() => undefined) : undefined
      const pick = await openEikonMarketplaceAction(dialog, { row, sizes })
      if (!pick) return
      if (pick === "use") {
        const name = row.installedName ?? row.entry.name
        eikon.useInstalled(name)
        toast.show({ variant: "success", message: `Avatar → ${name}` })
        refreshMarket(svc, query)
        return
      }
      if (pick === "delete") return removeSelected(idx)
      setInstalling(true)
      try {
        const confirm = row.installState === "active-name-conflict"
          ? await openConfirm(dialog, {
              title: `Replace active '${row.entry.name}'?`, danger: true,
              body: `Installing this marketplace package will replace the active avatar's backing package for '${row.entry.name}' because another package with the same installed name is active. This cannot be undone.`,
              yes: "replace active", no: "cancel",
            })
          : true
        if (!confirm) return
        const out = pick === "download" ? await svc.downloadSource(row.entry.identityKey) : await svc.install(row.entry.identityKey, { media: pick === "source", confirmActive: row.installState === "active-name-conflict" })
        toast.show({ variant: "success", message: pick === "download" ? `Downloaded source for '${out.name}'` : `Installed '${out.name}' (${out.n} files)` })
        refreshMarket(svc, query)
      } catch (err) {
        toast.show({ variant: "error", title: pick === "download" ? "Source download failed" : "Install failed", message: err instanceof Error ? err.message : String(err), duration: 6000 })
        refreshMarket(svc, query)
      } finally {
        setInstalling(false)
      }
    }
    void run()
  }, [dialog, state.rows, state.service, sel, installing, toast, refreshMarket, query])

  const removeSelected = useCallback(async (idx?: number) => {
    const row = state.rows[idx ?? sel]
    const svc = state.service
    const name = row?.installedName ?? row?.entry.name
    if (!row || !svc || !name || !row.removable) return toast.show({ variant: "warning", message: "This eikon is not removable" })
    const active = row.active
    const ok = await openConfirm(dialog, {
      title: `Remove '${name}'?`, danger: true,
      body: active
        ? `Remove the local package for '${name}'. This is the active avatar; removal will clear the active avatar selection. This cannot be undone.`
        : `Remove the local package for '${name}'. This does not change the active avatar. This cannot be undone.`,
      yes: "remove", no: "cancel",
    })
    if (!ok) return
    const out = eikon.remove(name, { confirmActive: active })
    if (out) return toast.show({ variant: "warning", message: out.message })
    toast.show({ variant: "info", message: `Removed '${name}'` })
    refreshMarket(svc, query)
  }, [dialog, query, refreshMarket, sel, state.rows, state.service, toast])

  useKeyboard(key => {
    if (!props.focused || dialog.open()) return
    if (searching) {
      if (key.name === "escape") { setSearching(false); return }
      if (key.name === "backspace") { setQuery(q => q.slice(0, -1)); setSel(0); return }
      if (key.raw && key.raw.length === 1 && key.raw >= " ") { setQuery(q => q + key.raw); setSel(0); return }
      return
    }
    if (key.name === "escape") return clearPreview()
    const plain = !key.shift && !key.ctrl && !key.meta
    const move = (by: number) => setSel(p => {
      const n = Math.max(0, Math.min(state.rows.length - 1, p + by))
      follow.opts.scrollTo?.(n)
      return n
    })
    if (plain && key.name === "left") { move(-1); return }
    if (plain && key.name === "right") { move(1); return }
    if (plain && key.name === "up") { move(-2); return }
    if (plain && key.name === "down") { move(2); return }
    if (handleListKey(keys, key, {
      count: state.rows.length, setSel, ...follow.opts,
      onActivate: primary,
      onToggle: () => setPreviewState(s => s === "idle" ? "thinking" : "idle"),
      onSearch: () => setSearching(true),
      onRefresh: () => loadMarket(query),
      onDelete: () => void removeSelected(),
    })) return
  })

  perf.count("market:render")
  const fallback = props.sidebarHidden || !props.sidebarPreview
  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <box flexDirection="row" flexGrow={1} minWidth={0} minHeight={0}>
        <TabShell title={`Marketplace (${state.rows.length})${searching ? ` Search: ${query}` : ""}`} focus={props.focused} grow={fallback ? 3 : 1}>
          <MarketplaceGrid rows={state.rows} sel={sel} follow={follow}
            loading={loading} error={state.error} onSel={setSel} onUse={primary} />
        </TabShell>
        {fallback ? (
          <TabShell title={selected ? `Details — ${selected.entry.name}` : "Details"} grow={2}>
            <MarketplaceDetail row={selected} loading={loading} installing={installing} onUse={() => primary()}
              onState={setPreviewState} preview={detailPreview} />
          </TabShell>
        ) : null}
      </box>
      <HintBar pairs={[
        [keys.print("list.activate"), "actions"], ["↑↓←→/Pg", "select"],
        [keys.print("list.search"), searching ? "typing search" : "search"], [keys.print("list.refresh"), "reload"],
        ["d", "delete in modal"], ["Space", "preview"],
      ]} />
    </box>
  )
})

const MarketplaceGrid = (props: {
  rows: MarketplaceRow[]; sel: number; follow: ReturnType<typeof useFollow>
  loading: boolean; error?: string; onSel: (i: number) => void; onUse: (i: number) => void
}) => {
  const theme = useTheme().theme
  if (props.error) return <box key="error" padding={1}><text fg={theme.error} wrapMode="word">Marketplace unavailable: {props.error}</text></box>
  if (props.loading && props.rows.length === 0) return <box key="loading" padding={1}><text fg={theme.textMuted}>Loading shared eikons…</text></box>
  if (props.rows.length === 0) return <box key="empty" padding={1}><text fg={theme.textMuted}>No shared eikons match. Press / to change search.</text></box>
  return (
    <scrollbox key="rows" ref={props.follow.ref} scrollY flexGrow={1} verticalScrollbarOptions={VBAR}>
      {chunk(props.rows, 2).map((rows, y) => {
        const h = Math.max(...rows.map(cardHeight))
        return (
          <box key={y} flexDirection="row" height={h} flexShrink={0} width="100%">
            {rows.map((r, x) => {
              const i = y * 2 + x
              const on = i === props.sel
              const lines = posterLines(r.entry.poster)
              return (
                <box key={r.entry.identityKey} id={props.follow.id(i)} flexDirection="column" height={h} width="50%" paddingX={1}
                     backgroundColor={on ? theme.backgroundElement : undefined}
                     onMouseMove={() => props.onSel(i)} onMouseDown={() => { props.onSel(i); props.onUse(i) }}>
                  <box height={lines.length} overflow="hidden" flexDirection="column">
                    {lines.map((line, j) => (
                      <box key={j} height={1} overflow="hidden"><text fg={theme.textMuted} wrapMode="none">{line || " "}</text></box>
                    ))}
                  </box>
                  <box height={1} overflow="hidden"><text fg={r.active ? theme.accent : theme.text} wrapMode="none">{on ? "▸ " : "  "}{r.active ? "● " : "  "}<strong>{r.entry.name}</strong></text></box>
                  <box height={1} overflow="hidden"><text fg={theme.textMuted} wrapMode="none">by {r.entry.author ?? "unknown"} · {stateLabel(r, true)}</text></box>
                </box>
              )
            })}
          </box>
        )
      })}
    </scrollbox>
  )
}

const posterLines = (poster?: string) => {
  const lines = poster ? poster.split("\n") : []
  return lines.length ? lines : ["(no poster)"]
}

const cardHeight = (row: MarketplaceRow) => posterLines(row.entry.poster).length + 2

const chunk = <T,>(rows: T[], n: number) => rows.reduce<T[][]>((acc, row, i) => {
  if (i % n === 0) acc.push([])
  acc[acc.length - 1]!.push(row)
  return acc
}, [])

const MarketplaceDetail = (props: {
  row?: MarketplaceRow
  loading: boolean
  installing: boolean
  onUse: () => void
  onState: (state: AvatarState) => void
  preview?: SidebarPreview
}) => {
  const theme = useTheme().theme
  const r = props.row
  if (!r) return <box padding={1}><text fg={theme.textMuted}>{props.loading ? "Loading shared eikons…" : "No marketplace entry selected."}</text></box>
  const previewState = props.preview?.state ?? "idle"
  const states = props.preview ? [...props.preview.eikon.states.keys()] as AvatarState[] : [previewState]
  return (
    <box flexDirection="column" padding={1} gap={1}>
      {props.preview ? (
        <box alignItems="center" justifyContent="center" height={8} overflow="hidden">
          <box flexDirection="column">
            {props.preview.eikon.states.get(props.preview.state)?.frames[0]?.map((line, i) => (
              <text key={i}>{line}</text>
            ))}
          </box>
        </box>
      ) : null}
      <text fg={r.active ? theme.accent : theme.text}><strong>{r.active ? "● " : ""}{r.entry.name}</strong></text>
      <text fg={theme.textMuted}>by {r.entry.author ?? "unknown"}</text>
      <text fg={theme.text} wrapMode="word">{r.entry.description ?? "No description."}</text>
      <DetailRow label="Status" value={stateLabel(r)} block />
      <DetailRow label="Trust" value={trustLabel(r)} block />
      <DetailRow label="Source" value={sourceText(r)} block />
      <DetailRow label="Compat" value={compatText(r)} />
      <DetailRow label="Digest" value={digest(r) ?? "unknown"} block />
      <box flexDirection="row" height={1}>
        {states.map(s => (
          <box key={s} height={1} paddingRight={1} onMouseDown={() => props.onState(s)}>
            <text fg={s === previewState ? theme.primary : theme.textMuted}>{s}</text>
          </box>
        ))}
      </box>
      <box height={1} onMouseDown={props.onUse}>
        <text fg={r.action === "active" ? theme.textMuted : theme.primary}>{props.installing ? "Installing…" : "Open actions"}</text>
      </box>
    </box>
  )
}

const DetailRow = (props: { label: string; value: string; block?: boolean }) => {
  const theme = useTheme().theme
  if (props.block) return (
    <box flexDirection="column" minHeight={2}>
      <text fg={theme.textMuted}>{props.label}</text>
      <text fg={theme.text} wrapMode="word">{props.value}</text>
    </box>
  )
  return <text fg={theme.textMuted}>{props.label}: {props.value}</text>
}

const shortDigest = (value?: string) => {
  if (!value) return undefined
  const [algo, hash] = value.includes(":") ? value.split(":", 2) : [undefined, value]
  if (!hash || hash.length <= 16) return value
  return algo ? `${algo}:${hash.slice(0, 12)}…` : `${hash.slice(0, 12)}…`
}

const digest = (row: MarketplaceRow) => {
  const t = row.entry.trust as { manifestDigest?: string; runtimeDigest?: string; digest?: string }
  return shortDigest(t.manifestDigest ?? t.runtimeDigest ?? t.digest)
}


const trustLabel = (row: MarketplaceRow) => {
  const t = row.trust === "mismatch" ? "Mismatch" : row.trust === "verified" ? "Verified" : row.trust === "unverified" ? "Unverified" : "Trust unknown"
  return row.reason && row.trust === "mismatch" ? `${t}: ${row.reason}` : t
}

const previewStatus = (row: MarketplaceRow) => {
  const base = row.installState === "active-name-conflict" ? "active name conflict" : row.active ? "active" : row.installed ? "installed" : "not installed"
  const src = row.sourcePresent ? " · source present" : row.sourceAvailable ? " · source available" : ""
  const rm = row.removable ? " · removable" : row.installed ? " · not removable" : ""
  return `${base}${src}${rm}`
}

const sourceText = (row: MarketplaceRow) => row.sourceIdentity ?? row.lifecycle.source.packageUrl ?? row.entry.sourceKey ?? row.entry.packageUrl

const compatText = (row: MarketplaceRow) => row.installState === "incompatible"
  ? `Blocked: ${row.reason ?? "requires newer Herm/eikon"}`
  : row.installState === "active-name-conflict" ? `Requires confirmation: ${row.reason}` : "Compatible"

const stateLabel = (row: MarketplaceRow, short = false) => {
  const base = row.installState === "active-name-conflict" ? "active name conflict" : row.active ? "active" : row.installed ? "installed" : "not installed"
  if (short) return base
  const src = row.sourcePresent ? " · source present" : row.sourceDownloadable ? " · source downloadable" : row.sourceAvailable ? " · source available" : ""
  const rm = row.removable ? " · removable" : row.installed ? " · not removable" : ""
  return `${base}${src}${rm}`
}
