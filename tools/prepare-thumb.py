"""Crop any image to a 4:3 card thumbnail.

    python3 tools/prepare-thumb.py <source> <name>

Writes assets/work-<name>.jpg. The crop is centred on the brightest part of the
frame rather than the geometric middle, which is what you want for this work —
a lit projection on a dark wall, a lit desk in a dark room.
"""
import sys, os
from PIL import Image
import numpy as np

OUT_W, OUT_H = 800, 600
ASPECT = OUT_W / OUT_H

def main(src, name):
    im = Image.open(src).convert("RGB")
    w, h = im.size

    # luminance-weighted centroid, biased hard toward the bright areas
    small = im.resize((160, max(1, round(160 * h / w))))
    lum = np.array(small.convert("L"), dtype=np.float32) ** 3
    if lum.sum() > 0:
        cx = float((lum.sum(axis=0) * np.arange(lum.shape[1])).sum() / lum.sum()) / lum.shape[1]
        cy = float((lum.sum(axis=1) * np.arange(lum.shape[0])).sum() / lum.sum()) / lum.shape[0]
    else:
        cx = cy = 0.5

    if w / h > ASPECT:                      # too wide — trim the sides
        cw, ch = round(h * ASPECT), h
    else:                                   # too tall — trim top and bottom
        cw, ch = w, round(w / ASPECT)

    left = min(max(round(cx * w - cw / 2), 0), w - cw)
    top  = min(max(round(cy * h - ch / 2), 0), h - ch)

    out = im.crop((left, top, left + cw, top + ch)).resize((OUT_W, OUT_H), Image.LANCZOS)
    dest = os.path.join("assets", f"work-{name}.jpg")
    out.save(dest, quality=82, optimize=True, progressive=True)
    print(f"{dest}: {OUT_W}x{OUT_H} from {w}x{h}, focus ({cx:.2f}, {cy:.2f})")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
