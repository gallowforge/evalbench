#!/usr/bin/env bash
# Rebuild every README image of Evalbench in Glass, dark and light, wide and phone.
#
# 1. Start the app on the demo workspace (any free port; sign-in off, so it answers localhost only):
#      EVALBENCH_DATA=$(mktemp -d) EVALBENCH_PORT=8590 EVALBENCH_DEMO=1 EVALBENCH_AUTH=off \
#        EVALBENCH_SANDBOX=local NIMBUS_API_KEY=demo evalbench serve &
# 2. ORIGIN=http://127.0.0.1:8590 NODE_PATH=/path/to/node_modules docs/readme/src/build.sh
#
# Needs: node with three (0.170) in NODE_PATH (playwright comes from web/node_modules), a Chromium that playwright
# can launch (a GPU helps; the scenes are WebGL), and ImageMagick.
# capture.cjs photographs the running app in its dark theme and its light theme; render.cjs composes the glass
# scenes from layouts.js; ImageMagick writes them as WebP.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
OUT=$(cd "$SRC/.." && pwd)
ROOT=$(cd "$OUT/../.." && pwd)
BUILD="$OUT/build"
: "${NODE_PATH:?set NODE_PATH to a node_modules folder that holds three}"
export NODE_PATH="$NODE_PATH:$ROOT/web/node_modules"
export ORIGIN="${ORIGIN:-http://127.0.0.1:8484}"

node "$SRC/capture.cjs"
mkdir -p "$BUILD/png"

jobs=()
for l in hero numbers overview write judge board changes; do
  for t in dark light; do
    jobs+=("$l:$t:still:$BUILD/png/$l-$t.png" "$l-phone:$t:still:$BUILD/png/$l-$t-phone.png")
  done
done
node "$SRC/render.cjs" "${jobs[@]}"
for f in "$BUILD"/png/*.png; do
  magick "$f" -strip -quality 90 -define webp:method=6 "$OUT/$(basename "$f" .png).webp"
done

du -ch "$OUT"/*.webp | tail -1
