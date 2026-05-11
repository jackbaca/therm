// Defang markdown link syntax that OpenTUI's detect-links would turn into
// bad OSC-8 hyperlinks. The upstream linkifier (packages/core/src/lib/
// detect-links.ts) takes the raw `link_destination` / `uri_autolink` span
// from tree-sitter and emits it verbatim as the OSC-8 href, with no scheme
// check. So `[x](#anchor)`, `[x](./file)`, `<https://x>` (angle brackets
// included) and function-call-looking prose like `set[i](arg)` all become
// terminal hyperlinks that either open nothing or open garbage.
//
// We don't own the renderer internals (MarkdownRenderable hardwires its own
// onChunks handler, Markdown.ts:497), so the only lever is the source text.
// Two rewrites, applied only outside inline-code spans:
//
//   1. `[label](dest)` where `dest` lacks a terminal-openable scheme
//      → `[label]\(dest)` — the `\(` stops tree-sitter's markdown_inline
//      grammar from recognising an inline_link, so no `link_destination`
//      node is produced and detect-links never sees it. Visually identical
//      (the `\` is concealed by the same highlights.scm that would have
//      concealed the link markers).
//
//   2. `<scheme://…>` autolink → `scheme://…` — strip the angle brackets so
//      the bare URI is what ends up in the OSC-8 href instead of `<…>`.
//
// Fenced blocks are already split off by MediaChip.splitContent before this
// runs, so we only need to step over `` `…` `` inline code here. Same
// approach as mathify (math-unicode.ts:804).

const CODE_SPAN_RE = /(`{1,2})[^`\n]+?\1/g

// Terminal-openable schemes. Anything else gets its link syntax escaped.
const OPENABLE = /^(https?|file|mailto):/i

// `[label](dest)` — label is bracket-free (nested `[` would need a parser;
// not worth it for a defensive pass), dest is paren/whitespace-free per
// CommonMark inline-link rules sans the `<…>` form.
const INLINE_LINK_RE = /(\[[^\]\n]*?\])\(([^)\s]+)\)/g

// `<https://…>` / `<mailto:…>` — capture the interior, drop the brackets.
const AUTOLINK_RE = /<((?:https?|file|mailto):[^>\s]+)>/gi

function rewrite(prose: string): string {
  return prose
    .replace(AUTOLINK_RE, '$1')
    .replace(INLINE_LINK_RE, (m, label, dest) =>
      OPENABLE.test(dest) ? m : `${label}\\(${dest})`)
}

export function sanitizeLinks(md: string): string {
  // Cheap bail: no link-ish syntax at all.
  if (!/[[<]/.test(md)) return md
  let out = ''
  let i = 0
  CODE_SPAN_RE.lastIndex = 0
  for (const m of md.matchAll(CODE_SPAN_RE)) {
    out += rewrite(md.slice(i, m.index))
    out += m[0]
    i = m.index + m[0].length
  }
  out += rewrite(md.slice(i))
  return out
}
