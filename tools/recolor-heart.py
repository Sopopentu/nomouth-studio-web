"""Re-tint the source pixel heart into the site's red/white/black palette.
Run from the repo root:  python3 tools/recolor-heart.py
"""
from PIL import Image
import numpy as np

SRC = "assets/source/heartPixel.png"
OUT = "assets/heart.png"

# Core palette of the source art -> red/white/black theme
MAP = [
    ((173,  50,  50), (0xb0, 0x20, 0x30)),  # myocardium red
    ((218,  88,  99), (0xd9, 0x45, 0x5a)),  # red highlight
    ((215, 123, 186), (0xe8, 0xdc, 0xd6)),  # pulmonary artery -> bone white
    ((118,  66, 137), (0x6b, 0x15, 0x24)),  # right ventricle  -> deep maroon
    (( 91, 110, 225), (0x2b, 0x14, 0x1d)),  # great vessels    -> near black
    (( 99, 155, 255), (0x47, 0x1e, 0x2a)),  # coronary veins   -> dark maroon
    ((238, 195, 154), (0xf5, 0xef, 0xe9)),  # cut vessel ends  -> white
]
src_pal = np.array([m[0] for m in MAP], dtype=np.float32)
dst_pal = np.array([m[1] for m in MAP], dtype=np.uint8)

im = Image.open(SRC).convert("RGBA")
a = np.array(im)

# crop to content
alpha = a[:, :, 3]
ys, xs = np.nonzero(alpha > 90)
a = a[ys.min():ys.max()+1, xs.min():xs.max()+1]

rgb = a[:, :, :3].astype(np.float32)
solid = a[:, :, 3] >= 90

# nearest-neighbour quantise every solid pixel to the source palette,
# then swap in the themed colour
d = ((rgb[:, :, None, :] - src_pal[None, None, :, :]) ** 2).sum(axis=3)
idx = d.argmin(axis=2)

out = np.zeros(a.shape, dtype=np.uint8)
out[:, :, :3] = dst_pal[idx]
out[:, :, 3] = np.where(solid, 255, 0)

Image.fromarray(out, "RGBA").save(OUT)
print("wrote", OUT, out.shape[1], "x", out.shape[0])
