"""
Turns the 14 raster-in-SVG Classic cards into true vector SVGs that stay sharp at any zoom.

The Figma source art for these cards is a flat-colour PNG (about 600-800 px wide), so scaling it up can only
ever blur. This traces it into smooth bezier curves instead:

  1. read the PNG and find its real flat colours (the card inks, white, grey border, black ...)
  2. upscale it smoothly (Lanczos) and give every pixel one of those colours. Pixels on an edge are blends of two
     colours, so each is assigned to whichever of the pair it is closer to; the contour therefore lands on the true
     edge and there are no halos of a third colour
  3. trace the flat-colour image with VTracer (spline mode)
  4. wrap the paths in the same 570 x 890 card SVG the Figma generator produces (same size, same title), clipped to
     the card's rounded corners

Needs: Pillow, numpy, vtracer (Python 3.13 or older; vtracer's wheel crashes on 3.14).
Run from tools/figma-cards:  python scripts/vectorize-raster-cards.py [--only classic/red-skip]
Output: public/cards-vector/classic/<name>.svg  (the Figma generator's own output in public/cards is untouched)
"""
import argparse, io, itertools, json, os, pathlib, re, tempfile
import numpy as np
import vtracer
from PIL import Image, ImageCms, ImageFilter

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
SPECIALS = HERE / "reference-specials"
OUT = ROOT / "public" / "cards-vector"
UPSCALE = 4          # smooth upscale before snapping to flat colours
MIN_SHARE = 0.0015   # a colour must cover this share of the card to count as a real colour
BIN = 12             # shades are grouped in steps of this many levels per channel when finding colours
MERGE_DIST = 18      # colours closer than this are the same ink
SMOOTH = float(os.environ.get("SMOOTH", 5.0))  # blur (in upscaled px) applied to each colour region before tracing
BLEND_DIST = 16      # a colour this close to the line between two others is a blend, not an ink
NEAR = 10            # a pixel this close to a palette colour simply is that colour


# Per-card tuning. The Wild's dark background is one continuous, faintly mottled range of near-blacks (about 16-32
# grey), not two colours; splitting it only creates blotches, so its dark shades are merged into one (their average).
CARD_MERGE_DIST = {"classic/wild": 52}


