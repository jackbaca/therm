#!/usr/bin/env bash
# End-to-end proof of the eikon-studio plugin via herm's CONTROL harness.
# Everything runs against a tmpdir HERMES_HOME so nothing touches real state.
#
#   scripts/e2e-eikon-studio.sh
#
# Steps: boot herm headless (CONTROL=1) → wait /status.ready → activate
# plugin → write WIP .eikon → push tool.complete → assert /frame shows
# the preview badge → delete WIP → push → assert gone.

set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=${PORT:-7791}
HH=$(mktemp -d -t herm-e2e-XXXXXX)
mkdir -p "$HH/herm"
trap 'kill -TERM $PID 2>/dev/null || true' EXIT

# Fixture WIP eikon: 6 states × 1 identical frame carrying a sentinel row.
SENTINEL="E2E-EIKON-STUDIO"
bun -e '
const S=["idle","listening","thinking","speaking","working","error"]
const row = ("▙"+process.argv[1]+"▟").padEnd(48," ")
const lines = Array.from({length:24},()=>row)
const out=[JSON.stringify({eikon:1,name:"e2e",width:48,height:24,author:"e2e",glyph:"◆"})]
for(const s of S){out.push(JSON.stringify({state:s,fps:12,frame_count:1,loop_from:1}));out.push(JSON.stringify({f:0,data:lines.join("\n")}))}
await Bun.write(process.argv[2],out.join("\n")+"\n")
' "$SENTINEL" "$HH/herm/eikon-wip.eikon"

cd "$HERE"
# Herm's sidebar only mounts at ≥120 cols, and createCliRenderer reads
# stdout.columns off the real pty. ptyrun.py forks onto a sized pty.
COLS=200 ROWS=50 python3 scripts/ptyrun.py \
  env CONTROL=1 CONTROL_PORT=$PORT HERMES_HOME=$HH \
  bun run src/index.tsx --no-splash &
PID=$!

req() { curl -sS "http://127.0.0.1:$PORT$1" "${@:2}"; }
j()   { req "$1" -H 'content-type: application/json' -d "$2" -X POST; }

# Wait for the shell to paint (≤15s). Plugin system doesn't need gateway
# readiness — gate on the clock plugin rendering (proof PluginProvider ran).
for i in $(seq 1 30); do
  F=$(req "/frame?grep=:" 2>/dev/null || true)
  [[ -n "$F" ]] && grep -qE '[0-9]{2}:[0-9]{2}:[0-9]{2}' <<<"$F" && break
  sleep 0.5
done
grep -qE '[0-9]{2}:[0-9]{2}:[0-9]{2}' <<<"$F" || { echo "FAIL: shell not painted"; exit 1; }

# Activate the plugin (enabled: false by default).
j "/plugin/herm.eikon-studio" '{"on":true}' | jq -e '.ok==true' >/dev/null

# Fire the event that triggers stat-check.
j /push '{"type":"tool.complete","payload":{"tool_id":"e2e"}}' >/dev/null

# Assert the preview is live.
for i in $(seq 1 20); do
  F=$(req "/frame?grep=$SENTINEL")
  [[ -n "$F" ]] && break
  sleep 0.2
done
[[ -n "$F" ]] || { echo "FAIL: sentinel not in frame"; req /frame | head -30; exit 1; }
req "/frame?grep=wip" | grep -q "wip · e2e" || { echo "FAIL: badge missing"; exit 1; }
echo "PASS: preview visible"

# Clear: delete file, fire message.complete, assert default returns.
rm -f "$HH/herm/eikon-wip.eikon"
j /push '{"type":"message.complete"}' >/dev/null
for i in $(seq 1 20); do
  F=$(req "/frame?grep=$SENTINEL")
  [[ -z "$F" ]] && break
  sleep 0.2
done
[[ -z "$F" ]] || { echo "FAIL: preview did not clear"; exit 1; }
echo "PASS: preview cleared"

# --- editor path: write a WIP with studio header, activate → panel renders.
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i "nullsrc=s=256x128,format=gray,geq=lum=255*gte(X\,128)" \
  -frames:v 1 -y /tmp/e2e-step.png
bun -e '
const S=["idle","listening","thinking","speaking","working","error"]
const K={symbols:"braille",invert:true,contrast:1,zoom:1,ox:0.5,oy:0.5}
const out=[JSON.stringify({eikon:1,name:"e2e",width:48,height:24,author:"e2e",glyph:"◆",studio:{src:"/tmp/e2e-step.png",base:K,per:{}}})]
for(const s of S){out.push(JSON.stringify({state:s,fps:12,frame_count:1,loop_from:1}));out.push(JSON.stringify({f:0,data:" "}))}
await Bun.write(process.argv[1],out.join("\n")+"\n")
' "$HH/herm/eikon-wip.eikon"
j "/plugin/herm.eikon-studio" '{"on":true}'  >/dev/null
j /push '{"type":"tool.complete","payload":{"tool_id":"e2e"}}' >/dev/null
for i in $(seq 1 20); do req "/frame?grep=EIKON%20STUDIO" | grep -q STUDIO && break; sleep 0.2; done
req "/frame?grep=EIKON%20STUDIO" | grep -q STUDIO || { echo "FAIL: panel not mounted"; req /frame | head -40; exit 1; }
req "/frame?grep=braille" | grep -q "◂ braille ▸" || { echo "FAIL: symbols row missing"; exit 1; }
echo "PASS: editor panel visible"

# Drive a key: 'l' → symbols cycles to block.
j /key '{"name":"l","safe":false}' >/dev/null
for i in $(seq 1 20); do req "/frame?grep=block" | grep -q "◂ block ▸" && break; sleep 0.2; done
req "/frame?grep=block" | grep -q "◂ block ▸" || { echo "FAIL: knob did not change"; req /frame | head -40; exit 1; }
echo "PASS: knob edit via /key"

# Enter → commit → panel gone, badge ◌.
j /key '{"name":"return","safe":false}' >/dev/null
for i in $(seq 1 20); do req "/frame?grep=EIKON%20STUDIO" | grep -q STUDIO || break; sleep 0.2; done
req "/frame?grep=EIKON%20STUDIO" | grep -q STUDIO && { echo "FAIL: panel did not close on commit"; exit 1; }
req "/frame?grep=wip" | grep -q "◌ wip" || { echo "FAIL: watching badge missing after commit"; exit 1; }
echo "PASS: commit → watching"

# Deactivate plugin, confirm idempotent.
j "/plugin/herm.eikon-studio" '{"on":false}' | jq -e '.ok==true' >/dev/null
echo "PASS: e2e-eikon-studio ok"
