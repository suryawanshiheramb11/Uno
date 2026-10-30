# Asset Spec — Card Artwork

**Source of truth:** the Figma Make file _Design Classic and No Mercy UNO Cards_ (`figma.com/make/WGOCYv8jacVUS7eCL5Y7Lv`). Card visuals are taken from it unchanged. No card art is drawn or altered in this repo. This replaces the Phase 0 placeholder spec (240×360 frames, invented palette).

## 1. What the design contains

124 self-contained SVGs, one per _distinct_ card face (duplicates in the physical deck share a file):

| Edition | Files | Contents |
|---|---|---|
| `classic/` | 55 | `back`; `{red,yellow,green,blue}-{0..9}`; `{color}-{skip,reverse,draw-two}`; `wild`; `wild-draw-four` |
| `no-mercy/` | 69 | `back`; `{color}-{0..9}`; `{color}-{skip,reverse,draw-two,draw-four,discard-all,skip-everyone}`; `wild-reverse-draw-four`; `wild-draw-six`; `wild-draw-ten`; `wild-color-roulette` |

Two kinds of file:

- **110 vector SVGs** (number cards, backs, all No Mercy coloured actions and the four No Mercy wilds), generated deterministically.
- **14 raster-in-SVG cards** (the 12 Classic Skip/Reverse/Draw Two cards plus Classic Wild and Wild Draw Four). Each embeds a PNG as a base64 `data:` URI. These are not editable vectors.

*Every card the app ships is now true vector (see §9), so all 124 stay sharp at any zoom.* *Re-synced from Figma after the design changed: the four Classic Draw Two cards got new, centred +2 artwork, and the four No Mercy wilds (Wild Reverse Draw Four, Draw Six, Draw Ten, Color Roulette) became clean scalable vector instead of an embedded photo restoration.*

## 2. Geometry (from the design, fixed)

| Property | Value |
|---|---|
| `viewBox` | `0 0 570 890` |
| Document size | `57mm × 89mm` (root `width`/`height`). CSS sizes the element, so use `aspect-ratio: 570 / 890`. |
| Outer card | `rect` 570×890, `rx=35`, white (Classic) or `#242225` (No Mercy) border |
| Face | `rect x=35 y=36 width=500 height=818 rx=36` |
| Rotational symmetry | corner index duplicated with `rotate(180 285 445)` |
| Text | none: digits and lettering are outlined paths; no `<text>`, no fonts |

## 3. Palette (`tools/figma-cards/src/card-palette.json`)

| Colour | Classic | No Mercy face | No Mercy shade |
|---|---|---|---|
| red | `#ed1c24` | `#ed292e` | `#c61e27` |
| yellow | `#f8ca10` | `#f9d52c` | `#efbd1b` |
| green | `#079c4b` | `#508a36` | `#34692b` |
| blue | `#0879c8` | `#277bc1` | `#1a59a4` |

The UI uses these values for tokens (active-colour indicator, colour picker) so the table matches the cards.

## 4. File layout and naming

Figma's names are kept as-is, so the card set can be re-synced by copy:

```
apps/web/src/assets/cards/classic/red-7.svg
apps/web/src/assets/cards/classic/wild-draw-four.svg
apps/web/src/assets/cards/no-mercy/blue-discard-all.svg
apps/web/src/assets/cards/no-mercy/wild-draw-ten.svg
apps/web/src/assets/cards/<edition>/back.svg
```

Engine card → file mapping (`CardDef` → `<edition>/<name>.svg`):

| Engine | `<name>` |
|---|---|
| number `n`, colour `c` | `c-n` |
| `skip` / `reverse` / `draw_two` (Classic and NM) | `c-skip` / `c-reverse` / `c-draw-two` |
| NM `draw_four` / `discard_all` / `skip_everyone` | `c-draw-four` / `c-discard-all` / `c-skip-everyone` |
| `wild`, `wild_draw_four` | `wild`, `wild-draw-four` |
| NM `wild_reverse_draw_four`, `wild_draw_six`, `wild_draw_ten`, `wild_color_roulette` | same with `-` |
| card back | `back` |

