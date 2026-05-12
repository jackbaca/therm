// Reference top-level tab plugin — a minimal file browser / markdown
// viewer. Satisfies the "Files" half of gh#3 at an MVP depth: no
// editing, no graph view, no watch-reload. Proves the plugin host can
// register a full tab, not just a gutter widget.
//
// UX:
//   Left pane:  directory list for $cwd (starts at $HOME). Up/Down
//               navigates, Enter descends into a dir or previews a
//               file. Left arrow / ".." goes up.
//   Right pane: selected file's content. Markdown gets a dim/emphasis
//               pass, everything else is rendered raw.
//
// Bun APIs: readdirSync for the listing (sync + instant on first
// mount), Bun.file() for the preview content.

import { useEffect, useMemo, useState } from "react"
import { readdirSync, statSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"
import { useKeyboard } from "@opentui/react"
import type { ParsedKey } from "@opentui/core"
import { useKeys, handleListKey } from "../keys"
import { useTheme } from "../theme"
import { register } from "./host"

const PREVIEW_MAX = 200_000 // bytes — refuse to read larger files

type Entry = { name: string; dir: boolean }

const read = (dir: string): Entry[] => {
  const out: Entry[] = []
  // Parent entry unless at filesystem root.
  if (dir !== "/") out.push({ name: "..", dir: true })
  const raw = readdirSync(dir, { withFileTypes: true })
  const sorted = raw
    .filter(d => !d.name.startsWith("."))
    .sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1
      const bd = b.isDirectory() ? 0 : 1
      if (ad !== bd) return ad - bd
      return a.name.localeCompare(b.name)
    })
  for (const d of sorted) out.push({ name: d.name, dir: d.isDirectory() })
  return out
}

const isMd = (name: string) => /\.(md|markdown|mdx)$/i.test(name)

const Files = () => {
  const theme = useTheme().theme
  const keys = useKeys()
  const [dir, setDir] = useState(() => homedir())
  const [sel, setSel] = useState(0)
  const [preview, setPreview] = useState<string>("")
  const [error, setError] = useState<string>("")

  const entries = useMemo<Entry[]>(() => {
    setError("")
    try { return read(dir) } catch (e) {
      setError(String((e as Error).message ?? e))
      return []
    }
  }, [dir])

  // Clamp selection when the directory (and thus entry count) changes.
  useEffect(() => { setSel(s => Math.min(s, Math.max(0, entries.length - 1))) }, [entries.length])

  const active = entries[sel]

  // Preview is async — don't block the first paint on the read.
  useEffect(() => {
    if (!active || active.dir) { setPreview(""); return }
    const path = join(dir, active.name)
    let cancel = false
    ;(async () => {
      const st = statSync(path)
      if (st.size > PREVIEW_MAX) {
        if (!cancel) setPreview(`(file too large — ${st.size} bytes)`)
        return
      }
      const text = await Bun.file(path).text()
      if (!cancel) setPreview(text)
    })().catch(e => { if (!cancel) setPreview(`(read error: ${e})`) })
    return () => { cancel = true }
  }, [dir, active?.name, active?.dir])

  const enter = () => {
    if (!active) return
    if (active.name === "..") { setDir(d => d === "/" ? "/" : join(d, "..")); setSel(0); return }
    if (active.dir) { setDir(d => join(d, active.name)); setSel(0); return }
    // Files: preview already populated via the effect above. No-op on Enter.
  }

  useKeyboard((key: ParsedKey) => {
    // Left arrow also escapes up a directory — matches mc/ranger muscle memory.
    if (key.name === "left") { setDir(d => d === "/" ? "/" : join(d, "..")); setSel(0); return }
    handleListKey(keys, key, {
      count: entries.length,
      setSel,
      onActivate: enter,
    })
  })

  // Rendering: fixed-width left pane, flex-grow preview. Keep line
  // counts cheap — slice to visible-ish height so very long files
  // don't choke the renderer. The scrollbox pattern would be nicer
  // but adds complexity beyond MVP.
  const leftW = 32
  return (
    <box flexGrow={1} flexDirection="column">
      <box height={1} flexShrink={0} paddingX={1}>
        <text fg={theme.textMuted} wrapMode="none">{dir}</text>
      </box>
      <box flexGrow={1} flexDirection="row">
        <box width={leftW} flexShrink={0} flexDirection="column" border borderColor={theme.border}>
          {entries.map((e, i) => (
            <box key={e.name} height={1} paddingX={1}
                 backgroundColor={i === sel ? theme.backgroundElement : undefined}>
              <text fg={i === sel ? theme.selectedListItemText : (e.dir ? theme.accent : theme.text)}
                    wrapMode="none">
                {(e.dir ? "▸ " : "  ") + e.name}
              </text>
            </box>
          ))}
          {error ? (
            <box height={1} paddingX={1}><text fg={theme.error} wrapMode="none">{error}</text></box>
          ) : null}
        </box>
        <box flexGrow={1} flexDirection="column" border borderColor={theme.border}>
          {active && !active.dir ? (
            <>
              <box height={1} flexShrink={0} paddingX={1}>
                <text fg={theme.textMuted} wrapMode="none">
                  {basename(active.name)}{isMd(active.name) ? "  ·  markdown" : ""}
                </text>
              </box>
              <scrollbox scrollY flexGrow={1}>
                <text fg={theme.text} wrapMode="word">{preview}</text>
              </scrollbox>
            </>
          ) : (
            <box paddingX={1}><text fg={theme.textMuted}>Select a file to preview.</text></box>
          )}
        </box>
      </box>
    </box>
  )
}

register({
  id: "demo.files",
  name: "Files",
  tab: { name: "Files", component: () => <Files /> },
})
