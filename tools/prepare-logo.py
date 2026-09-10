"""Prepare the studio logo for the hero.

    python3 tools/prepare-logo.py <source.png>

Writes assets/logo.png.

The source has a white outline stroked around the artwork, which hangs ~40px
below the lowest black pixel. On a white hero that outline is invisible
everywhere except the bottom, where it would sit as a white hairline between
the logo and the black band underneath it. So the bottom is squared off: every
column that ends in black is extended straight down to the crop line, and the
outline below it is discarded. The result has a hard black bottom edge that
merges into the black below with no seam.
"""
import sys, os
from PIL import Image
import numpy as np

OUT_W = 1500
SITE_BLACK = (0x0b, 0x06, 0x08)   # must match --black in main.css
REACH = 90        # a column is "part of the base" if its lowest black is this
                  # close to the crop line; stops gaps growing black spikes

def main(src):
    im = Image.open(src).convert("RGBA")
    a = np.array(im)
    al = a[:, :, 3]

    black = (a[:, :, 0] < 60) & (a[:, :, 1] < 60) & (a[:, :, 2] < 60) & (al > 128)
    rows = np.nonzero(black.any(axis=1))[0]
    cut = int(rows.max()) + 1                      # drop the outline below the black

    for x in range(a.shape[1]):
        col = np.nonzero(black[:cut, x])[0]
        if col.size and cut - col.max() <= REACH:
            a[col.max():cut, x] = (0, 0, 0, 255)   # run the black down to the cut

    a = a[:cut]

    # trim empty columns, keep whatever vertical space is left
    keep = np.nonzero((a[:, :, 3] > 40).any(axis=0))[0]
    a = a[:, keep.min():keep.max() + 1]

    # Remap the artwork's pure black to the site black, so where the logo meets
    # the band below there is no tonal step. White stays white: the transform
    # maps 0 -> SITE_BLACK and 255 -> 255, and anti-aliased edges ride along.
    rgb = a[:, :, :3].astype(np.float32)
    tgt = np.array(SITE_BLACK, dtype=np.float32)
    a[:, :, :3] = (tgt + (255.0 - tgt) * (rgb / 255.0)).round().astype(np.uint8)

    out = Image.fromarray(a, "RGBA")
    out = out.resize((OUT_W, round(out.height * OUT_W / out.width)), Image.LANCZOS)
    out.save("assets/logo.png", optimize=True)
    print(f"assets/logo.png: {out.width}x{out.height} (cut {im.height - cut}px of outline)")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