def find_palette(rgb: np.ndarray, opaque: np.ndarray, merge_dist: float = MERGE_DIST) -> np.ndarray:
    """The card's real flat colours. Shades within a few levels of each other (the art carries +-1 noise) are one ink."""
    flat = rgb[opaque].astype(np.int32)
    bins = flat // BIN
    keys, inverse, counts = np.unique(bins, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.reshape(-1)
    colours: list[np.ndarray] = []
    weights: list[float] = []
    for i in np.argsort(-counts):
        if counts[i] / len(flat) < MIN_SHARE:
            break
        c = np.median(flat[inverse == i], axis=0)
        for j, p in enumerate(colours):
            if np.linalg.norm(c - p) < merge_dist:
                # same ink: fold in, weighted by how much of the card each covers
                colours[j] = (p * weights[j] + c * counts[i]) / (weights[j] + counts[i])
                weights[j] += counts[i]
                break
        else:
            colours.append(c)
            weights.append(float(counts[i]))
    return drop_blends(np.array(colours))


def drop_blends(palette: np.ndarray) -> np.ndarray:
    """Remove "colours" that are only anti-aliasing between two real ones (e.g. dark olive between black and yellow)."""
    keep = list(range(len(palette)))
    for c in reversed(range(len(palette))):          # least common first
        others = [i for i in keep if i != c]
        for a, b in itertools.combinations(others, 2):
            seg = palette[b] - palette[a]
            t = float((palette[c] - palette[a]) @ seg) / float(seg @ seg)
            if 0.2 < t < 0.8 and np.linalg.norm(palette[c] - (palette[a] + t * seg)) < BLEND_DIST:
                keep.remove(c)
                break
    return palette[keep]


def snap_to_palette(up: np.ndarray, palette: np.ndarray) -> np.ndarray:
    """Label every pixel with a palette index; edge blends go to the nearer end of the colour pair they sit between."""
    h, w, _ = up.shape
    px = up.reshape(-1, 3).astype(np.float32)
    pal = palette.astype(np.float32)
    k = len(pal)
    labels = np.zeros(len(px), dtype=np.uint8)
    chunk = 400_000
    pairs = list(itertools.combinations(range(k), 2))
    for start in range(0, len(px), chunk):
        p = px[start : start + chunk]
        d_all = np.linalg.norm(p[:, None, :] - pal[None, :, :], axis=2)          # (n, k)
        nearest = d_all.argmin(1)
        lab = nearest.copy()
        edge = d_all.min(1) > NEAR
        if edge.any():
            pe = p[edge]
            best = np.full(len(pe), np.inf, dtype=np.float32)
            bl = np.zeros(len(pe), dtype=np.int64)
            for i, j in pairs:
                seg = pal[j] - pal[i]
                t = np.clip(((pe - pal[i]) @ seg) / float(seg @ seg), 0.0, 1.0)
                dist = np.linalg.norm(pe - (pal[i] + t[:, None] * seg), axis=1)
                better = dist < best
                best[better] = dist[better]
                bl[better] = np.where(t[better] < 0.5, i, j)
            lab[edge] = bl
        labels[start : start + chunk] = lab
    return labels.reshape(h, w)


def smooth_labels(labels: np.ndarray, k: int, sigma: float) -> np.ndarray:
    """Removes sub-pixel jitter from region edges: blur each colour's mask and let the strongest colour win."""
    if sigma <= 0:
        return labels
    h, w = labels.shape
    best = np.zeros((h, w), dtype=np.uint8)
    out = np.zeros((h, w), dtype=np.uint8)
    for i in range(k):
        mask = Image.fromarray(((labels == i) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(sigma))
        m = np.asarray(mask)
        better = m > best
        out[better] = i
        best[better] = m[better]
    return out


def fit_corner_radius(opaque: np.ndarray) -> float:
    """Radius of the card's rounded corners, from how far in the first opaque pixel sits on the top rows."""
    best, best_err = 40.0, 1e18
    insets = [(y, int(np.argmax(opaque[y]))) for y in range(0, 30)]
    for r in np.arange(20, 90, 0.5):
        err = 0.0
        for y, inset in insets:
            model = r - np.sqrt(max(r * r - (r - y - 0.5) ** 2, 0.0)) if y < r else 0.0
            err += (model - inset) ** 2
        if err < best_err:
            best, best_err = float(r), err
    return best


def to_srgb(im: Image.Image) -> Image.Image:
    """Browsers convert a PNG's embedded colour profile to sRGB when they draw it; do the same so the vector matches."""
    icc = im.info.get("icc_profile")
    if not icc:
        return im.convert("RGBA")
    converted = ImageCms.profileToProfile(
        im.convert("RGB"), ImageCms.ImageCmsProfile(io.BytesIO(icc)), ImageCms.createProfile("sRGB"),
        renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, outputMode="RGB",
    ).convert("RGBA")
    converted.putalpha(im.convert("RGBA").getchannel("A"))
    return converted


def trace(name: str, png: pathlib.Path, title: str, out_path: pathlib.Path) -> dict:
    im = to_srgb(Image.open(png))
    arr = np.array(im)
    opaque = arr[:, :, 3] >= 128
    w, h = im.size
    palette = find_palette(arr[:, :, :3], opaque, CARD_MERGE_DIST.get(name, MERGE_DIST))
    up = np.array(im.convert("RGB").resize((w * UPSCALE, h * UPSCALE), Image.LANCZOS))
    labels = smooth_labels(snap_to_palette(up, palette), len(palette), SMOOTH)
    flat = palette.astype(np.uint8)[labels]
    with tempfile.TemporaryDirectory() as d:
        src, svg = pathlib.Path(d) / "flat.png", pathlib.Path(d) / "traced.svg"
        Image.fromarray(flat).save(src)
        vtracer.convert_image_to_svg_py(
            str(src), str(svg), colormode="color", hierarchical="stacked", mode="spline",
            filter_speckle=80, color_precision=8, layer_difference=4, corner_threshold=int(os.environ.get("CORNER", 60)),
            length_threshold=float(os.environ.get("LENGTH", 6.0)), max_iterations=10, splice_threshold=45, path_precision=1,
        )
        traced = svg.read_text()
    body = "\n".join(re.findall(r"<path .*?/>", traced, flags=re.S))
    # The Figma raster card draws the PNG with preserveAspectRatio="xMidYMid meet" into 570 x 890; do the same.
    scale = min(570 / w, 890 / h) / UPSCALE
    tx, ty = (570 - w * UPSCALE * scale) / 2, (890 - h * UPSCALE * scale) / 2
    r = fit_corner_radius(opaque) * UPSCALE
    svg_text = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="57mm" height="89mm" viewBox="0 0 570 890" role="img" aria-labelledby="title">
<title id="title">{title}</title>
<desc>Vector card artwork traced from the Figma reference image: {len(palette)} flat colours, smooth curves, sharp at any zoom.</desc>
<defs><clipPath id="card-shape"><rect width="{w * UPSCALE}" height="{h * UPSCALE}" rx="{r:.1f}"/></clipPath></defs>
<g transform="translate({tx:.3f} {ty:.3f}) scale({scale:.6f})" clip-path="url(#card-shape)">
{body}
</g>
</svg>
'''
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(svg_text)
    return {"colors": len(palette), "paths": body.count("<path"), "kb": len(svg_text) // 1024}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="e.g. classic/red-skip")
    args = ap.parse_args()
    manifest = json.loads((SPECIALS / "manifest.json").read_text())
    for key, entry in manifest.items():
        if entry.get("rendering") != "raster" or (args.only and key != args.only):
            continue
        edition, card = key.split("/")
        existing = (ROOT / "public" / "cards" / edition / f"{card}.svg").read_text()
        title = re.search(r'<title id="title">(.*?)</title>', existing).group(1)
        info = trace(key, SPECIALS / entry["file"], title, OUT / edition / f"{card}.svg")
        print(f"{key:28s} {info['colors']:2d} colours {info['paths']:4d} paths {info['kb']:5d} KB")


if __name__ == "__main__":
    main()
