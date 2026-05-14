// Shared session store. The tab body and the sidebar_avatar slot are
// separate React subtrees (route render vs. slot render) but both need
// to read the same editing session and re-render on change. A plain
// module-level cell + useSyncExternalStore keeps them in sync without
// the plugin re-registering its slot on every knob tick.

import { useSyncExternalStore } from "react"
import type { ParsedEikon } from "../../../components/avatar/eikon"
import type { Session } from "./knobs"

export type Mode = "off" | "watching" | "editing"

export type Snap = {
  mode: Mode
  /** The ParsedEikon currently filling the avatar slot (built or file-loaded). */
  doc?: ParsedEikon
  /** Editing session — present only in `editing`. */
  sess?: Session
}

let snap: Snap = { mode: "off" }
const subs = new Set<() => void>()

export const get = () => snap
export const set = (s: Snap) => { snap = s; for (const f of subs) f() }
export const patch = (p: Partial<Snap>) => set({ ...snap, ...p })
export const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

export const useStore = () => useSyncExternalStore(sub, get, get)
