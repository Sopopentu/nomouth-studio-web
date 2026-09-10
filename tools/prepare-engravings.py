"""Turn the scanned engravings into transparent, theme-tinted heart frames.

Alpha comes from ink density, so the paper background disappears on its own and
the figure letters survive. Run from the repo root:

    python3 tools/prepare-engravings.py
"""
from PIL import Image
import numpy as np
import os

SRC_DIR = "assets/source"
# The four scans are only two drawings — each was supplied once in red and once
# in black. Since every frame is baked in one ink and the white versions are
# made in CSS at runtime (`brightness(0) invert(1)` keeps the alpha and throws
# away the hue), only one scan per drawing is needed. The black scans are used
# because their ink is crisper than the red printings.
INK = (0xc6, 0x2a, 0x3c)
FRAMES = [
    ("Anatomical-Heart-Illustration-Black-GraphicsFairy.jpg", "heart-t1.png"),  # Fig. 37
    ("Vintage-BW-Anatomical-Heart-GraphicsFairy.jpg",         "heart-t2.png"),  # labelled plate
]

FLOOR, CEIL = 0.05, 0.46       # ink below FLOOR is paper, above CEIL is solid
TARGET_H = 560
ALPHA_STEPS = 20               # posterising alpha keeps the PNGs small; the
                               # hatching hides the banding at flicker speed

for src, out in FRAMES:
    im = Image.open(os.path.join(SRC_DIR, src)).convert("RGB")
    lum = np.array(im, dtype=np.float32).mean(axis=2) / 255.0

    ink = 1.0 - lum
    alpha = np.clip((ink - FLOOR) / (CEIL - FLOOR), 0.0, 1.0) ** 0.75

    # Flat RGB everywhere means downscaling can't drag paper colour into the
    # ink edges — the alpha channel carries all of the tone.
    rgba = np.zeros(lum.shape + (4,), dtype=np.uint8)
    rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2] = INK
    rgba[:, :, 3] = (alpha * 255).astype(np.uint8)

    img = Image.fromarray(rgba, "RGBA")

    # crop to the drawing, ignoring stray scanner speckle
    solid = np.array(img)[:, :, 3] > 40
    ys, xs = np.nonzero(solid)
    img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

    # downscale last, so dense hatching averages into smooth alpha
    w = round(img.width * TARGET_H / img.height)
    img = img.resize((w, TARGET_H), Image.LANCZOS)

    a = np.array(img)
    step = 255 / ALPHA_STEPS
    a[:, :, 3] = (np.round(a[:, :, 3] / step) * step).astype(np.uint8)
    img = Image.fromarray(a, "RGBA")

    img.save(os.path.join("assets", out), optimize=True)
    print(f"{out}: {img.width}x{img.height}")
