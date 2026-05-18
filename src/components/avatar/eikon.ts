// Shim over the `eikon` package so existing herm imports keep their
// names while the format logic lives upstream. Herm-specific shapes
// (EikonMeta.states) are preserved for AnimatedAvatar/Gallery.

import { parse, list as scan, type Eikon, type Clip, type Meta } from "eikon"

export type EikonMeta = Meta
export type EikonState = Clip
export type ParsedEikon = { meta: EikonMeta; states: Map<string, EikonState> }

export function parseEikon(text: string): ParsedEikon {
  const e = parse(text)
  return { meta: e.meta, states: e.clips }
}

export function listEikons(dirs: string[]): { path: string; meta: EikonMeta }[] {
  return scan(dirs)
}

export type { Eikon }
