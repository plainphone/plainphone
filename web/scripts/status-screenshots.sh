#!/bin/bash
# Before/after screenshots of the status surfaces, light and dark, English and Danish, from the
# synthetic fixtures in src/lib/status-fixtures.ts. Starts the Vite dev server, shoots with
# headless Google Chrome (sandbox on) at 390 x 1100 CSS px, stops the server.
#   web/scripts/status-screenshots.sh <output-dir>
set -euo pipefail
OUT=${1:?usage: status-screenshots.sh <output-dir>}
mkdir -p "$OUT"
cd "$(dirname "$0")/.."
PORT=${PORT:-$((20000 + RANDOM % 20000))}
CHROME=${CHROME:-google-chrome}
pnpm exec vite --port "$PORT" --strictPort --host 127.0.0.1 >"$OUT/.vite.log" 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true; rm -f "$OUT/.vite.log"; rm -rf "$PROFILE"' EXIT
PROFILE=$(mktemp -d)
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/screenshots/status.html" >/dev/null && break; sleep 0.5; done
for scene in phones overview approvals; do
  for variant in before after; do
    for mode in light dark; do
      for lang in en da; do
        # preferredColorScheme: 0 = dark, 1 = light (checked against the rendered pages)
        scheme=$([ "$mode" = dark ] && echo 0 || echo 1)
        "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" \
          --window-size=390,1100 --force-device-scale-factor=2 --virtual-time-budget=4000 \
          --blink-settings=preferredColorScheme=$scheme \
          --screenshot="$OUT/web-$scene-$variant-$mode-$lang.png" \
          "http://127.0.0.1:$PORT/screenshots/status.html?scene=$scene&variant=$variant&lang=$lang" >/dev/null 2>&1
      done
    done
  done
done
ls "$OUT"
