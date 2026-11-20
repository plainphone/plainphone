#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Renders the server mails in all five languages, light and dark, into
# docs/screenshots/mail-locales/<lang>-<light|dark>.png. Needs Google Chrome or Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
dest=docs/screenshots/mail-locales
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
chrome=$(command -v google-chrome || command -v chromium || command -v chromium-browser)
(cd server && pnpm exec tsx scripts/render-mail-locales.ts "$tmp")
mkdir -p "$dest"
for lang in en da sv nb de; do
  # preferredColorScheme: 0 = dark, 1 = light in this Chrome build. A throw-away profile keeps the run clean.
  for scheme in light dark; do
    n=1; [ "$scheme" = dark ] && n=0
    "$chrome" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$tmp/profile-$lang-$scheme" \
      --blink-settings=preferredColorScheme=$n --allow-file-access-from-files \
      --window-size=2240,900 --virtual-time-budget=4000 \
      --screenshot="$dest/$lang-$scheme.png" "file://$tmp/$lang.html" >/dev/null 2>&1
  done
done
ls -l "$dest"
