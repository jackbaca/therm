// Read-only distribution manifest viewer. Opened from openProfileMenu
// when a profile has a distribution.yaml. All data is the in-memory
// DistributionManifest produced by readDistributionManifest — no CLI
// round-trip, no RPC. Mirrors the shape of `hermes profile info <name>`
// output (main.py:8795-8834) but renders as KV rows instead of stdout.

import { useKeyboard } from "@opentui/react"
import { useTheme } from "../theme"
import { useKeys } from "../keys"
import { KVBlock } from "../ui/kv"
import { KVLink } from "../components/ui/FileLink"
import { ago } from "../ui/fmt"
import type { DialogContext } from "../ui/dialog"
import type { DistributionManifest } from "../service/hermes-profiles"
import type { Source } from "../service/hermes-home"

type Props = {
  profile: string
  d: DistributionManifest
  yaml: Source
  onClose: () => void
}

const Dialog = (props: Props) => {
  const theme = useTheme().theme
  const keys = useKeys()
  useKeyboard((key) => {
    if (keys.match("dialog.cancel", key) || keys.match("dialog.accept", key)) return props.onClose()
  })
  const d = props.d
  const req = d.env_requires.filter(e => e.required)
  const opt = d.env_requires.filter(e => !e.required)
  const link: Source = d.source
    ? { file: d.source, relative: d.source, label: d.source }
    : props.yaml
  const when = d.installed_at ? Date.parse(d.installed_at) : NaN
  return (
    <box flexDirection="column" minWidth={62} gap={1}>
      <box height={1}>
        <text fg={theme.primary}>
          <strong>{`Distribution · ${props.profile}`}</strong>
        </text>
      </box>
      <box flexDirection="column">
        <KVBlock rows={[
          ["Name",     d.name],
          ["Version",  `v${d.version}`],
          ["Requires", d.hermes_requires ? `Hermes ${d.hermes_requires}` : undefined],
          ["Author",   d.author || undefined],
          ["License",  d.license || undefined],
          ["Description", d.description || undefined],
        ]} />
        <KVLink label="Source" source={link} text={d.source || props.yaml.label} />
        <KVBlock rows={[
          ["Installed", Number.isFinite(when) ? ago(when / 1000) : undefined],
          ["Owned",    d.distribution_owned.length ? d.distribution_owned.join(", ") : undefined],
        ]} />
      </box>
      {d.env_requires.length ? (
        <box flexDirection="column">
          <box height={1}>
            <text fg={theme.info}>
              <strong>Environment variables</strong>
            </text>
          </box>
          {req.length ? (
            <>
              <box height={1}><text fg={theme.textMuted}>Required</text></box>
              {req.map(e => <EnvRow key={e.name} name={e.name} desc={e.description} fallback={e.default} />)}
            </>
          ) : null}
          {opt.length ? (
            <>
              <box height={1}><text fg={theme.textMuted}>Optional</text></box>
              {opt.map(e => <EnvRow key={e.name} name={e.name} desc={e.description} fallback={e.default} />)}
            </>
          ) : null}
        </box>
      ) : null}
      <box height={1}>
        <text fg={theme.borderSubtle}>
          {`[${keys.print("dialog.cancel")}] close`}
        </text>
      </box>
    </box>
  )
}

const EnvRow = (props: { name: string; desc: string; fallback: string | null }) => {
  const theme = useTheme().theme
  const tail = [
    props.desc,
    props.fallback ? `default: ${props.fallback}` : "",
  ].filter(Boolean).join("  ·  ")
  return (
    <box flexDirection="row" minHeight={1}>
      <box width={2} flexShrink={0}><text fg={theme.textMuted}>  </text></box>
      <box width={22} flexShrink={0}><text fg={theme.accent}>{props.name}</text></box>
      <box flexGrow={1} minWidth={0}>
        <text fg={theme.textMuted} wrapMode="word">{tail}</text>
      </box>
    </box>
  )
}

export function openDistributionInfo(
  dialog: DialogContext,
  opts: { profile: string; d: DistributionManifest; yaml: Source },
) {
  dialog.replace(
    <Dialog profile={opts.profile} d={opts.d} yaml={opts.yaml}
      onClose={() => dialog.clear()} />,
  )
}
