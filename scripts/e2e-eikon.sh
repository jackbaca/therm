#!/usr/bin/env bash
# End-to-end proof of the built-in Eikon tab via herm's CONTROL harness.
# Everything runs against a tmpdir HERMES_HOME.
#
#   scripts/e2e-eikon.sh
#
# Flow: boot herm headless (CONTROL=1) → wait /status.ready → /tab 4 →
# assert Studio chrome renders → assert Gallery lists seeded eikon.
# Ctrl+S flow requires a real image so it's gated on ffmpeg/chafa.

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${PORT:-7793}
HH=$(mktemp -d -t herm-e2e-XXXXXX)
mkdir -p "$HH/herm" "$HH/eikons/probe/source"
trap 'kill -TERM $PID 2>/dev/null || true; rm -rf "$HH"' EXIT

# Seed a minimal editable eikon.
bun -e '
const n="probe"
const row="E2E-EIKON-PROBE".padEnd(48)
const out=[JSON.stringify({eikon:1,name:n,width:48,height:24})]
for(const s of ["idle","listening","thinking","speaking","working","error"]){
  out.push(JSON.stringify({state:s,fps:12,frame_count:1,loop_from:1}))
  out.push(JSON.stringify({f:0,data:Array(24).fill(row).join("\n")}))
}
await Bun.write(process.argv[1],out.join("\n")+"\n")
' "$HH/eikons/probe/probe.eikon"
cat > "$HH/eikons/probe/studio.json" <<'JSON'
{"rasterizer":"native","spatial":{"zoom":1,"ox":0.5,"oy":0.5},"base":{},"per":{},"glyph":"◆","sources":{}}
JSON
cat > "$HH/herm/tui.json" <<JSON
{"eikonPath":"$HH/eikons/probe/probe.eikon"}
JSON

cd "$HERE"
# Sidebar + studio need ≥120 cols.
CONTROL=1 CONTROL_PORT=$PORT HERMES_HOME="$HH" COLUMNS=160 LINES=48 \
  python3 scripts/ptyrun.py 160 48 bun run dev >/dev/null 2>&1 &
PID=$!

wait_ready() {
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:$PORT/status" | grep -q '"ready":true'; then return 0; fi
    sleep 0.5
  done
  return 1
}
wait_ready || { echo "FAIL: ready timeout"; exit 1; }

curl -sf -XPOST "http://localhost:$PORT/tab/Eikon" >/dev/null
sleep 0.5

FRAME=$(curl -sf "http://localhost:$PORT/frame")
grep -q "Knobs" <<<"$FRAME" || { echo "FAIL: studio Knobs pane missing"; echo "$FRAME"; exit 1; }
grep -q "rasterizer" <<<"$FRAME" || { echo "FAIL: rasterizer row missing"; exit 1; }
grep -q "States" <<<"$FRAME" || { echo "FAIL: state strip missing"; exit 1; }

# Shift+→ to Gallery sub-tab.
curl -sf -XPOST "http://localhost:$PORT/key" -d '{"name":"right","shift":true}' >/dev/null
sleep 0.3
FRAME=$(curl -sf "http://localhost:$PORT/frame")
grep -q "Gallery (" <<<"$FRAME" || { echo "FAIL: gallery missing"; exit 1; }
grep -q "probe" <<<"$FRAME" || { echo "FAIL: probe not listed"; exit 1; }

echo "ok: e2e-eikon (3/3 assertions)"
