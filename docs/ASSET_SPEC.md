# Asset Spec — Card Artwork

**Source of truth:** the Figma Make file _Design Classic and No Mercy UNO Cards_ (`figma.com/make/WGOCYv8jacVUS7eCL5Y7Lv`). Card visuals are taken from it unchanged. No card art is drawn or altered in this repo. This replaces the Phase 0 placeholder spec (240×360 frames, invented palette).

## 1. What the design contains

124 self-contained SVGs, one per _distinct_ card face (duplicates in the physical deck share a file):

| Edition | Files | Contents |
|---|---|---|
| `classic/` | 55 | `back`; `{red,yellow,green,blue}-{0..9}`; `{color}-{skip,reverse,draw-two}`; `wild`; `wild-draw-four` |
| `no-mercy/` | 69 | `back`; `{color}-{0..9}`; `{color}-{skip,reverse,draw-two,draw-four,discard-all,skip-everyone}`; `wild-reverse-draw-four`; `wild-draw-six`; `wild-draw-ten`; `wild-color-roulette` |

Two kinds of file:

- **106 vector SVGs** (number cards, backs, and all No Mercy coloured actions), generated deterministically.
- **18 raster-in-SVG cards** (12 Classic coloured actions, Classic Wild and Wild Draw Four, the 4 No Mercy wilds). Each embeds a PNG as a base64 `data:` URI. These are not editable vectors.

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
- The 18 raster cards use the PNGs in `tools/figma-cards/scripts/reference-specials/` (copied from the Figma Make source). `manifest.json` there lists each file's size and SHA-256, and the generator refuses to run if any PNG differs. It is trimmed to the fields the generator uses; the full provenance manifest stays in the Figma Make file.
- Sync from Figma: read the Make source through the Figma MCP (`get_design_context` on the Make file key, then the `file://figma/make/source/...` resources).

Verified: `generate-uno-cards.mjs --check` passes for all 124 cards; the PNG hashes match the Figma manifest; `classic/red-7.svg` is byte-identical to the file in the Figma Make source.

## 6. Hosting and size budget

Imported by the Vite build, hashed, served by Cloudflare Static Assets with immutable caching.

| Budget | Limit | Notes |
|---|---|---|
| Vector card SVG | largest today 30 KB (`no-mercy/back.svg`) | project cap 100 KB |
| Raster-in-SVG card | project cap 1.5 MB each | largest today 753 KB (`classic/wild.svg`) |
| Whole set today | 6.8 MB raw (124 cards) | tracked by `scripts/bundle-size.mjs` once added |
| Per-file Cloudflare limit | 25 MiB | not a constraint |
| Initial page load | only the back + visible cards; faces lazy-loaded | |

`scripts/bundle-size.mjs` (to be added with the first deck UI) tracks totals per asset class.

## 7. Accessibility

Alt text is generated from the engine card (`cardLabel`), not from file names. Each SVG already has a `<title>` for standalone use.
