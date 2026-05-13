// `{!cmd}` inline shell interpolation in user prompts. Each span
// is executed via the gateway's `shell.exec` RPC (not local spawn)
// so it honors `terminal.backend` — a `{!ls}` in a docker/ssh-backed
// session runs inside that environment, same as the agent's own
// terminal tool. Stdout+stderr are trimmed and spliced in place;
// a failed/timed-out command substitutes `(error)`.

import type { Gateway } from "../context/gateway"

export const INTERP_RE = /\{!(.+?)\}/g

export const hasInterp = (s: string) => /\{!.+?\}/.test(s)

type Sh = { stdout?: string; stderr?: string; code?: number }

export async function interpolate(gw: Gateway, text: string): Promise<string> {
  const hits = [...text.matchAll(INTERP_RE)]
  if (hits.length === 0) return text
  const outs = await Promise.all(hits.map(m =>
    gw.request<Sh>("shell.exec", { command: m[1] })
      .then(r => [r.stdout, r.stderr].filter(Boolean).join("\n").trim())
      .catch(() => "(error)"),
  ))
  // Splice back-to-front so earlier match indices stay valid.
  let out = text
  for (let i = hits.length - 1; i >= 0; i--) {
    const m = hits[i]
    out = out.slice(0, m.index) + outs[i] + out.slice(m.index + m[0].length)
  }
  return out
}
