#!/usr/bin/env bash
# Rebuild every README image of Evalbench in Glass, dark and light, wide and phone.
#
# 1. Start the app on the demo workspace (any free port; sign-in off, so it answers localhost only):
#      EVALBENCH_DATA=$(mktemp -d) EVALBENCH_PORT=8590 EVALBENCH_DEMO=1 EVALBENCH_AUTH=off \
#        EVALBENCH_SANDBOX=local NIMBUS_API_KEY=demo evalbench serve &
# 2. ORIGIN=http://127.0.0.1:8590 NODE_PATH=/path/to/node_modules docs/readme/src/build.sh
#
# Needs: node with three (0.170) in NODE_PATH (playwright comes from web/node_modules), a Chromium that playwright
# can launch (a GPU helps; the scenes are WebGL), ImageMagick, and python3 with Pillow and NumPy.
# capture.cjs photographs the running app in its dark theme and its light theme, and a new run playing start to
# finish in the static demo (built here, into web/dist); render.cjs composes the glass scenes from layouts.js;
# ImageMagick writes the stills as WebP. The hero is a loop at 12 frames a second: it opens on the verdict, plays
# that run in the centre window and comes back. render.cjs writes one turn of it as frames and loop.py packs them.
set -euo pipefail
SRC=$(cd "$(dirname "$0")" && pwd)
OUT=$(cd "$SRC/.." && pwd)
ROOT=$(cd "$OUT/../.." && pwd)
BUILD="$OUT/build"
: "${NODE_PATH:?set NODE_PATH to a node_modules folder that holds three}"
export NODE_PATH="$NODE_PATH:$ROOT/web/node_modules"
export ORIGIN="${ORIGIN:-http://127.0.0.1:8484}"

npm --prefix "$ROOT/web" run build:demo
node "$SRC/capture.cjs"
rm -rf "$BUILD/png" "$BUILD/loop"
mkdir -p "$BUILD/png" "$BUILD/loop"

jobs=()
for t in dark light; do
  for l in numbers verdict proof write judge holds; do
    jobs+=("$l:$t:still:$BUILD/png/$l-$t.png" "$l-phone:$t:still:$BUILD/png/$l-$t-phone.png")
  done
  jobs+=("hero:$t:anim:loop:$BUILD/loop/hero-$t" "hero-phone:$t:anim:loop:$BUILD/loop/hero-$t-phone")
done
node "$SRC/render.cjs" "${jobs[@]}"
for f in "$BUILD"/png/*.png; do
  magick "$f" -strip -quality 90 -define webp:method=6 "$OUT/$(basename "$f" .png).webp"
done
# the last number is the WebP quality: the phone hero has more picture to move and half the size to do it in
for t in dark light; do
  python3 "$SRC/loop.py" "$BUILD/loop/hero-$t" "$OUT/hero-$t.webp" 12 62
  python3 "$SRC/loop.py" "$BUILD/loop/hero-$t-phone" "$OUT/hero-$t-phone.webp" 12 56
done

# The plate for the repository's social preview (Settings, Social preview on GitHub), 1280 x 640, dark.
node "$SRC/render.cjs" "social:dark:still:$OUT/social.png"
magick "$OUT/social.png" -strip -define png:compression-level=9 "$OUT/social.png"

du -ch "$OUT"/*.webp | tail -1
