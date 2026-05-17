#!/usr/bin/env bash
# End-to-end proof of the built-in Eikon tab via herm's CONTROL harness.
# Everything runs against a tmpdir HERMES_HOME.
#
#   scripts/e2e-eikon.sh
#
# Flow: boot herm headless → wait for paint → Alt+→ ×4 to Eikon tab →
# assert Studio chrome renders → Shift+→ to Gallery → assert listed.

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${PORT:-7793}
HH=$(mktemp -d -t herm-e2e-XXXXXX)
mkdir -p "$HH/herm" "$HH/eikons/probe/source"
trap 'kill -TERM $PID 2>/dev/null || true; rm -rf "$HH"' EXIT

# Seed a minimal eikon so the tab auto-opens something.
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
{"eikon":"probe"}
JSON

cd "$HERE"
# Sidebar + studio need ≥120 cols; createCliRenderer reads stdout.columns
# off the real pty. ptyrun.py forks onto a sized pty.
COLS=200 ROWS=50 python3 scripts/ptyrun.py \
  env CONTROL=1 CONTROL_PORT=$PORT HERMES_HOME=$HH \
  bun run src/index.tsx --no-splash &
PID=$!

req() { curl -sS "http://127.0.0.1:$PORT$1" "${@:2}"; }
j()   { req "$1" -H 'content-type: application/json' -d "$2" -X POST; }

# Wait for the shell to paint (≤15s) — top tab bar is the cheapest signal.
for i in $(seq 1 30); do
  F=$(req "/frame" 2>/dev/null || true)
  grep -q "Eikon" <<<"$F" && break
  sleep 0.5
done
grep -q "Eikon" <<<"$F" || { echo "FAIL: shell not painted"; exit 1; }

# Alt+→ ×4 → Eikon tab. (/tab/:n injects ctrl+arrows — rough-edge #6.)
for i in 1 2 3 4; do j /key '{"name":"right","meta":true}' >/dev/null; done
sleep 0.5

F=$(req /frame)
grep -q "Knobs"      <<<"$F" || { echo "FAIL: studio Knobs pane missing"; echo "$F"; exit 1; }
grep -q "rasterizer" <<<"$F" || { echo "FAIL: rasterizer row missing"; exit 1; }
grep -q "States"     <<<"$F" || { echo "FAIL: state strip missing"; exit 1; }

# Shift+→ to Gallery sub-tab.
j /key '{"name":"right","shift":true}' >/dev/null
sleep 0.3
F=$(req /frame)
grep -q "Gallery (" <<<"$F" || { echo "FAIL: gallery missing"; echo "$F"; exit 1; }
grep -q "probe"     <<<"$F" || { echo "FAIL: probe not listed"; exit 1; }

echo "ok: e2e-eikon (5/5 assertions)"
