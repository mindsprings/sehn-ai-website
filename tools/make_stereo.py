# Autostereogram (Magic-Eye style) hiding the word "sehn".
# Textured pattern, shift method, grown outwards from a centre strip.
# Also writes a check image: disparity recovered by block matching should show the word.
import sys, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out = sys.argv[1]
W, H = 1200, 760
P = 120            # repeat width of the background
D = 12             # max depth shift in px (letters float in front)

dm = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(dm)
font = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", 300)
text = "sehn"
bb = d.textbbox((0, 0), text, font=font)
tx = (W - (bb[2] - bb[0])) // 2 - bb[0]
ty = (H - (bb[3] - bb[1])) // 2 - bb[1]
d.text((tx, ty), text, fill=255, font=font)
dm = dm.filter(ImageFilter.GaussianBlur(2))
Z = np.asarray(dm, dtype=np.float32) / 255.0
S = (P - np.round(Z * D)).astype(np.int32)

rng = np.random.default_rng(11)
pal = [(251, 247, 238), (231, 161, 182), (142, 47, 85), (243, 214, 223),
       (22, 32, 46), (205, 187, 156), (110, 42, 71), (185, 195, 208)]
tex = Image.new("RGB", (P, H), (236, 226, 205))
td = ImageDraw.Draw(tex)
for _ in range(int(P * H / 40)):
    x, y = rng.integers(0, P), rng.integers(0, H)
    r = int(rng.choice([1, 2, 3, 4, 6, 8], p=[.25, .3, .2, .13, .08, .04]))
    c = pal[rng.integers(0, len(pal))]
    for dx in (-P, 0, P):
        td.ellipse((x + dx - r, y - r, x + dx + r, y + r), fill=c)
tex = np.asarray(tex)

img = np.zeros((H, W, 3), dtype=np.uint8)
x0 = (W - P) // 2
img[:, x0:x0 + P] = tex
rows = np.arange(H)
for x in range(x0 + P, W):
    img[:, x] = img[rows, x - S[:, x - P // 2]]
for x in range(x0 - 1, -1, -1):
    img[:, x] = img[rows, x + S[:, min(x + P // 2, W - 1)]]
Image.fromarray(img).save(out, optimize=True)

g = img.astype(np.float32).sum(axis=2)
best = np.full((H, W), np.inf); arg = np.zeros((H, W))
k = np.ones(9) / 9
for s in range(P - D - 2, P + 3):
    diff = np.zeros((H, W)); diff[:, s:] = np.abs(g[:, s:] - g[:, :-s]); diff[:, :s] = 1e9
    diff = np.apply_along_axis(lambda r: np.convolve(r, k, "same"), 1, diff)
    diff = np.apply_along_axis(lambda c: np.convolve(c, k, "same"), 0, diff)
    m = diff < best; best[m] = diff[m]; arg[m] = P - s
chk = np.clip((arg + 2) / (D + 4) * 255, 0, 255).astype(np.uint8)
Image.fromarray(chk).save(out.replace(".png", "_check.png"))
print("saved", out)
