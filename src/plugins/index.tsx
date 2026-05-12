// Plugin loader + shell-side gutter component.
//
// MVP: bundled plugins only. Each module is imported for its
// side-effectful `register()` call. To add a plugin, drop a file in
// ./plugins and import it below.
//
// The gutter row is a fixed 1-cell height at the very bottom of the
// shell. We pick the first plugin whose `gutter()` returns non-null;
// multi-slot composition (left/center/right) is a follow-up.

import { memo } from "react"
import { useTheme } from "../theme"
import { list, type GutterProps } from "./host"

import "./clock"
import "./files"

type Props = Omit<GutterProps, "theme">

export const Gutter = memo((p: Props) => {
  const theme = useTheme().theme
  const props: GutterProps = { theme, ...p }
  const node = list()
    .map(pl => pl.gutter?.(props))
    .find(n => n != null && n !== false)
  if (!node) return null
  return (
    <box height={1} flexShrink={0} paddingX={1} overflow="hidden">
      {node}
    </box>
  )
})

export { list, register, tabs, _reset } from "./host"
export type { Plugin, GutterProps, TabDef } from "./host"
