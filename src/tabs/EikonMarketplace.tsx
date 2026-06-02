import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useKeyboard } from "@opentui/react"
import type { ParsedEikon } from "../components/avatar/eikon"
import { AnimatedAvatar } from "../components/avatar/AnimatedAvatar"
import { useEikonPreview } from "../context/eikon-preview"
import { useKeys, handleListKey, useFollow } from "../keys"
import { eikon, type CatalogPackage, type PackageState } from "../service/eikon"
import { useTheme } from "../theme"
import { HintBar } from "../ui/hint"
import { Spinner } from "../ui/spinner"
import { TabShell } from "../ui/shell"
import { VBAR } from "../ui/table"
import { trunc } from "../ui/fmt"

const stateLabel: Record<PackageState, string> = {
  available: "available",
  invalid: "invalid",
  installed: "installed",
  active: "active",
  "update-available": "update",
  incompatible: "incompatible",
}

type Phase = "loading" | "ready" | "error"
type Preview = { id: string; parsed?: ParsedEikon; loading: boolean; error?: string }
type Busy = { id: string; op: "install" | "use" } | undefined

const msg = (err: unknown) => err instanceof Error ? err.message : String(err)
const title = (p: CatalogPackage) => p.title ?? p.name
const badge = (p: CatalogPackage) => stateLabel[p.state]

