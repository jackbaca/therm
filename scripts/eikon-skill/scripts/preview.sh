#!/usr/bin/env bash
# preview.sh — rasterize an image to a 1-frame .eikon WIP file that the
# herm eikon-studio plugin picks up, or bake the current WIP to a real
# install.
#
#   preview.sh <image> [--state NAME] [--no-invert] [--symbols braille|block|ascii]
#   preview.sh --bake <name> --glyph G --author A
#   preview.sh --clear
set -euo pipefail

HH="${HERMES_HOME:-$HOME/.hermes}"
WIP="$HH/herm/eikon-wip.eikon"
W=48; H=24
STATES=(idle listening thinking speaking working error)

mkdir -p "$HH/herm"

die() { echo "eikon: $*" >&2; exit 1; }
command -v chafa >/dev/null || die "chafa not installed"

if [[ "${1:-}" == "--clear" ]]; then rm -f "$WIP"; echo "cleared"; exit 0; fi

if [[ "${1:-}" == "--bake" ]]; then
  shift
  name="${1:?--bake <name>}"; shift
  glyph="◆"; author="${USER:-unknown}"
  while [[ $# -gt 0 ]]; do case "$1" in
    --glyph) glyph="$2"; shift 2;;
    --author) author="$2"; shift 2;;
    *) shift;;
  esac; done
  [[ -f "$WIP" ]] || die "nothing to bake (no WIP)"
  name=$(tr 'A-Z ' 'a-z-' <<<"$name" | tr -cd 'a-z0-9-')
  mkdir -p "$HH/eikons"
  # Rewrite header with final name/glyph/author, body unchanged.
  {
    printf '{"eikon":1,"name":"%s","width":%d,"height":%d,"author":"%s","glyph":"%s","created":"%s"}\n' \
      "$name" "$W" "$H" "$author" "$glyph" "$(date -u +%FT%TZ)"
    tail -n +2 "$WIP"
  } > "$HH/eikons/$name.eikon"
  rm -f "$WIP"
  echo "$HH/eikons/$name.eikon"
  exit 0
fi

img="${1:?usage: preview.sh <image> [...]}"; shift
[[ -f "$img" ]] || die "not found: $img"
state=""; invert=--invert; symbols=braille
while [[ $# -gt 0 ]]; do case "$1" in
  --state) state="$2"; shift 2;;
  --no-invert) invert=""; shift;;
  --symbols) symbols="$2"; shift 2;;
  *) shift;;
esac; done

frame=$(chafa --size=${W}x${H} --format=symbols --stretch --symbols=$symbols --colors=none --dither=none $invert "$img")
# Pad/clip to exactly HxW.
frame=$(awk -v W=$W -v H=$H 'NR<=H{printf "%-*.*s\n",W,W,$0} END{for(i=NR;i<H;i++)printf "%-*s\n",W,""}' <<<"$frame")
data=$(jq -Rs . <<<"${frame%$'\n'}")

emit_state() { printf '{"state":"%s","fps":12,"frame_count":1,"loop_from":1}\n{"f":0,"data":%s}\n' "$1" "$2"; }

if [[ -z "$state" || ! -f "$WIP" ]]; then
  # Fresh WIP: all 6 states share the frame.
  {
    printf '{"eikon":1,"name":"wip","width":%d,"height":%d,"author":"%s","glyph":"◆"}\n' "$W" "$H" "${USER:-unknown}"
    for s in "${STATES[@]}"; do emit_state "$s" "$data"; done
  } > "$WIP"
else
  # Merge: replace only the named state in the existing WIP.
  tmp=$(mktemp)
  awk -v S="$state" -v D="$data" '
    NR==1 { print; next }
    /^\{"state":/ {
      match($0, /"state":"([^"]+)"/, m); cur=m[1]
      if (cur==S) { skip=1; printf "{\"state\":\"%s\",\"fps\":12,\"frame_count\":1,\"loop_from\":1}\n{\"f\":0,\"data\":%s}\n",S,D; next }
      skip=0
    }
    skip && /^\{"f":/ { next }
    { print }
  ' "$WIP" > "$tmp" && mv "$tmp" "$WIP"
fi

# Echo poster so the agent can show it inline too.
echo "$frame"
