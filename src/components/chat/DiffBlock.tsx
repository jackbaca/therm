import { memo } from "react"
import { useTheme } from "../../theme"
import { sanitize } from "../../utils/sanitize"

/** Heuristic: unified-diff output from patch/edit tools. */
export function isDiff(s: string | undefined): boolean {
  if (!s) return false
  return /^--- a\//m.test(s) || /^@@ /m.test(s) || /^diff --git /m.test(s)
}

const CAP = 80
const WORD_CAP = 40

type Seg = { text: string; hi: boolean }

const tokens = (s: string) => s.split(/(\s+)/).filter(t => t.length > 0)

/** Common-prefix/suffix word diff. Returns segments for (old, new). */
export function wordDiff(a: string, b: string): [Seg[], Seg[]] {
  const ta = tokens(a)
  const tb = tokens(b)
  let p = 0
  while (p < ta.length && p < tb.length && ta[p] === tb[p]) p++
  let s = 0
  while (s < ta.length - p && s < tb.length - p && ta[ta.length - 1 - s] === tb[tb.length - 1 - s]) s++
  const seg = (t: string[]) => {
    const mid = t.slice(p, t.length - s).join("")
    const out: Seg[] = []
    if (p) out.push({ text: t.slice(0, p).join(""), hi: false })
    if (mid) out.push({ text: mid, hi: true })
    if (s) out.push({ text: t.slice(t.length - s).join(""), hi: false })
    return out
  }
  return [seg(ta), seg(tb)]
}

/**
 * Pair runs of `-` lines immediately followed by `+` lines index-wise
 * and compute intra-line word segments. Returns null for lines that
 * stay whole-line colored. Skipped entirely above WORD_CAP.
 */
export function intraline(rows: string[]): (Seg[] | null)[] {
  const marks: (Seg[] | null)[] = rows.map(() => null)
  if (rows.length > WORD_CAP) return marks
  const del = (l: string) => l.startsWith("-") && !l.startsWith("---")
  const add = (l: string) => l.startsWith("+") && !l.startsWith("+++")
  let i = 0
  while (i < rows.length) {
    if (!del(rows[i])) { i++; continue }
    let j = i
    while (j < rows.length && del(rows[j])) j++
    let k = j
    while (k < rows.length && add(rows[k])) k++
    const n = Math.min(j - i, k - j)
    for (let d = 0; d < n; d++) {
      const [rm, ad] = wordDiff(rows[i + d].slice(1), rows[j + d].slice(1))
      marks[i + d] = rm
      marks[j + d] = ad
    }
    i = k
  }
  return marks
}

/**
 * Line-colored unified diff. OpenTUI ships a native `<diff>` renderable
 * (split/unified, line numbers), but it manages its own scroll regions
 * and height — heavy for an inline preview nested inside the chat
 * scrollbox. This block renders one `<text>` per line with theme colors
 * and a hard 80-line cap so layout stays stable. For small diffs
 * (≤40 lines) paired -/+ change lines get word-level bg highlights.
 */
export const DiffBlock = memo(({ text }: { text: string }) => {
  const theme = useTheme().theme
  const all = sanitize(text).replace(/\n$/, "").split("\n")
  const rows = all.slice(0, CAP)
  const more = all.length - rows.length
  const marks = intraline(rows)

  const fg = (l: string) =>
    l.startsWith("@@") ? theme.accent
    : l.startsWith("+++") || l.startsWith("---") ? theme.textMuted
    : l.startsWith("+") ? theme.success
    : l.startsWith("-") ? theme.error
    : theme.textMuted

  return (
    <box flexDirection="column" backgroundColor={theme.backgroundPanel}>
      {rows.map((l, i) => {
        const segs = marks[i]
        const bg = l.startsWith("+") ? theme.diffAddedBg : theme.diffRemovedBg
        return (
          <box key={i} height={1} overflow="hidden" minWidth={0}>
            <text fg={fg(l)}>
              {segs
                ? <>{l[0]}{segs.map((s, j) => s.hi
                    ? <span key={j} bg={bg}>{s.text}</span>
                    : s.text)}</>
                : l || " "}
            </text>
          </box>
        )
      })}
      {more > 0 ? (
        <box height={1}>
          <text fg={theme.textMuted}>… {more} more lines</text>
        </box>
      ) : null}
    </box>
  )
})
