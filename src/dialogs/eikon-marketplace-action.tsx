import { useKeyboard } from "@opentui/react"
import { useKeys } from "../keys"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import type { MarketplaceRow, MarketplaceSizes } from "../service/eikon-marketplace"

type Choice = "install" | "source" | "use" | "download" | "delete"
type Opt = { key: string; label: string; hint?: string; value?: Choice }

type Props = {
  row: MarketplaceRow
  sizes?: MarketplaceSizes
  onPick: (choice: Choice) => void
}

const fmt = (n?: number) => n == null ? "size unknown" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`

const choices = (row: MarketplaceRow, sizes?: MarketplaceSizes): Opt[] => {
  if (row.installState === "incompatible" || row.installState === "mismatch") return [{ key: "Esc", label: row.reason ?? row.installState, value: undefined }]
  if (!row.installed) return [
    { key: "Enter/1", label: "Eikon only", hint: fmt(sizes?.eikon), value: "install" as const },
    { key: "2", label: "Eikon + Source", hint: `${fmt((sizes?.eikon ?? 0) + (sizes?.source ?? 0))} · Source files needed to edit Eikon in Studio`, value: "source" as const },
  ]
  return [
    ...(!row.active ? [{ key: "Enter/1", label: "Use", hint: "set as active avatar", value: "use" as const }] : [{ key: "Enter/1", label: "Active", hint: "already active", value: undefined }]),
    ...(row.sourceDownloadable ? [{ key: "2", label: "Download Source", hint: "needed to edit in Studio", value: "download" as const }] : []),
    ...(row.removable ? [{ key: "D", label: "Delete", hint: "asks before removing local files", value: "delete" as const }] : []),
  ]
}

const byKey = (opts: Opt[], key: string) => opts.find(o => o.key.toLowerCase().split("/").includes(key))?.value

const Action = (props: Props) => {
  const theme = useTheme().theme
  const keys = useKeys()
  const opts = choices(props.row, props.sizes)
  useKeyboard(key => {
    const pick = (v: Choice | undefined) => { if (v) props.onPick(v) }
    if (keys.match("dialog.accept", key)) return pick(byKey(opts, "enter"))
    if (key.name === "1") return pick(byKey(opts, "1"))
    if (key.name === "2") return pick(byKey(opts, "2"))
    if (key.name === "d") return pick(byKey(opts, "d"))
  })
  return (
    <box flexDirection="column" width={64}>
      <text fg={theme.text}><strong>{props.row.entry.name}</strong></text>
      <box height={1} />
      <text fg={theme.textMuted} wrapMode="word">{props.row.entry.description ?? "No description."}</text>
      <box height={1} />
      {opts.map(o => (
        <box key={o.key} height={1} onMouseDown={() => { if (o.value) props.onPick(o.value) }}>
          <text>
            <span fg={o.value ? theme.primary : theme.textMuted}>{`[${o.key}] ${o.label}`}</span>
            {o.hint ? <span fg={theme.textMuted}>{` — ${o.hint}`}</span> : null}
          </text>
        </box>
      ))}
      <box height={1} />
      <text fg={theme.textMuted}>[Esc] cancel</text>
    </box>
  )
}

export function openEikonMarketplaceAction(dialog: DialogContext, opts: { row: MarketplaceRow; sizes?: MarketplaceSizes }): Promise<Choice | null> {
  return new Promise(resolve => {
    const done = (v: Choice | null) => { resolve(v); dialog.clear() }
    dialog.replace(<Action {...opts} onPick={done} />, () => resolve(null))
  })
}
