// Active Hermes skin — branding strings surfaced to UI.
// The gateway emits skin.changed with the full skin payload;
// app.tsx reduces it into this context. Consumers read agentName
// (message headers, announcements) and the raw branding map for
// future needs (prompt_symbol, welcome, etc.).

import { createContext, useContext, memo, type ReactNode } from "react"
import type { GatewaySkin } from "../context/wire"

/** Hermes built-in skin ids (hermes_cli/skin_engine.py::_BUILTIN_SKINS). */
export const SKINS = [
  "default", "ares", "mono", "slate", "daylight",
  "warm-lightmode", "poseidon", "sisyphus", "charizard",
] as const

export type SkinState = {
  skin?: GatewaySkin
  /** Preferred display label for the assistant in chat. */
  agentName: string
}

const DEFAULT: SkinState = { agentName: "Hermes" }

const Ctx = createContext<SkinState>(DEFAULT)

export function deriveSkin(skin?: GatewaySkin | null): SkinState {
  const name = skin?.branding?.agent_name?.trim()
  return { skin: skin ?? undefined, agentName: name || "Hermes" }
}

export const SkinProvider = memo(({ value, children }: { value: SkinState; children: ReactNode }) => (
  <Ctx.Provider value={value}>{children}</Ctx.Provider>
))

export function useSkin(): SkinState {
  return useContext(Ctx)
}
