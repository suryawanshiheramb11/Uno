#!/usr/bin/env bash
# Rebuilds every card face in apps/web/src/assets/cards from the Figma Make sources, as true vector SVG.
#   1. Figma's own generator          -> public/cards/**          (14 of these embed a PNG)
#   2. re-centre the Classic Draw Two PNGs (local fix, see docs/ASSET_SPEC.md)
#   3. trace those 14 PNG cards to vector -> public/cards-vector/**
#   4. copy everything into the web app
# Needs Node, and Python 3.13 or older with:  pip install pillow numpy vtracer   (vtracer crashes on Python 3.14)
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3.13}"

$PY scripts/recenter-draw-two.py
node scripts/generate-uno-cards.mjs
node scripts/generate-uno-cards.mjs --check
$PY scripts/vectorize-raster-cards.py

for edition in classic no-mercy; do
  cp public/cards/$edition/*.svg ../../apps/web/src/assets/cards/$edition/
done
cp public/cards-vector/classic/*.svg ../../apps/web/src/assets/cards/classic/

if grep -l 'data:image/png' ../../apps/web/src/assets/cards/*/*.svg >/dev/null 2>&1; then
  echo "ERROR: a card still embeds a raster image" >&2; exit 1
fi
echo "All 124 cards are vector."
