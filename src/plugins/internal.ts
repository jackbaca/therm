import type { HermPlugin } from "./types"
import clock from "./bundled/clock"
import files from "./bundled/files"

export const INTERNAL: ReadonlyArray<HermPlugin> = [
  clock,
  files,
]
