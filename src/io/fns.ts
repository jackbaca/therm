// Registry of every state.db reader herm calls from React. Import
// surface is the three leaf sqlite modules — no hermes-home / yaml /
// tokens — so the worker bundle stays ~15 KB.

import { sdb } from "../service/sessions-db"
import { analytics } from "../service/hermes-analytics"
import { readMemoryActivity } from "../service/memory-activity"

export const FNS = {
  roots: sdb.roots,
  children: sdb.children,
  lineage: sdb.lineage,
  peek: sdb.peek,
  search: sdb.search,
  systemPrompt: sdb.systemPrompt,
  goalState: sdb.goalState,
  analytics,
  memoryActivity: readMemoryActivity,
} as const

export type Fns = typeof FNS
export type Fn = keyof Fns
