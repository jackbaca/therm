import { memo, useCallback, useEffect, useState, type ReactNode } from "react"
import { SubTabBar } from "../components/tabs/SubTabBar"
import { SUB_TABS, EIKON_TAB } from "../app/tabs"
import { EikonStudio } from "./EikonStudio"
import { EikonGallery } from "./EikonGallery"
import type { SidebarPreview } from "../components/sidebar/Sidebar"

type Props = {
  focused?: boolean
  sub: number
  setSub: (i: number) => void
  sidebarPreview?: (preview?: SidebarPreview) => void
  sidebarHidden?: boolean
}

// Gallery is the landing sub-tab; it lists installed + bundled eikons and
// can hand a name to Studio for editing. A third "Advanced"
// sub-tab (rasterizer setup) is reserved — see tabs.ts.
export const EikonGroup = memo((props: Props) => {
  const labels = SUB_TABS[EIKON_TAB]!
  const [target, setTarget] = useState<string | undefined>(undefined)
  useEffect(() => { if (props.sub >= labels.length) props.setSub(0) }, [props.sub, labels.length])
  useEffect(() => { if (props.sub !== 0) props.sidebarPreview?.(undefined) }, [props.sub, props.sidebarPreview])
  const edit = useCallback((name: string) => { setTarget(name); props.setSub(1) }, [props])
  const hint = "shift+←/→ sub"
  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <SubTabBar tabs={labels} active={props.sub} onChange={props.setSub} hint={hint} />
      <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">
        <Pane visible={props.sub === 0}>
          <EikonGallery focused={!!props.focused && props.sub === 0} onEdit={edit}
            sidebarPreview={props.sidebarPreview} sidebarHidden={props.sidebarHidden} />
        </Pane>
        <Pane visible={props.sub === 1}>
          <EikonStudio focused={!!props.focused && props.sub === 1} name={target} />
        </Pane>
      </box>
    </box>
  )
})

const Pane = ({ visible, children }: { visible: boolean; children: ReactNode }) =>
  visible ? <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">{children}</box> : null
