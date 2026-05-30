const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : []
const str = (v: unknown): string => typeof v === "string" ? v : ""
const num = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0

export type DispatchSpawned = { task_id: string; assignee: string; workspace: string }
export type DispatchCapped = { task_id: string; assignee: string; current: number }
export type DispatchGuarded = { task_id: string; reason: string }

export type DispatchResult = {
  reclaimed: number
  promoted: number
  spawned: DispatchSpawned[]
  skipped_unassigned: string[]
  skipped_nonspawnable: string[]
  skipped_per_profile_capped: DispatchCapped[]
  auto_assigned_default: string[]
  crashed: string[]
  auto_blocked: string[]
  timed_out: string[]
  stale: string[]
  respawn_guarded: DispatchGuarded[]
}

const ids = (v: unknown): string[] => arr(v).map(str).filter(Boolean)

const spawned = (v: unknown): DispatchSpawned[] => arr(v).flatMap(x => {
  if (!x || typeof x !== "object") return []
  const r = x as Record<string, unknown>
  const task_id = str(r.task_id)
  if (!task_id) return []
  return [{ task_id, assignee: str(r.assignee), workspace: str(r.workspace) }]
})

const capped = (v: unknown): DispatchCapped[] => arr(v).flatMap(x => {
  if (!x || typeof x !== "object") return []
  const r = x as Record<string, unknown>
  const task_id = str(r.task_id)
  if (!task_id) return []
  return [{ task_id, assignee: str(r.assignee), current: num(r.current) }]
})

const guarded = (v: unknown): DispatchGuarded[] => arr(v).flatMap(x => {
  if (Array.isArray(x)) {
    const task_id = str(x[0])
    if (!task_id) return []
    return [{ task_id, reason: str(x[1]) }]
  }
  if (!x || typeof x !== "object") return []
  const r = x as Record<string, unknown>
  const task_id = str(r.task_id)
  if (!task_id) return []
  return [{ task_id, reason: str(r.reason) }]
})

export const parseDispatchResult = (out: string): DispatchResult => {
  const raw = JSON.parse(out) as Record<string, unknown>
  return {
    reclaimed: num(raw.reclaimed),
    promoted: num(raw.promoted),
    spawned: spawned(raw.spawned),
    skipped_unassigned: ids(raw.skipped_unassigned),
    skipped_nonspawnable: ids(raw.skipped_nonspawnable),
    skipped_per_profile_capped: capped(raw.skipped_per_profile_capped),
    auto_assigned_default: ids(raw.auto_assigned_default),
    crashed: ids(raw.crashed),
    auto_blocked: ids(raw.auto_blocked),
    timed_out: ids(raw.timed_out),
    stale: ids(raw.stale),
    respawn_guarded: guarded(raw.respawn_guarded),
  }
}

export const dispatchFailures = (r: DispatchResult): string[] => [
  ...r.crashed,
  ...r.auto_blocked,
  ...r.timed_out,
  ...r.stale,
  ...r.skipped_unassigned,
  ...r.respawn_guarded.map(x => x.task_id),
]
