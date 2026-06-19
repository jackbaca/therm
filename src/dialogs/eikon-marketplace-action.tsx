import { useState } from "react"
import { useTheme } from "../theme"
import type { DialogContext } from "../ui/dialog"
import type { MarketplaceRow, MarketplaceSizes } from "../service/eikon-marketplace"

type Choice = "install" | "source" | "use" | "download" | "delete" | "delist"
type Opt = { label: string; hint?: string; value: Choice }

type Props = {
  row: MarketplaceRow
  sizes?: MarketplaceSizes
  onPick: (choice: Choice) => void
}

const fmt = (n?: number) => n == null ? "size unknown" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 / 1024).toFixed(1)} MiB`

const choices = (row: MarketplaceRow, sizes?: MarketplaceSizes): Opt[] => {
  if (row.installState === "incompatible" || row.installState === "mismatch") return [
    { label: "Delist from Registry", value: "delist" },
  ]
  if (!row.installed) return [
    { label: "Eikon only", hint: fmt(sizes?.eikon), value: "install" },
    { label: "Eikon + Source", hint: `${fmt((sizes?.eikon ?? 0) + (sizes?.source ?? 0))} · Source files needed to edit Eikon in Studio`, value: "source" },
    { label: "Delist from Registry", value: "delist" },
  ]
  return [
    ...(!row.active ? [{ label: "Use", hint: "set as active avatar", value: "use" as const }] : []),
    ...(row.sourceDownloadable ? [{ label: "Download Source", hint: "needed to edit in Studio", value: "download" as const }] : []),
    ...(row.removable ? [{ label: "Uninstall", value: "delete" as const }] : []),
    { label: "Delist from Registry", value: "delist" as const },
  ]
}

const Action = (props: Props) => {
  const theme = useTheme().theme
  const opts = choices(props.row, props.sizes)
  const [sel, setSel] = useState(0)
  const desc = opts.some(o => !!o.hint)
  return (
    <box flexDirection="column" width={64}>
      <text fg={theme.text}><strong>{props.row.entry.name}</strong></text>
      <box height={1} />
      <text fg={theme.textMuted} wrapMode="word">{props.row.entry.description ?? "No description."}</text>
      <box height={1} />
      {opts.length > 0 ? (
        <select
          focused={true}
          width={62}
          height={Math.min(12, Math.max(1, opts.length * (desc ? 2 : 1)))}
          options={opts.map(o => ({ name: o.label, description: o.hint ?? "", value: o.value }))}
          selectedIndex={Math.min(sel, opts.length - 1)}
          showDescription={desc}
          showScrollIndicator={opts.length > 6}
          backgroundColor={theme.backgroundPanel}
          focusedBackgroundColor={theme.backgroundPanel}
          textColor={theme.textMuted}
          focusedTextColor={theme.text}
          selectedBackgroundColor={theme.backgroundElement}
          selectedTextColor={theme.text}
          descriptionColor={theme.textMuted}
          selectedDescriptionColor={theme.textMuted}
          keyBindings={[
            { name: "home", action: "move-up-fast" },
            { name: "end", action: "move-down-fast" },
            { name: "space", action: "select-current" },
            { name: " ", action: "select-current" },
            { name: "return", action: "select-current" },
          ]}
          onChange={i => setSel(i)}
          onSelect={i => {
            const opt = opts[i]
            if (opt) props.onPick(opt.value)
          }}
        />
      ) : (
        <text fg={theme.textMuted}>{props.row.reason ?? "No available actions."}</text>
      )}
      <box height={1} />
      <text fg={theme.textMuted}>[↑↓] move   [Space/Enter] confirm   [Esc] cancel</text>
    </box>
  )
}

export function openEikonMarketplaceAction(dialog: DialogContext, opts: { row: MarketplaceRow; sizes?: MarketplaceSizes }): Promise<Choice | null> {
  return new Promise(resolve => {
    const done = (v: Choice | null) => { resolve(v); dialog.clear() }
    dialog.replace(<Action {...opts} onPick={done} />, () => resolve(null))
  })
}