## 5. Reproducible export — one command

The design file ships its own generator; it is vendored unchanged in `tools/figma-cards/` (`scripts/generate-uno-cards.mjs`, `uno-special-art.mjs`, `uno-source-pixels.mjs`, `uno-special-shapes.json`, `src/card-actions.json`, `src/card-palette.json`).

- Regenerate: `node tools/figma-cards/scripts/generate-uno-cards.mjs` → writes `tools/figma-cards/public/cards/**`; copy into `apps/web/src/assets/cards/`.
- Verify: `… generate-uno-cards.mjs --check` (staleness, no `<text>`/`<script>`, no external hrefs, no NaN geometry).
- The 14 raster cards use the PNGs in `tools/figma-cards/scripts/reference-specials/` (copied from the Figma Make source). `manifest.json` there lists each file's size and SHA-256, and the generator refuses to run if any raster PNG differs. The four No Mercy wild PNGs are kept for reference only (`rendering: "vector"`) and are not embedded. It is trimmed to the fields the generator uses; the full provenance manifest stays in the Figma Make file.
- Sync from Figma: read the Make source through the Figma MCP (`get_design_context` on the Make file key, then the `file://figma/make/source/...` resources).

Verified: `generate-uno-cards.mjs --check` passes for all 124 cards; the PNG hashes match the Figma manifest; `classic/red-7.svg` is byte-identical to the file in the Figma Make source.

## 6. Hosting and size budget

Imported by the Vite build, hashed, served by Cloudflare Static Assets with immutable caching.

| Budget | Limit | Notes |
|---|---|---|
| Vector card SVG | largest today 30 KB (`no-mercy/back.svg`) | project cap 100 KB |
| Raster-in-SVG card | project cap 1.5 MB each | largest today 753 KB (`classic/wild.svg`) |
| No Mercy wilds (now vector) | 4-7 KB each | were 96-149 KB as raster |
| Whole set today | 6.1 MB raw (124 cards) | tracked by `scripts/bundle-size.mjs` once added |
| Per-file Cloudflare limit | 25 MiB | not a constraint |
| Initial page load | only the back + visible cards; faces lazy-loaded | |

`scripts/bundle-size.mjs` (to be added with the first deck UI) tracks totals per asset class.

## 7. Accessibility

Alt text is generated from the engine card (`cardLabel`), not from file names. Each SVG already has a `<title>` for standalone use.

## 8. Local adjustment to the Figma artwork

The four Classic **Draw Two** PNGs in the Figma source had their coloured face off-centre inside the white
border (24 px left / 49 px right, 50 px top / 12 px bottom at 814 × 1259), so the border looked lopsided. They are
re-centred by `tools/figma-cards/scripts/recenter-draw-two.py`: the face, oval and corner indices move so the
borders are equal (L36 R37 T31 B31), while the +2 tile stack stays centred on the card as the design intends.
The untouched Figma PNGs are kept in `scripts/reference-specials/figma-original/` and the manifest records both
hashes (`figmaPngSha256` and `pngSha256`). If the Figma file is later fixed at source, delete the script's output by
copying the originals back and removing `locallyRecentered` from the manifest entries.

## 9. Canonical dimensions and canonical filenames

| Property | Value |
|---|---|
| Canonical `viewBox` | `0 0 570 890` (aspect 57 : 89) |
| Card width × height | `570 × 890` user units (57 mm × 89 mm document size) |
| Outer corner radius | `35` |
| Face (inner) corner radius | `36` |
| Safe-area padding | `35` px left/right, `36` px top, `36` px bottom (face rect `x=35 y=36 w=500 h=818`); nothing interactive or legible may be placed outside it |