export const EikonMarketplace = memo((props: { focused: boolean }) => {
  const theme = useTheme().theme
  const keys = useKeys()
  const follow = useFollow("market")
  const sidebar = useEikonPreview()
  const rev = useSyncExternalStore(eikon.onRevision, eikon.revision)
  const seq = useRef(0)
  const [phase, setPhase] = useState<Phase>("loading")
  const [err, setErr] = useState("")
  const [rows, setRows] = useState<CatalogPackage[]>([])
  const [sel, setSel] = useState(0)
  const [preview, setPreview] = useState<Preview | undefined>(undefined)
  const [busy, setBusy] = useState<Busy>(undefined)

  const load = useCallback(() => {
    const id = ++seq.current
    setPhase("loading")
    setErr("")
    eikon.loadCatalog()
      .then(out => {
        if (seq.current !== id) return
        setRows(out)
        setPhase("ready")
      })
      .catch(e => {
        if (seq.current !== id) return
        setRows([])
        setErr(msg(e))
        setPhase("error")
      })
  }, [])

  useEffect(load, [load, rev])
  useEffect(() => { if (sel >= rows.length) setSel(Math.max(0, rows.length - 1)) }, [rows.length, sel])

  const cur = rows[sel]
  useEffect(() => {
    if (!cur) {
      sidebar.clearPreview()
      setPreview(undefined)
      return
    }
    const id = cur.id || cur.packageUrl
    let live = true
    setPreview({ id, loading: true })
    sidebar.clearPreview()
    eikon.previewPackage(cur)
      .then(out => {
        if (!live) return
        setPreview({ id, parsed: out.eikon, loading: false })
        sidebar.setPreview({ id, title: title(cur), source: cur.packageUrl, eikon: out.eikon })
      })
      .catch(e => {
        if (!live) return
        setPreview({ id, loading: false, error: msg(e) })
        sidebar.clearPreview(id)
      })
    return () => {
      live = false
      sidebar.clearPreview(id)
    }
  }, [cur?.id, cur?.packageUrl])

  const install = useCallback(async () => {
    if (!cur || cur.state === "active" || cur.state === "incompatible") return
    setBusy({ id: cur.id, op: "install" })
    try { await eikon.installPackage(cur) }
    catch (e) { setErr(`install: ${msg(e)}`); setPhase("error") }
    finally { setBusy(undefined); load() }
  }, [cur, load])

  const use = useCallback(async () => {
    if (!cur || cur.state === "incompatible") return
    setBusy({ id: cur.id, op: "use" })
    try {
      if (cur.state === "available" || cur.state === "update-available") await eikon.installPackage(cur)
      eikon.useInstalled(cur.name)
    } catch (e) {
      setErr(`use: ${msg(e)}`)
      setPhase("error")
    } finally {
      setBusy(undefined)
      load()
    }
  }, [cur, load])

  useKeyboard(key => {
    if (!props.focused) return
    if (handleListKey(keys, key, { count: rows.length, setSel, ...follow.opts, onRefresh: load, onActivate: use })) return
    if (key.name === "i") void install()
    if (key.name === "u") void use()
    if (key.name === "escape") sidebar.clearPreview()
  })

  const detail = useMemo(() => cur ? [
    ["Name", cur.name],
    ["Author", cur.author ?? "—"],
    ["State", badge(cur)],
    ["Compat", cur.compatibility.available === false ? cur.compatibility.reason ?? "incompatible" : cur.compatibility.eikon],
    ["Package", cur.packageUrl],
  ] as const : [], [cur])

  const busyCur = busy && cur && busy.id === cur.id ? busy.op : undefined
  return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <TabShell title={`Marketplace (${rows.length})`} focus={props.focused} grow={2}>
          {phase === "loading" ? <Spinner label="Loading public Eikons…" />
          : phase === "error" ? <box padding={1}><text fg={theme.error} wrapMode="word">{err || "Marketplace load failed"}</text></box>
          : <scrollbox ref={follow.ref} scrollY flexGrow={1} verticalScrollbarOptions={VBAR}>
              {rows.length === 0 ? <box padding={1}><text fg={theme.textMuted}>No marketplace Eikons.</text></box> : rows.map((r, i) => {
                const on = i === sel
                const active = r.state === "active"
                const unavailable = r.state === "invalid" || r.state === "incompatible"
                return (
                  <box key={r.id || r.packageUrl} id={follow.id(i)} flexDirection="column" minHeight={3}
                       backgroundColor={on ? theme.backgroundElement : undefined}
                       onMouseMove={() => setSel(i)} onMouseDown={() => { setSel(i); void use() }}>
                    <box flexDirection="row" height={1}>
                      <box width={2}><text fg={on ? theme.primary : theme.textMuted}>{on ? "▸ " : "  "}</text></box>
                      <box flexGrow={1} minWidth={0} height={1} overflow="hidden"><text fg={active ? theme.accent : unavailable ? theme.warning : theme.text} wrapMode="none"><strong>{title(r)}</strong></text></box>
                      <box width={14} height={1} overflow="hidden"><text fg={active ? theme.accent : unavailable ? theme.warning : theme.textMuted}>{badge(r)}</text></box>
                    </box>
                    <box height={1}><text fg={theme.textMuted} wrapMode="none">{`  ${trunc(r.author ?? "unknown", 18)} · ${trunc(r.description ?? r.packageUrl, 64)}`}</text></box>
                    <box height={1}><text fg={theme.textMuted} wrapMode="none">{`  ${r.tags?.slice(0, 4).join(" ") ?? ""}`}</text></box>
                  </box>
                )
              })}
            </scrollbox>}
        </TabShell>
        <TabShell title={cur ? `Remote preview — ${title(cur)}` : "Remote preview"} grow={3}>
          <box flexDirection="column" flexGrow={1} padding={1} minWidth={0}>
            {cur ? <>
              <box height={1}><text fg={theme.text}>{title(cur)} <span fg={theme.textMuted}>{`(${cur.name})`}</span></text></box>
              <box height={1}><text fg={theme.textMuted}>Sidebar preview is temporary; Install does not activate; Use activates.</text></box>
              <box height={1} />
              <box flexGrow={1} alignItems="center" justifyContent="center">
                {preview?.loading ? <Spinner label="Loading preview…" />
                : preview?.error ? <text fg={theme.error} wrapMode="word">{preview.error}</text>
                : preview?.parsed ? <AnimatedAvatar key={preview.id} state="idle" eikon={preview.parsed} />
                : <text fg={theme.textMuted}>No preview.</text>}
              </box>
              <box flexDirection="column" flexShrink={0}>
                {detail.map(([k, v]) => <box key={k} height={1}><text><span fg={theme.textMuted}>{`${k.padEnd(8)} `}</span><span fg={theme.text}>{trunc(v, 72)}</span></text></box>)}
                <box height={1}><text fg={theme.textMuted}>{busyCur ? `${busyCur}…` : cur.state === "active" ? "Active" : cur.state === "installed" ? "Installed — press Use to activate" : "Press Install to save, Use to install+activate"}</text></box>
              </box>
            </> : <text fg={theme.textMuted}>Select a marketplace Eikon.</text>}
          </box>
        </TabShell>
      </box>
      <HintBar pairs={[["↑↓", "select"], [keys.print("list.activate"), "use"], ["i", "install only"], ["u", "use"], [keys.print("list.refresh"), "reload"], ["Esc", "restore sidebar"]]} />
    </box>
  )
})
