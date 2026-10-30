"""
Re-centres the coloured face of the four Classic Draw Two PNGs inside their white card border.

In the Figma source images the face sits 24 px from the left border and 49 px from the right (and 50 px
from the top, 12 px from the bottom), so the border looks lopsided. This moves the face (and its corner
indices and oval) so the borders are equal, while the +2 tile stack stays centred on the card, as the
design intends. Run from tools/figma-cards:  python scripts/recenter-draw-two.py   (needs Pillow, numpy)
Originals are kept in scripts/reference-specials/figma-original/ so this is repeatable.
"""
import hashlib, json, pathlib
import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).parent
SPECIALS = HERE / "reference-specials"
ORIGINALS = SPECIALS / "figma-original"

FACE = {"yellow": (248, 200, 16), "red": (236, 28, 36), "green": (4, 156, 72), "blue": (8, 120, 200)}
STACK = {  # Figma's own bounds of the +2 tile stack (including shadows), from manifest.json
    "yellow": (249, 420, 565, 901), "red": (248, 420, 566, 901),
    "green": (247, 418, 567, 902), "blue": (248, 419, 566, 901),
}
X0, Y0, X1, Y1 = 24, 50, 764, 1246          # face rectangle in the 814 x 1259 image (inclusive)
RX, RY = 76, 66                              # face corner radii measured from the artwork
BORDER = np.array([226, 225, 225, 255], dtype=np.uint8)


def rounded_mask(w, h, rx, ry):
    yy, xx = np.mgrid[0:h, 0:w]
    px, py = xx + 0.5, yy + 0.5
    inside = np.ones((h, w), dtype=bool)
    for cx, cy in ((rx, ry), (w - rx, ry), (rx, h - ry), (w - rx, h - ry)):
        in_corner = ((px < rx) | (px > w - rx)) & ((py < ry) | (py > h - ry))
        near = (np.abs(px - cx) <= rx) & (np.abs(py - cy) <= ry)
        quad = in_corner & near & ((px < rx) == (cx == rx)) & ((py < ry) == (cy == ry))
        d = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2
        inside &= ~(quad & (d > 1))
    return inside


def dilate(mask, n):
    out = mask.copy()
    for _ in range(n):
        p = np.pad(out, 1)
        out = p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    return out


def stack_mask(src, color, grow=3):
    """The +2 tile stack: everything connected to its centre that is not flat face colour."""
    h, w = src.shape[:2]
    face = np.array(FACE[color])
    differs = np.abs(src[:, :, :3].astype(int) - face).max(2) > 30
    sx0, sy0, sx1, sy1 = STACK[color]
    seed = ((sx0 + sx1) // 2, (sy0 + sy1) // 2)
    assert differs[seed[1], seed[0]], "stack seed pixel should be a tile pixel"
    seen = np.zeros((h, w), dtype=bool)
    todo = [seed]
    seen[seed[1], seed[0]] = True
    while todo:
        x, y = todo.pop()
        for nx in (x - 1, x, x + 1):
            for ny in (y - 1, y, y + 1):
                if 0 <= nx < w and 0 <= ny < h and differs[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    todo.append((nx, ny))
    ys, xs = np.nonzero(seen)
    # sanity: the stack must be the same size Figma reports, i.e. we did not leak into the oval outline
    assert abs((xs.min() - sx0)) <= 6 and abs((xs.max() - sx1)) <= 6, (xs.min(), xs.max(), sx0, sx1)
    assert abs((ys.min() - sy0)) <= 6 and abs((ys.max() - sy1)) <= 6, (ys.min(), ys.max(), sy0, sy1)
    return dilate(seen, grow)


def recenter(color):
    src = np.array(Image.open(ORIGINALS / f"classic-{color}-draw-two.png").convert("RGBA"))
    h, w = src.shape[:2]
    fw, fh = X1 - X0 + 1, Y1 - Y0 + 1
    dx = round((w - fw) / 2) - X0            # +13: left/right borders become equal
    dy = round((h - fh) / 2) - Y0            # -19: top/bottom borders become equal
    face_mask = rounded_mask(fw, fh, RX, RY)
    out = src.copy()

    # 1. wipe the face from its old position with border colour
    old = np.zeros((h, w), dtype=bool)
    old[Y0 : Y1 + 1, X0 : X1 + 1] = dilate(face_mask, 2)
    out[old] = BORDER

    # 2. paste the face at its new, centred position
    patch = src[Y0 : Y1 + 1, X0 : X1 + 1]
    pm = dilate(face_mask, 1)
    region = out[Y0 + dy : Y1 + dy + 1, X0 + dx : X1 + dx + 1]
    region[pm] = patch[pm]

    # 3. the stack stays centred on the card horizontally and keeps its place relative to the face vertically.
    #    Its pixels are found by flood fill from the middle of the stack, so nothing else is moved.
    stack = stack_mask(src, color)
    face_px = np.array(FACE[color] + (255,), dtype=np.uint8)
    ys, xs = np.nonzero(stack)
    out[ys + dy, xs + dx] = face_px              # erase the stack that moved along with the face
    out[ys + dy, xs] = src[ys, xs]               # put the original back, shifted up only
    return Image.fromarray(out, "RGBA"), (dx, dy)


def main():
    manifest_path = SPECIALS / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for color in FACE:
        img, (dx, dy) = recenter(color)
        path = SPECIALS / f"classic-{color}-draw-two.png"
        img.save(path, optimize=True)
        entry = manifest[f"classic/{color}-draw-two"]
        entry["figmaPngSha256"] = hashlib.sha256((ORIGINALS / path.name).read_bytes()).hexdigest()
        entry["pngSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        entry["locallyRecentered"] = {"dx": dx, "dy": dy}
        print(f"{color}: face moved by ({dx:+d}, {dy:+d}) -> {entry['pngSha256'][:12]}")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
