import { memo, useCallback, useEffect, useState, type ReactNode } from "react"
import { SubTabBar } from "../components/tabs/SubTabBar"
import { SUB_TABS, EIKON_TAB } from "../app/tabs"
import { useKeys } from "../keys"
import { EikonStudio } from "./EikonStudio"
import { EikonGallery } from "./EikonGallery"

type Props = {
  focused?: boolean
  sub: number
  setSub: (i: number) => void
}

// Studio is the landing sub-tab; Gallery lists installed + bundled and
// can hand a name back to Studio for editing. A third "Advanced"
// sub-tab (rasterizer setup) is reserved — see tabs.ts.
export const EikonGroup = memo((props: Props) => {
  const keys = useKeys()
  const labels = SUB_TABS[EIKON_TAB]!
  const [target, setTarget] = useState<string | undefined>(undefined)
  useEffect(() => { if (props.sub >= labels.length) props.setSub(0) }, [props.sub, labels.length])
  const edit = useCallback((name: string) => { setTarget(name); props.setSub(0) }, [props])
  const hint = `${keys.print("tab.prev")}/${keys.print("tab.next")} group  ·  shift+←/→ sub`
  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
      <SubTabBar tabs={labels} active={props.sub} onChange={props.setSub} hint={hint} />
      <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">
        <Pane visible={props.sub === 0}>
          <EikonStudio focused={!!props.focused && props.sub === 0} name={target} />
        </Pane>
        <Pane visible={props.sub === 1}>
          <EikonGallery focused={!!props.focused && props.sub === 1} onEdit={edit} />
        </Pane>
      </box>
    </box>
  )
})

const Pane = ({ visible, children }: { visible: boolean; children: ReactNode }) =>
  visible ? <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column">{children}</box> : null
