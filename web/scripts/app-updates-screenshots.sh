#!/bin/bash
# Screenshots of the dashboard's "App updates" section (docs/policies.md, "App updates") in all
# five languages, light and dark, from the fictional fixture in screenshots/site.tsx. Starts the
# Vite dev server, shoots with headless Google Chrome (sandbox on) at 390 x 900 CSS px, stops it.
#   web/scripts/app-updates-screenshots.sh <output-dir>
set -euo pipefail
OUT=${1:?usage: app-updates-screenshots.sh <output-dir>}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
cd "$(dirname "$0")/.."
PORT=${PORT:-$((20000 + RANDOM % 20000))}
CHROME=${CHROME:-google-chrome}
PROFILE=$(mktemp -d)
pnpm exec vite --port "$PORT" --strictPort --host 127.0.0.1 >"$OUT/.vite.log" 2>&1 &
VITE=$!
trap 'kill $VITE 2>/dev/null || true; rm -f "$OUT/.vite.log"; rm -rf "$PROFILE"' EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/screenshots/site.html" >/dev/null && break; sleep 0.5; done
for mode in light dark; do
  for lang in en da sv nb de; do
    # preferredColorScheme: 0 = dark, 1 = light
    scheme=$([ "$mode" = dark ] && echo 0 || echo 1)
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$PROFILE" \
      --window-size=390,900 --force-device-scale-factor=2 --virtual-time-budget=4000 \
      --blink-settings=preferredColorScheme=$scheme \
      --screenshot="$OUT/web-app-updates-$mode-$lang.png" \
      "http://127.0.0.1:$PORT/screenshots/site.html?scene=appUpdates&lang=$lang" >/dev/null 2>&1
  done
done
ls "$OUT"
