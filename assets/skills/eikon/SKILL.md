---
name: eikon
description: Author a sidebar eikon avatar — produce/adopt a source image into ~/.hermes/eikons/<name>/, seed studio.json, then coach the user on the in-app Eikon tab controls. Filesystem is the API; no WIP files, no event polling.
---

# Eikon — author a herm sidebar avatar

## When this fires

User asks for a new avatar, to "make an eikon", to turn an image into their sidebar avatar, or references `~/.hermes/eikons/`.

## Folder contract

```
~/.hermes/eikons/<name>/
  <name>.eikon       packed NDJSON (48×24, 6 states)
  studio.json        { rasterizer, spatial:{zoom,ox,oy}, base:{}, per:{}, glyph, sources:{} }
  source/            base.png (or .jpg/.webp); optionally idle.png, error.png …
```

Herm's Eikon tab reads `studio.json` on open and re-renders from `source/`. Ctrl+S in the tab rewrites both files. The sidebar follows `eikonPath` in `~/.hermes/herm/tui.json`.

## Steps

1. **Get a source image.** User-supplied path → use as-is. Otherwise `image_generate` a square mono portrait (prompt should specify: high contrast, centered subject, plain background, 1:1). Save to a temp path.

2. **Pick a name.** Slugify what the user asked for (`lowercase, [a-z0-9-]`). Default `custom` if unclear.

3. **Adopt + seed.** One shell block:
   ```bash
   NAME=…; SRC=…
   mkdir -p ~/.hermes/eikons/$NAME/source
   cp "$SRC" ~/.hermes/eikons/$NAME/source/base.${SRC##*.}
   cat > ~/.hermes/eikons/$NAME/studio.json <<EOF
   {"rasterizer":"chafa","spatial":{"zoom":1,"ox":0.5,"oy":0.5},"base":{},"per":{},"glyph":"◆","sources":{"base":"base.${SRC##*.}"}}
   EOF
   ```

4. **Seed a starter `.eikon`** so the tab and gallery have something to show before the user's first Ctrl+S. If `chafa` + `ffmpeg` are installed:
   ```bash
   ffmpeg -hide_banner -loglevel error -i ~/.hermes/eikons/$NAME/source/base.* \
     -vf "crop=min(iw\,ih):min(iw\,ih),eq=contrast=1.0" -frames:v 1 -f image2pipe -vcodec png - \
   | chafa --size=48x24 --format=symbols --stretch --symbols=braille --colors=none --invert --preprocess off - \
   > /tmp/eikon-frame.txt
   ```
   Then write six copies as NDJSON:
   ```bash
   python3 - <<'PY'
   import json,os
   n=os.environ["NAME"]; f=open("/tmp/eikon-frame.txt").read().rstrip("\n")
   rows=(f.split("\n")+[""]*24)[:24]; data="\n".join(r.ljust(48)[:48] for r in rows)
   out=[json.dumps({"eikon":1,"name":n,"width":48,"height":24,"author":os.environ.get("USER","")})]
   for s in ["idle","listening","thinking","speaking","working","error"]:
     out+=[json.dumps({"state":s,"fps":12,"frame_count":1,"loop_from":1}),json.dumps({"f":0,"data":data})]
   open(os.path.expanduser(f"~/.hermes/eikons/{n}/{n}.eikon"),"w").write("\n".join(out)+"\n")
   PY
   ```
   If chafa/ffmpeg aren't installed, skip this step — the tab's `native` rasterizer will render on first open.

5. **Point the sidebar at it** (optional — user can do this from Gallery):
   ```bash
   python3 -c "import json,os; p=os.path.expanduser('~/.hermes/herm/tui.json'); d=json.load(open(p)) if os.path.exists(p) else {}; d['eikonPath']=os.path.expanduser('~/.hermes/eikons/$NAME/$NAME.eikon'); open(p,'w').write(json.dumps(d,indent=2))"
   ```

6. **Coach.** Tell the user:
   > Wrote `<name>`. Open the **Eikon** tab (Alt+5 or type `/eikon`). Drag the preview to reframe, scroll to zoom. If it's too dark, nudge **contrast** up in the Knobs panel; if detail is mushy, try **symbols → block**. Tab cycles panes; ←→ on a knob row adjusts it. **Ctrl+S** saves and the sidebar updates.

## Knob vocabulary (for coaching — chafa rasterizer)

- `symbols`: braille · block · ascii · sextant
- `invert`: on/off (most photos want on)
- `flip`: none · h · v · hv
- `contrast`: 0.5–3.0

Spatial (preview pane, not knob rows): drag pans, wheel zooms, arrows pan when preview pane focused.

## Don't

- Write a WIP file or poll for `tool.complete` — that flow is gone.
- Write tonal knob values into `studio.json.base` beyond `{}` — user owns tuning.
- Re-run the pipeline to "adjust contrast" for the user — tell them which knob to move.