**Canonical card IDs.** Every face has the canonical ID `<edition>-<name>` (e.g. `classic-red-7`, `no-mercy-wild-draw-ten`). The ID maps 1:1 to the on-disk file `apps/web/src/assets/cards/<edition>/<name>.svg` (so `classic-red-7` → `classic/red-7.svg`, `no-mercy-wild-draw-ten` → `no-mercy/wild-draw-ten.svg`). A flat, hyphenated export (`classic-red-7.svg`) is produced by `node scripts/export-assets.mjs --flat <dir>`, which copies every file under its canonical ID.

### 9.1 Other assets (format)

| Asset | Format | Path | Notes |
|---|---|---|---|
| Card faces (124) | SVG | `assets/cards/<edition>/<name>.svg` | listed in §9.2 |
| Card backs | SVG | `assets/cards/classic/back.svg`, `assets/cards/no-mercy/back.svg` | IDs `classic-back`, `no-mercy-back` |
| Table textures (felt, wood rim, per-edition) | **WebP** (raster, ≤ 120 KB each, 1920×1080, plus 2× variant ≤ 300 KB) | `assets/tables/<name>.webp` | photographic gradients compress poorly as SVG |
| Table decorative shapes (direction arrows, colour wheel) | SVG | `assets/tables/<name>.svg` | |
| Avatars (default set of 24) | SVG (flat vector, 128×128 `viewBox`) | `assets/avatars/avatar-01.svg` … `avatar-24.svg` | uploaded avatars, if ever added, are WebP ≤ 32 KB |
| Favicon / OG image | SVG (`favicon.svg`, `og.svg`) | `apps/web/public/` | |

### 9.2 Total bundle budget

| Class | Budget (raw) | Budget (gzip) |
|---|---|---|
| JS (initial route) | 250 KB | 80 KB |
| CSS | 40 KB | 10 KB |
| Initial page load, all assets | **≤ 400 KB** transferred (cards lazy-loaded) | |
| Card faces, whole set | **≤ 8 MB** raw (today 6.1 MB) | |
| Tables + avatars | ≤ 1.5 MB combined | |
| **Total deployed bundle** | **≤ 12 MB** (Cloudflare per-file limit 25 MiB, per-deploy asset count limit 20 000 files: both far away) | |

Phase 1 CI fails when the initial JS exceeds its budget (`vite build` `chunkSizeWarningLimit` = 250).

### 9.3 Batch export command

```
node tools/figma-cards/scripts/generate-uno-cards.mjs          # regenerate all 124 SVGs from the Figma design source
node tools/figma-cards/scripts/generate-uno-cards.mjs --check  # verify (also run by CI)
node scripts/export-assets.mjs                                 # copy to apps/web/src/assets/cards and print the manifest
```

### 9.4 Full card-face list

**classic** (55 files)

`classic-back`, `classic-blue-0`, `classic-blue-1`, `classic-blue-2`, `classic-blue-3`, `classic-blue-4`, `classic-blue-5`, `classic-blue-6`, `classic-blue-7`, `classic-blue-8`, `classic-blue-9`, `classic-blue-draw-two`, `classic-blue-reverse`, `classic-blue-skip`, `classic-green-0`, `classic-green-1`, `classic-green-2`, `classic-green-3`, `classic-green-4`, `classic-green-5`, `classic-green-6`, `classic-green-7`, `classic-green-8`, `classic-green-9`, `classic-green-draw-two`, `classic-green-reverse`, `classic-green-skip`, `classic-red-0`, `classic-red-1`, `classic-red-2`, `classic-red-3`, `classic-red-4`, `classic-red-5`, `classic-red-6`, `classic-red-7`, `classic-red-8`, `classic-red-9`, `classic-red-draw-two`, `classic-red-reverse`, `classic-red-skip`, `classic-wild`, `classic-wild-draw-four`, `classic-yellow-0`, `classic-yellow-1`, `classic-yellow-2`, `classic-yellow-3`, `classic-yellow-4`, `classic-yellow-5`, `classic-yellow-6`, `classic-yellow-7`, `classic-yellow-8`, `classic-yellow-9`, `classic-yellow-draw-two`, `classic-yellow-reverse`, `classic-yellow-skip`

