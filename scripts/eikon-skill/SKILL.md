---
name: eikon
description: Turn user images into a herm sidebar avatar (eikon) with live preview.
---

# Building an eikon in herm

You're guiding the user through turning one or more images into a `.eikon`
avatar that plays live in herm's 48×24 sidebar. The output is monochrome
braille in a single theme color, so **silhouette beats detail.**

## Before anything

Enable the studio plugin so previews land in the sidebar:

```bash
terminal: curl -s -X POST localhost:${CONTROL_PORT:-7777}/plugin/herm.eikon-studio -H 'content-type: application/json' -d '{"on":true}' || true
```

If CONTROL isn't running, tell the user to enable the plugin via the
command palette (Ctrl+K → "Eikon") or restart with `CONTROL=1`.

## One-line brief (tell the user once, don't repeat)

"48×24, one color. Best results: high-contrast subject on a plain light
background, roughly square crop, centered."

## Flow

1. **Ask for an image.** The user can paste (Alt+V) or give a path. Pasted
   images land under `~/.hermes/pastes/`. Accept png/jpg/webp/gif/bmp.

2. **Preview it.** Run the preview script:

   ```bash
   terminal: bash ~/.hermes/skills/creative/eikon/scripts/preview.sh "<path>"
   ```

   This writes `~/.hermes/herm/eikon-wip.eikon` with a `studio` header.
   The plugin picks it up on the next `tool.complete`, enters editing
   mode, and **navigates herm to the Eikon tab** — the user sees a
   full-screen editor (preview + knob list + six-state strip) while the
   sidebar avatar also mirrors the WIP. Include the poster inline in
   chat too in case the terminal is narrow.

3. **Iterate.** Tell the user: "Eikon tab is open — `j/k` pick a knob,
   `h/l` or arrows adjust, `tab` cycles state, `Enter` commits, `b`
   bakes. Or tell me what to change." You can also re-run preview.sh
   with `--no-invert` / `--symbols block`; each run rewrites the WIP and
   the tab follows.

4. **Per-state images (optional).** If the user wants distinct states, ask
   for up to 5 more images and run with `--state <name>`:

   ```bash
   terminal: bash ~/.hermes/skills/creative/eikon/scripts/preview.sh "<path>" --state thinking
   ```

   The script merges into the existing WIP, overwriting only that state.

5. **Bake.** When they're happy, ask for a name. For the glyph, **offer to
   pick one** that fits the silhouette (single emoji or unicode char), and
   use theirs if they specify. Then:

   ```bash
   terminal: bash ~/.hermes/skills/creative/eikon/scripts/preview.sh --bake <name> --glyph "<char>" --author "<user>"
   ```

   Writes `~/.hermes/eikons/<name>.eikon`, clears the WIP. The sidebar
   reverts to the real avatar; tell the user `/eikon` will now list it.

6. **Offer publish.** `eikon publish ~/.hermes/eikons/<name>.eikon` (from
   the eikon repo's CLI) opens a PR to the catalog.

## Don'ts

- Don't lecture about contrast more than once.
- Don't guess image paths — wait for the user to paste or type one.
- Don't bake without asking for a name and glyph.
