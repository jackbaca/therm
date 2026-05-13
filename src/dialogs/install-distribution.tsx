// Install a profile distribution — source prompt → preview clone → confirm.
//
// Flow:
//   1. TextPrompt (URL, git@…, github.com/owner/repo, or local directory).
//   2. Clone --depth 1 into /tmp/herm-dist-preview-<nonce> and parse the
//      manifest with readDistributionManifest() so the confirm shows real
//      name/version/author/env_requires up front. The ORIGINAL source is
//      the one we pass to `hermes profile install` so the manifest's
//      `source:` field records the remote — without this step `update`
//      later would try to re-pull from the already-gone temp dir.
//   3. Confirm dialog with optional --name override + --alias checkbox.
//      On confirm → shell.exec `hermes profile install <src> -y [flags]`.
//
// Cleanup: /tmp/herm-dist-preview-<nonce> is rm -rf'd in finally so
// abandonment at any step doesn't leak.
//
// Non-scope per card: env-var resolution (we just tell the user which
// vars are needed); file picker widget; resumable installs.

import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import { rmSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { useTheme } from "../theme"
import { useKeys } from "../keys"
import type { Gateway } from "../context/gateway"
import type { DialogContext } from "../ui/dialog"
import { readDistributionManifest, type DistributionManifest } from "../service/hermes-profiles"
import { Spinner } from "../ui/spinner"

type ShellResult = { stdout: string; stderr: string; code: number }

export type InstallResult = {
  source: string
  manifest: DistributionManifest
  name: string | null
  alias: boolean
}

// Quote for shell=True (gateway's shell.exec). Single-quotes around the
// value, any embedded single-quote closes, escapes, re-opens. Belt-and-
// suspenders vs user paste of URLs or paths containing spaces / shell
// metacharacters — the ground truth is that shell.exec runs with
// shell=True so every argv position is a single shell word.
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

export function openInstallDistribution(
  dialog: DialogContext,
  gw: Gateway,
): Promise<InstallResult | null> {
  return new Promise((resolve) => {
    const done = (r: InstallResult | null) => { dialog.clear(); resolve(r) }
    askSource(dialog, gw, done)
  })
}

function askSource(dialog: DialogContext, gw: Gateway, done: (r: InstallResult | null) => void) {
  dialog.replace(
    <Step1
      onSubmit={(source) => preview(dialog, gw, source, done)}
      onCancel={() => done(null)}
    />,
  )
}

async function preview(
  dialog: DialogContext,
  gw: Gateway,
  source: string,
  done: (r: InstallResult | null) => void,
) {
  const tmp = mkdtempSync(join(tmpdir(), "herm-dist-preview-"))
  const cleanup = () => { try { rmSync(tmp, { recursive: true, force: true }) } catch {} }
  // Cancelled by the user while the clone is in flight — we honour it on
  // return from shell.exec so an abandoned clone never resurrects the
  // dialog. Set from Loading's own Esc handler.
  const state = { cancelled: false }
  const cancel = () => { state.cancelled = true; cleanup(); done(null) }

  dialog.replace(<Loading label={`Cloning ${source}…`} onCancel={cancel} />, undefined, { ownCancel: true })

  // --depth 1 for speed; redirect stderr so progress noise doesn't drown
  // the actual error when one surfaces. shell.exec is capped at 30s —
  // big distributions are expected to be lean (skills + SOUL + cron).
  const cmd = `git clone --depth 1 --quiet ${shq(source)} ${shq(tmp)} 2>&1`
  const r = await gw.request<ShellResult>("shell.exec", { command: cmd })
    .catch((e: Error) => ({ stdout: "", stderr: e.message, code: -1 } satisfies ShellResult))

  if (state.cancelled) return

  if (r.code !== 0) {
    cleanup()
    dialog.replace(
      <ErrorBox
        title="Clone failed"
        body={(r.stderr || r.stdout || `exit ${r.code}`).trim()}
        onClose={() => done(null)}
      />,
    )
    return
  }

  const manifest = readDistributionManifest(tmp)
  if (!manifest) {
    cleanup()
    dialog.replace(
      <ErrorBox
        title="Not a distribution"
        body={`No valid distribution.yaml at the root of ${source}. A manifest must declare at minimum a 'name:' key.`}
        onClose={() => done(null)}
      />,
    )
    return
  }

  // Pass ORIGINAL source to install so the persisted manifest's source:
  // points at the remote, not the temp dir we just staged.
  dialog.replace(
    <ConfirmStep
      source={source}
      manifest={manifest}
      onConfirm={(r) => { cleanup(); done(r) }}
      onCancel={() => { cleanup(); done(null) }}
    />,
    undefined,
    { ownCancel: true },
  )
}

const Step1 = (p: { onSubmit: (source: string) => void; onCancel: () => void }) => {
  const theme = useTheme().theme
  const [value, setValue] = useState("")
  useKeyboard((key) => {
    if (key.name === "escape") return p.onCancel()
  })
  return (
    <box flexDirection="column" width={64}>
      <box height={1}><text fg={theme.primary}><strong>Install Distribution</strong></text></box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>Source — git URL, github.com/owner/repo, or local directory</text></box>
      <box height={1} flexDirection="row" overflow="hidden">
        <box flexShrink={0}><text fg={theme.accent}>{"┃ "}</text></box>
        <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
          <input
            value={value}
            onInput={setValue}
            onSubmit={() => { const v = value.trim(); if (v) p.onSubmit(v) }}
            focused
            textColor={theme.text}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
          />
        </box>
      </box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        {value.trim() ? "Enter preview  ·  Esc cancel" : "Esc cancel"}
      </text></box>
    </box>
  )
}

const Loading = (p: { label: string; onCancel: () => void }) => {
  const theme = useTheme().theme
  useKeyboard((key) => {
    if (key.name === "escape") return p.onCancel()
  })
  return (
    <box flexDirection="column" width={54}>
      <box height={1}><text fg={theme.primary}><strong>Install Distribution</strong></text></box>
      <box height={1} />
      <box height={1}><Spinner color={theme.accent} label={p.label} /></box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>Esc to cancel</text></box>
    </box>
  )
}

const ErrorBox = (p: { title: string; body: string; onClose: () => void }) => {
  const theme = useTheme().theme
  const keys = useKeys()
  useKeyboard((key) => {
    if (keys.match("dialog.accept", key) || keys.match("dialog.cancel", key)) return p.onClose()
  })
  return (
    <box flexDirection="column" width={68}>
      <box height={1}><text fg={theme.error}><strong>{p.title}</strong></text></box>
      <box height={1} />
      <box minHeight={1}><text wrapMode="word" fg={theme.text}>{p.body}</text></box>
      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>Enter / Esc to close</text></box>
    </box>
  )
}

type Field = "name" | "alias"
const ORDER: readonly Field[] = ["name", "alias"] as const

export const ConfirmStep = (p: {
  source: string
  manifest: DistributionManifest
  onConfirm: (r: InstallResult) => void
  onCancel: () => void
}) => {
  const theme = useTheme().theme
  const keys = useKeys()
  // Form dialog: Tab/Shift+Tab walks fields, Space toggles focused checkbox,
  // Enter accepts, Esc cancels. No 'y'/'n' mnemonics here — those are
  // reserved for openConfirm per nav spec.
  const [name, setName] = useState("")
  const [alias, setAlias] = useState(false)
  const [field, setField] = useState<Field>("name")

  const fire = () => p.onConfirm({
    source: p.source,
    manifest: p.manifest,
    name: name.trim() || null,
    alias,
  })

  const move = (dir: 1 | -1) => {
    const i = ORDER.indexOf(field)
    setField(ORDER[(i + dir + ORDER.length) % ORDER.length])
  }

  useKeyboard((key) => {
    if (key.name === "escape") return p.onCancel()
    if (key.name === "tab") return move(key.shift ? -1 : 1)
    // Enter submits from non-name fields; on name the <input> onSubmit
    // fires the same path, so avoid double-firing by gating here.
    if (field !== "name" && keys.match("dialog.accept", key)) return fire()
    if (field === "alias" && (key.name === "space" || key.name === " ")) return setAlias(a => !a)
  })

  const m = p.manifest
  const reqEnv = m.env_requires.filter(e => e.required)
  const optEnv = m.env_requires.filter(e => !e.required)
  const focusBg = (f: Field) => field === f ? theme.backgroundElement : undefined
  return (
    <box flexDirection="column" width={72}>
      <box height={1}><text fg={theme.primary}><strong>Install Distribution</strong></text></box>
      <box height={1} />
      <KV label="Name"     value={`${m.name}${m.version ? ` v${m.version}` : ""}`} theme={theme} />
      {m.description ? <KV label="About"    value={m.description} theme={theme} wrap /> : null}
      {m.author      ? <KV label="Author"   value={m.author}      theme={theme} /> : null}
      {m.license     ? <KV label="License"  value={m.license}     theme={theme} /> : null}
      {m.hermes_requires
        ? <KV label="Requires" value={`hermes ${m.hermes_requires}`} theme={theme} />
        : null}
      <KV label="Source"   value={p.source} theme={theme} />
      {m.distribution_owned.length > 0
        ? <KV label="Owns"    value={m.distribution_owned.join(", ")} theme={theme} wrap />
        : null}
      {m.env_requires.length > 0
        ? <KV label="Env"     value={envSummary(reqEnv, optEnv)} theme={theme} />
        : null}
      <box height={1} />

      {/* --name override */}
      <box height={1} flexDirection="row" backgroundColor={focusBg("name")}>
        <box width={11}><text fg={theme.textMuted}>Name as</text></box>
        <box flexGrow={1} minWidth={0} height={1} overflow="hidden">
          {field === "name" ? (
            <input
              value={name}
              onInput={setName}
              onSubmit={fire}
              focused
              textColor={theme.text}
              backgroundColor={theme.backgroundElement}
              focusedBackgroundColor={theme.backgroundElement}
            />
          ) : (
            <text fg={name ? theme.text : theme.textMuted}>
              {name || `(${m.name})`}
            </text>
          )}
        </box>
      </box>

      {/* --alias */}
      <box height={1} flexDirection="row" backgroundColor={focusBg("alias")}>
        <box width={11}><text fg={theme.textMuted}>Alias</text></box>
        <text fg={alias ? theme.accent : theme.textMuted}>
          {alias ? "[x] create shell wrapper" : "[ ] create shell wrapper"}
        </text>
      </box>

      <box height={1} />
      <box height={1}><text fg={theme.textMuted}>
        Enter install  ·  Tab next field  ·  Space toggle  ·  Esc cancel
      </text></box>
    </box>
  )
}

const KV = (p: { label: string; value: string; theme: ReturnType<typeof useTheme>["theme"]; wrap?: boolean }) => (
  <box flexDirection="row" minHeight={1}>
    <box width={11} flexShrink={0}><text fg={p.theme.textMuted}>{p.label}</text></box>
    <box flexGrow={1} minWidth={0}>
      <text fg={p.theme.text} wrapMode={p.wrap ? "word" : "none"}>{p.value}</text>
    </box>
  </box>
)

function envSummary(req: { name: string }[], opt: { name: string }[]): string {
  return [
    req.length > 0 ? `${req.length} required (${req.map(e => e.name).join(", ")})` : "",
    opt.length > 0 ? `${opt.length} optional` : "",
  ].filter(Boolean).join(" · ")
}