**no-mercy** (69 files)

`no-mercy-back`, `no-mercy-blue-0`, `no-mercy-blue-1`, `no-mercy-blue-2`, `no-mercy-blue-3`, `no-mercy-blue-4`, `no-mercy-blue-5`, `no-mercy-blue-6`, `no-mercy-blue-7`, `no-mercy-blue-8`, `no-mercy-blue-9`, `no-mercy-blue-discard-all`, `no-mercy-blue-draw-four`, `no-mercy-blue-draw-two`, `no-mercy-blue-reverse`, `no-mercy-blue-skip`, `no-mercy-blue-skip-everyone`, `no-mercy-green-0`, `no-mercy-green-1`, `no-mercy-green-2`, `no-mercy-green-3`, `no-mercy-green-4`, `no-mercy-green-5`, `no-mercy-green-6`, `no-mercy-green-7`, `no-mercy-green-8`, `no-mercy-green-9`, `no-mercy-green-discard-all`, `no-mercy-green-draw-four`, `no-mercy-green-draw-two`, `no-mercy-green-reverse`, `no-mercy-green-skip`, `no-mercy-green-skip-everyone`, `no-mercy-red-0`, `no-mercy-red-1`, `no-mercy-red-2`, `no-mercy-red-3`, `no-mercy-red-4`, `no-mercy-red-5`, `no-mercy-red-6`, `no-mercy-red-7`, `no-mercy-red-8`, `no-mercy-red-9`, `no-mercy-red-discard-all`, `no-mercy-red-draw-four`, `no-mercy-red-draw-two`, `no-mercy-red-reverse`, `no-mercy-red-skip`, `no-mercy-red-skip-everyone`, `no-mercy-wild-color-roulette`, `no-mercy-wild-draw-six`, `no-mercy-wild-draw-ten`, `no-mercy-wild-reverse-draw-four`, `no-mercy-yellow-0`, `no-mercy-yellow-1`, `no-mercy-yellow-2`, `no-mercy-yellow-3`, `no-mercy-yellow-4`, `no-mercy-yellow-5`, `no-mercy-yellow-6`, `no-mercy-yellow-7`, `no-mercy-yellow-8`, `no-mercy-yellow-9`, `no-mercy-yellow-discard-all`, `no-mercy-yellow-draw-four`, `no-mercy-yellow-draw-two`, `no-mercy-yellow-reverse`, `no-mercy-yellow-skip`, `no-mercy-yellow-skip-everyone`

## 9. Zoom-proof cards: vector tracing of the 14 raster cards

Figma's generator makes 14 Classic cards (Skip, Reverse and Draw Two in four colours, Wild, Wild Draw Four) by embedding a
600-800 px PNG. A PNG has a fixed resolution, so zooming in always blurs it however large the card is drawn. The app
therefore ships a traced vector version of those 14 instead, so every one of the 124 card faces is now vector.

`tools/figma-cards/scripts/vectorize-raster-cards.py` does this: it finds the card's real flat colours, upscales smoothly,
assigns each pixel to a colour (edge pixels go to the nearer of the two colours they blend, so there are no halos),
smooths sub-pixel jitter, and traces curves with VTracer. The result keeps the same 570 x 890 canvas, title and rounded
corners, and uses 3-9 flat colours per card (78-190 KB each, smaller than the PNG versions). It also honours the Wild's embedded
colour profile, so colours match what a browser shows for the original.

- Rebuild everything in one command: `tools/figma-cards/build-cards.sh` (needs Python 3.13 or older with `pillow numpy vtracer`).
- Figma's own generator output is untouched in `tools/figma-cards/public/cards/`; the traced cards are in `public/cards-vector/`.
- These 14 are traced from Figma's artwork, so they match it visually but not byte-for-byte. The Wild's near-black background is
  a faintly mottled range rather than flat colour, so it is rendered as one average dark colour.
- Verified by rendering the originals and the traces side by side at 1x to 20x zoom.
