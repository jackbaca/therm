import type { HermPlugin } from "./types"
import clock from "./bundled/clock"
import files from "./bundled/files"
import eikonStudio from "./bundled/eikon-studio"

export const INTERNAL: ReadonlyArray<HermPlugin> = [
  clock,
  files,
  eikonStudio,
]
