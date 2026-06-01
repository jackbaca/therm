#!/usr/bin/env bash
# Record a scripted herm tour to an asciinema .cast file.
#
#   scripts/showcase/record.sh [out.cast]
#
# Env:
#   COLS, ROWS        terminal size for the recording (default 160x42)
#   CONTROL_PORT      control server port (default 7777)
#   HERM_CMD          herm entrypoint (default: bun run src/index.tsx --no-splash? no — splash is part of the show)
#
# Output:
#   <out>.cast        asciinema v2 cast
#   <out>.driver.log  per-step drive log (stderr of drive.ts)
#
# Post-process:
#   asciinema play <out>.cast
#   agg <out>.cast <out>.gif

set -euo pipefail
cd "$(dirname "$0")/../.."

command -v asciinema >/dev/null || { echo "asciinema not found — brew install asciinema"; exit 1; }

OUT="${1:-.ignore/showcase-$(date +%Y%m%d-%H%M%S).cast}"
COLS="${COLS:-160}"
ROWS="${ROWS:-42}"
PORT="${CONTROL_PORT:-7777}"
CMD="${HERM_CMD:-bun run src/index.tsx}"
LOG="${OUT%.cast}.driver.log"

mkdir -p "$(dirname "$OUT")"

# driver first — it polls /status until herm is up, so order doesn't race
CONTROL_PORT="$PORT" bun scripts/showcase/drive.ts 2>"$LOG" &
driver=$!
trap 'kill $driver 2>/dev/null || true' EXIT

echo "● recording $COLS×$ROWS → $OUT  (driver log: $LOG)"
asciinema rec "$OUT" \
  --overwrite \
  -f asciicast-v2 \
  --window-size "${COLS}x${ROWS}" \
  --command "CONTROL=1 CONTROL_PORT=$PORT $CMD"

wait "$driver" 2>/dev/null || true
echo "✓ $OUT"

if command -v agg >/dev/null; then
  GIF="${OUT%.cast}.gif"
  echo "● rendering $GIF"
  agg "$OUT" "$GIF" -q \
    --renderer fontdue \
    --font-family "JetBrainsMono Nerd Font Mono,JetBrains Mono,DejaVu Sans Mono" \
    --font-dir /usr/share/fonts/TTF \
    --font-size 14 --line-height 1.3 \
    --fps-cap 24 --idle-time-limit 2 --theme nord
  echo "✓ $GIF"
  command -v ffmpeg >/dev/null && ffmpeg -hide_banner -loglevel error -i "$GIF" \
    -vf "fps=24,format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
    -c:v libx264 -crf 22 -movflags +faststart "${OUT%.cast}.mp4" -y \
    && echo "✓ ${OUT%.cast}.mp4"
fi

echo "  play:  asciinema play $OUT"
