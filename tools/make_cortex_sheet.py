# Keyframe sheet for the next part of the dive: out of the retina, through the optic nerve, the chiasm and the LGN,
# into the visual cortex (V1, V2, V4). A first draft to paint over: rough grey sketches on the depth layers,
# camera moves on 'camera', the reasoning on 'notes'. Hide or clear any layer and draw your own.
#   python tools/make_cortex_sheet.py [outdir]      (default: lab/dive/keyframes)
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter
from make_keyframe_template import Sheet, FW, FH, INK, sans

BEATS = [
    ("01", "BLIND SPOT LAKE", "leaving the retina: every fibre drains to the disc", "after the river"),
    ("02", "THE NERVE", "a tracking shot along the cable, not a tunnel", "quick"),
    ("03", "CHIASM", "Cajal's crossing: half the fibres change sides", "quick"),
    ("04", "LGN", "the knee: six layers, the eyes kept apart", "quick"),
    ("05", "RADIATION", "fanning out under the cortex, rising", "quick"),
    ("06", "V1", "the layers as storeys; 'How it works' starts here", "content"),
    ("07", "V2", "the same forest, larger: boundaries completed", "content"),
    ("08", "V4", "surfaces fill in, and the figure lifts off", "content"),
    ("09", "REST", "V1, V2, V4 terraced; the boat comes back by capillary", "end"),
    ("10", "PANEL REVEAL", "how the second half's content arrives: a Kanizsa square", "content, each panel"),
    ("11", "THE CANAL", "a capillary in grey matter, high banks", "detail"),
    ("12", "FREE", "", ""),
]
INTRO = ["Draft by Claude: grey sketches on the depth layers, camera moves on 'camera', reasoning on 'notes'. Paint over, hide or replace.",
         "Colour: the retina keeps its yellow; the cortex is grey (Cajal's silver), colour only in fibres (rose = this eye, teal = the other), "
         "blood, and V4. 01-05 are quick. Refs: moodboard/cortex/."]
NOTES = [
    "From the river we rise back to the roof (ganglion fibres, layer I). Seen from above, every fibre flows to the blind spot lake, "
    "arching around the fovea, and pours over its rim; vessels come up out of its middle. The camera spirals down with them.",
    "Not a tunnel: we track alongside the optic nerve, a cable of a million fibres. Behind the eye they put on myelin, beaded "
    "like sausages (that is why the disc looks pale). A screen or two at most; big blurred tubes whip past in front.",
    "After Cajal's 1898 chiasm (moodboard/cortex/Cajal_1898_Fig6). The other eye's nerve comes in, teal. Fibres from the inner half "
    "of each retina cross, the outer half stays: behind it every tract carries both colours. We ride the crossing ones. Plate II starts.",
    "The lateral geniculate ('knee-shaped'): six bent layers, the two eyes in alternating bands (ours in 1, 4, 6). The two lowest have "
    "big cells (motion), the four upper small ones (form, colour). Fibres end in their own band; a new fan of axons leaves the top.",
    "The optic radiation fans out through the white matter (some swing forward in Meyer's loop) to the back of the head. "
    "The cortex hangs above like a ceiling. In the retina light fell from above; here the signal rises from below, and so do we.",
    "V1 edge on, Cajal's layers as storeys. Layer 4 glows (the stripe of Gennari): LGN fibres flower among star-shaped cells, still in "
    "alternating eye columns. Pyramidal cells are the trees, trunks up to a matted canopy in layer 1; in 2/3 long horizontal vines link "
    "trees of the same orientation. 3B, where the colours meet, is there but small (binocular depth: roadmap).",
    "V2 repeats V1's circuit at a larger scale (Grossberg 2021, fig. 5): fewer, bigger trees, much longer vines. Its bipole cells "
    "complete boundaries across gaps: four pac-man canopies, and the missing edges of a Kanizsa square drawn in between them. "
    "Boundaries are invisible: we see the square, yet no line is there. The ground is striped (thin, pale, thick stripes).",
    "V4, where colour lives (Zeki): the grey cortex gets its colour here. The surface fills in: colour spreads outward, unoriented, until a "
    "boundary stops it, a watercolour wash with pooled edges. Grossberg stacks these filling-in domains by depth (2016, fig. 6): a "
    "multiplane camera in the brain. The filled square lifts onto a nearer plane: figure from ground, from a single image. The climax.",
    "Rest view under the footer: V1 near, V2 and V4 terraced behind it, each larger, V4's coloured surface far off. The little eye "
    "comes back into the scene the way it left: on a capillary, a narrow canal with high banks across the front (see 11). Labels as "
    "Plate II (after Cajal) and Plate III (after Grossberg); the folded legend explains both.",
    "Anton's idea: from V2 on, each content panel arrives as a Kanizsa square. (a) Four pac-men, mouths in, around where the panel "
    "will be. (b) The boundary completes between them. (c) Paper colour fills in from the corners (where the mouths make contrast) and "
    "floods inward until the boundary holds it. (d) The panel, pac-men left as corner marks. A boundary with a gap leaks (2016, fig. 7).",
    "Brain capillaries are walled: endothelial cells sealed by tight junctions (the blood-brain barrier), pericytes clinging to the "
    "wall, astrocyte end-feet gripping it like roots (a rhyme with the retina's Müller mangroves). The channel is so narrow the "
    "red-cell boat squeezes into a bell shape (moodboard/cortex/cap_Microvessel). Grey matter has far more of them than white.",
    "",
]

ROSE, TEAL = (196, 124, 148, 235), (88, 146, 146, 235)   # a little muted: the cortex is grey
RED, PLASMA = (150, 38, 44, 230), (214, 140, 130, 150)
GLOW = (250, 249, 245, 235)   # myelin is white: the stripe of Gennari, the illusory square's brighter edge
WASH = [(236, 168, 122, 120), (231, 161, 182, 120), (240, 205, 120, 110)]
PAPER = (246, 240, 227, 235)
SKY = {"retina": (244, 228, 176, 255), "cortex": (224, 222, 218, 255)}


def grey(v, a=225):
    return (v, v, v - 6, a)


FAR, MID, NEAR, FG = grey(176, 190), grey(128), grey(84), grey(44, 235)
rnd = random.Random(7)


def curve(pts, n=14):
    """Catmull-Rom through the points, so a few control points make a smooth stroke."""
    if len(pts) < 3:
        (x0, y0), (x1, y1) = pts
        return [(x0 + (x1 - x0) * t / n, y0 + (y1 - y0) * t / n) for t in range(n + 1)]
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(p) - 2):
        a, b, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(n):
            t = k / n
            out.append(tuple(0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t +
                                    (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t ** 3) for j in (0, 1)))
    out.append(pts[-1])
    return out


class Frame:
    """Drawing in one frame's own coordinates (0..1280, 0..720), each layer on its own canvas, so nothing spills out of the frame."""

    def __init__(self, names):
        self.img = {n: Image.new("RGBA", (FW, FH), (0, 0, 0, 0)) for n in names}
        self.d = {n: ImageDraw.Draw(img) for n, img in self.img.items()}

    def paste(self, layers, x, y):
        for n, img in self.img.items():
            layers[n].alpha_composite(img, (x, y))

    def P(self, pts):
        return list(pts)

    def brush(self, layer, pts, w, col, smooth=True):
        pts = curve(pts) if smooth and len(pts) > 1 else pts
        P = self.P(pts)
        self.d[layer].line(P, fill=col, width=int(w), joint="curve")
        for x, y in (P[0], P[-1]):
            self.d[layer].ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=col)

    def dots(self, layer, pts, w, col, step=26, outline=None):
        """A dotted line along a curve (boundaries that are there, but invisible)."""
        c = curve(pts, 40)
        acc, last = 0, c[0]
        for x, y in c[1:]:
            acc += math.hypot(x - last[0], y - last[1])
            last = (x, y)
            if acc >= step:
                acc = 0
                self.disc(layer, x, y, w / 2, col, outline=outline, width=2 if outline else 0)

    def disc(self, layer, x, y, r, col, outline=None, width=0):
        (X, Y), = self.P([(x, y)])
        self.d[layer].ellipse([X - r, Y - r, X + r, Y + r], fill=col, outline=outline, width=width)

    def ring(self, layer, x, y, r, col, w):
        (X, Y), = self.P([(x, y)])
        self.d[layer].ellipse([X - r, Y - r, X + r, Y + r], outline=col, width=w)

    def poly(self, layer, pts, col):
        self.d[layer].polygon(self.P(pts), fill=col)

    def arrow(self, pts, w=7, col=INK):
        """A camera move: a stroke with a head at the end."""
        c = curve(pts, 30)
        self.d["camera"].line(self.P(c), fill=col, width=w, joint="curve")
        (x1, y1), (x0, y0) = c[-1], c[-6]
        a = math.atan2(y1 - y0, x1 - x0)
        head = [(x1, y1), (x1 - 34 * math.cos(a - 0.45), y1 - 34 * math.sin(a - 0.45)),
                (x1 - 34 * math.cos(a + 0.45), y1 - 34 * math.sin(a + 0.45))]
        self.d["camera"].polygon(self.P(head), fill=col)

    def label(self, x, y, text, size=26, col=INK):
        (X, Y), = self.P([(x, y)])
        self.d["notes"].text((X, Y), text, font=sans(size), fill=col)

    # small recurring things
    def pyramid(self, layer, x, y, top, col, w=6, size=22, tuft=70):
        """A pyramidal cell: triangular body, apical trunk up to a tuft, basal dendrites splaying, an axon down."""
        self.poly(layer, [(x - size * 0.7, y + size * 0.5), (x + size * 0.7, y + size * 0.5), (x, y - size)], col)
        self.brush(layer, [(x, y - size), (x + rnd.uniform(-8, 8), (y + top) / 2), (x + rnd.uniform(-10, 10), top + 20)], w, col)
        for k in range(5):
            a = -math.pi / 2 + (k - 2) * 0.45
            self.brush(layer, [(x, top + 20), (x + math.cos(a) * tuft * 0.5, top + 20 + math.sin(a) * 18),
                               (x + math.cos(a) * tuft, top + rnd.uniform(-6, 10))], max(2, w - 3), col)
        for s in (-1, 1):
            self.brush(layer, [(x + s * size * 0.5, y + size * 0.4), (x + s * size * 1.6, y + size * 1.1),
                               (x + s * size * 2.4, y + size * 0.9 + rnd.uniform(-6, 12))], max(2, w - 3), col)
        self.brush(layer, [(x, y + size * 0.5), (x + rnd.uniform(-6, 6), y + size * 3.2)], max(2, w - 4), col)

    def star(self, layer, x, y, r, col, w=4, n=7):
        for k in range(n):
            a = k / n * 2 * math.pi + rnd.uniform(-0.2, 0.2)
            self.brush(layer, [(x, y), (x + math.cos(a) * r * 0.6, y + math.sin(a) * r * 0.6 + 4), (x + math.cos(a) * r, y + math.sin(a) * r)], w, col)
        self.disc(layer, x, y, w * 1.6, col)

    def arbor(self, layer, x, y, col, spread=40, w=4):
        """A fibre's ending: a little bush of branches."""
        for k in range(6):
            a = -math.pi / 2 + rnd.uniform(-1.2, 1.2)
            r = rnd.uniform(0.5, 1) * spread
            self.brush(layer, [(x, y), (x + math.cos(a) * r * 0.5, y + math.sin(a) * r * 0.5), (x + math.cos(a) * r, y + math.sin(a) * r)], w, col)


def blind_spot_lake(f):
    disc, fovea = (900, 350), (330, 390)
    for k in range(70):   # the ganglion roof's honeycomb, far below the fibres
        f.ring("far", rnd.uniform(0, FW), rnd.uniform(0, FH), rnd.uniform(14, 30), FAR, 4)
    f.ring("near", *fovea, 46, NEAR, 6)
    f.disc("near", *fovea, 14, NEAR)
    # fibres from beyond the fovea arch above and below it; the rest come straight in
    for k in range(6):
        s, r = (-1, 1)[k % 2], 70 + 34 * (k // 2)
        f.brush("mid", [(40, fovea[1] + s * (r - 50)), (fovea[0] - 40, fovea[1] + s * r), (fovea[0] + 160, fovea[1] + s * (r + 20)),
                        (disc[0] - 160, disc[1] + s * r * 0.5), (disc[0] - 70, disc[1] + s * 30)], 9, ROSE)
    for a in range(-140, 160, 22):
        if abs(a) > 140 or -30 < a < 30:
            continue
        r = math.radians(a + 180)
        f.brush("mid", [(disc[0] - math.cos(r) * 520, disc[1] + math.sin(r) * 420), (disc[0] - math.cos(r) * 230, disc[1] + math.sin(r) * 190),
                        (disc[0] - math.cos(r) * 85, disc[1] + math.sin(r) * 80)], 9, ROSE)
    f.disc("near", *disc, 92, (246, 236, 214, 235), outline=NEAR, width=7)
    for a in (-60, -25, 15, 160, 200, 235):   # the vessels, out of the lake's middle
        r = math.radians(a)
        f.brush("near", [disc, (disc[0] + math.cos(r) * 150, disc[1] + math.sin(r) * 120 + 20),
                         (disc[0] + math.cos(r) * 420, disc[1] + math.sin(r) * 300)], 8, RED)
    f.arrow([(1180, 640), (1120, 520), (980, 470), (860, 430), (850, 360), (900, 330), (920, 360)])
    f.label(fovea[0] - 46, fovea[1] + 56, "fovea")
    f.label(disc[0] - 110, disc[1] + 100, "blind spot lake")


def nerve(f):
    for y in (150, 570):
        f.brush("far", [(-20, y), (400, y + 20), (800, y - 14), (1300, y + 10)], 16, FAR)
    for k in range(10):   # the cable: beaded fibres, gaps at the nodes
        y0 = 230 + k * 28 + rnd.uniform(-5, 5)
        col = ROSE if k % 3 else (178, 96, 128, 235)
        x = -rnd.uniform(0, 120)
        while x < FW:
            seg = rnd.uniform(90, 140)
            y = y0 + 22 * math.sin((x + seg / 2) / 260)
            f.brush("mid", [(x, y), (x + seg, y0 + 22 * math.sin((x + seg) / 260))], 18, col)
            x += seg + 14
    for x, y, L in ((80, 690, 360), (760, 700, 420), (980, 30, 380)):
        f.brush("fg", [(x, y), (x + L, y - 6)], 70, FG)
    f.arrow([(380, 520), (640, 515), (900, 505)], 8)
    f.label(910, 480, "tracking")


def chiasm(f):
    c = (640, 380)
    for k in range(4):
        o = (k - 1.5) * 16
        # ours (rose) from below left: the inner two (nearer the middle) cross to the right tract, the outer two stay left
        to = (1000 + (k - 2) * 16, -20) if k >= 2 else (240 + k * 16, -20)
        f.brush("mid", [(160 + o, 740), (420 + o, 560), (c[0] - 10 + o * 0.5, c[1] + o * 0.5), ((to[0] + c[0]) / 2, 170), to], 12, ROSE)
        # the other eye's (teal), from below right, the mirror image: in each tract the two colours run side by side
        to = (280 + (1 - k) * 16, -20) if k < 2 else (1040 + (k - 2) * 16, -20)
        f.brush("mid", [(1120 + o, 740), (860 + o, 560), (c[0] + 10 + o * 0.5, c[1] - o * 0.5), ((to[0] + c[0]) / 2, 170), to], 12, TEAL)
    f.arrow([(230, 700), (440, 545), (600, 410), (730, 300), (880, 150)])
    f.label(60, 640, "our eye")
    f.label(1100, 640, "the other eye")
    f.label(110, 30, "left tract")
    f.label(1050, 30, "right tract")


def lgn(f):
    c, eye = (640, 930), [ROSE, TEAL, TEAL, ROSE, TEAL, ROSE]   # layers 1..6, bottom up: ours in 1, 4, 6
    for k in range(6):
        r = 330 + k * 56
        box = f.P([(c[0] - r, c[1] - r), (c[0] + r, c[1] + r)])
        tint = eye[k][:3] + (90,)
        f.d["mid"].arc([box[0], box[1]], 200, 340, fill=tint, width=40)
        for a in range(204, 338, 5 if k < 2 else 3):   # relay cells: big ones below, small above
            t = math.radians(a + rnd.uniform(-1, 1))
            f.disc("near", c[0] + math.cos(t) * r, c[1] + math.sin(t) * r, 7 if k < 2 else 4, NEAR)
    for k in range(14):   # fibres in from below, each ending in its own eye's band
        x = 420 + k * 34
        band = rnd.choice([i for i in range(6) if eye[i] == (ROSE if k % 2 else TEAL)])
        r = 330 + band * 56
        y = c[1] - math.sqrt(max(0, r * r - (x - c[0]) ** 2))
        f.brush("near", [(x + (k - 7) * 18, 740), (x + (k - 7) * 6, (740 + y) / 2), (x, y)], 6, ROSE if k % 2 else TEAL)
        f.arbor("near", x, y, ROSE if k % 2 else TEAL, 24, 3)
    for k in range(16):   # and the radiation, out of the top
        x = 320 + k * 42
        f.brush("far", [(x, 360 + abs(k - 7.5) * 14), (x + (k - 7.5) * 14, 180), (x + (k - 7.5) * 40, -20)], 6, FAR)
    f.arrow([(640, 700), (650, 520), (640, 300), (650, 120)])
    for k in range(6):   # the layers' numbers, on the knee's right shoulder
        t = math.radians(304)
        f.label(c[0] + math.cos(t) * (330 + k * 56) + 18, c[1] + math.sin(t) * (330 + k * 56) - 16, str(k + 1), 24)


def radiation(f):
    for y in range(470, 720, 26):   # white matter
        f.brush("far", [(-10, y), (640, y + rnd.uniform(-10, 10)), (1290, y)], 3, FAR)
    for k in range(16):
        x1 = 80 + k * 76
        if k < 4:   # Meyer's loop: out forward first, then back
            pts = [(60 + k * 20, 740), (300 + k * 40, 600), (180 + k * 30, 470), (x1 * 0.6 + 200, 260), (x1, 140)]
        else:
            pts = [(60 + k * 20, 740), (260 + k * 30, 560 - k * 6), (x1 - 40, 300), (x1, 140)]
        f.brush("mid", pts, 8, MID)
    f.brush("near", [(-20, 104), (400, 96), (900, 110), (1300, 100)], 10, NEAR)
    for x in range(30, 1280, 64):   # layer 6, seen from below
        f.poly("near", [(x - 13, 112), (x + 13, 112), (x, 82)], NEAR)
        f.brush("near", [(x, 112), (x + 4, 148)], 3, NEAR)
    f.arrow([(820, 690), (830, 520), (860, 330), (880, 170)])
    f.label(200, 495, "Meyer's loop")
    f.label(960, 40, "the cortex, from below")


def v1(f, scale=1.0):
    L = {"1": 30, "2/3": 120, "3B": 270, "4": 330, "5": 470, "6": 560, "wm": 650}
    # far: a thin forest
    for x in range(20, 1280, 46):
        f.pyramid("far", x + rnd.uniform(-10, 10), rnd.choice([250, 500]), 50, FAR, 3, 10, 30)
    # layer 4: the stripe of Gennari glows; LGN fibres flower into it in alternating eye columns
    f.brush("mid", [(-20, 352), (640, 346), (1300, 354)], 26, GLOW)
    for col in range(6):
        eye = ROSE if col % 2 == 0 else TEAL
        for k in range(4):
            x = col * 220 + 30 + k * 46
            f.brush("near", [(x - 20, 740), (x - 6, 560), (x, 410)], 4, eye)
            f.arbor("near", x, 410, eye, 34, 3)
    for k in range(16):
        f.star("mid", 40 + k * 80 + rnd.uniform(-20, 20), 395 + rnd.uniform(-15, 20), 22, MID, 3)
    # the trees: pyramidal cells in 2/3 and 5, trunks up to the canopy of layer 1
    for x, y in ((150, 230), (410, 500), (600, 220), (830, 520), (1010, 240), (1180, 500)):
        f.pyramid("mid", x, y, L["1"] + 10, MID, 7, 24, 80)
    # 2/3: long horizontal vines between trees of a kind
    for y, x0, x1 in ((180, 150, 600), (200, 600, 1010), (160, 150, 1010)):
        f.brush("near", [(x0, y + 50), ((x0 + x1) / 2, y + rnd.uniform(-20, 20)), (x1, y + 50)], 4, NEAR)
    # layer 1: the matted canopy
    for k in range(8):
        f.brush("fg", [(-20, 24 + k * 6), (300, 34 + k * 5), (700, 20 + k * 7), (1300, 30 + k * 4)], 3, FG)
    # 3B: where the two colours first meet (small: binocular depth is on the roadmap)
    f.brush("near", [(900, 740), (910, 500), (930, 300)], 4, ROSE)
    f.brush("near", [(990, 740), (970, 500), (940, 300)], 4, TEAL)
    f.disc("near", 935, 292, 11, NEAR, outline=GLOW, width=4)
    # near trunks framing the view
    f.brush("fg", [(20, 740), (34, 300), (16, -20)], 46, FG)
    f.brush("fg", [(1250, 740), (1236, 380), (1262, -20)], 38, FG)
    for name, y in L.items():
        if name != "wm":
            f.label(80, y + 16, name, 24)
    f.label(948, 270, "3B", 22)


def kanizsa(f, cx, cy, hx, layer, r=70, col=FG, hy=None, mouths=False):
    """Four pac-men on the corners of a rectangle, mouths facing its middle (or, mouths=True, only the mouths, filled)."""
    hy = hy or hx
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        m = math.degrees(math.atan2(-sy, -sx)) - 45   # the missing quarter, towards the middle
        (X, Y), = f.P([(cx + sx * hx, cy + sy * hy)])
        a, b = (m, m + 90) if mouths else (m + 90, m + 360)
        f.d[layer].pieslice([X - r, Y - r, X + r, Y + r], a, b, fill=col)


def boundary(f, cx, cy, hx, hy, r, layer="camera", w=12):
    """The completed edges between the pac-men's mouths: bright, but drawn as dots (boundaries are invisible)."""
    for (ax, ay), (bx, by) in (((-hx + r, -hy), (hx - r, -hy)), ((hx, -hy + r), (hx, hy - r)),
                               ((hx - r, hy), (-hx + r, hy)), ((-hx, hy - r), (-hx, -hy + r))):
        f.dots(layer, [(cx + ax, cy + ay), (cx + bx, cy + by)], w, GLOW, w * 1.9, outline=NEAR)


def v2(f):
    for x in range(40, 1280, 90):
        f.pyramid("far", x + rnd.uniform(-20, 20), rnd.choice([300, 520]), 40, FAR, 4, 14, 50)
    for x, y in ((170, 450), (640, 520), (1100, 430)):   # fewer, bigger trees
        f.pyramid("mid", x, y, 40, MID, 12, 40, 140)
    for y in (230, 260, 290):   # much longer vines
        f.brush("near", [(-20, y + 30), (320, y - 20), (640, y + 10), (960, y - 25), (1300, y + 20)], 5, NEAR)
    x = 0
    for k in range(15):   # the ground in stripes: thin, pale, thick
        w = (55, 120, 80)[k % 3]
        f.brush("far", [(x, 690), (x + w, 690)], 30, grey(150 if k % 3 == 1 else 112, 150))
        x += w + 36
    cx, cy, h = 640, 330, 170
    kanizsa(f, cx, cy, h, "fg")
    boundary(f, cx, cy, h, h, 70)
    f.label(cx + h + 90, cy - 20, "bipoles complete the edges")


def v4(f):
    for x in range(60, 1280, 150):
        f.pyramid("far", x + rnd.uniform(-20, 20), 560, 30, FAR, 6, 24, 90)
    cx, cy, h = 600, 360, 200
    # the shadow it leaves on the ground plane, then the filled square, lifted onto a nearer plane
    f.poly("mid", [(cx - h + 30, cy - h + 40), (cx + h + 30, cy - h + 40), (cx + h + 30, cy + h + 40), (cx - h + 30, cy + h + 40)], grey(120, 90))
    sq = [(cx - h - 20, cy - h - 30), (cx + h - 20, cy - h - 30), (cx + h - 20, cy + h - 30), (cx - h - 20, cy + h - 30)]
    for k in range(26):   # washes spreading out from the edges, stopped at the boundary
        side = k % 4
        t = rnd.uniform(0.1, 0.9)
        (ax, ay), (bx, by) = sq[side], sq[(side + 1) % 4]
        x, y = ax + (bx - ax) * t, ay + (by - ay) * t
        x += (cx - 20 - x) * rnd.uniform(0.1, 0.5)
        y += (cy - 30 - y) * rnd.uniform(0.1, 0.5)
        r = rnd.uniform(50, 110)
        x0, y0, x1, y1 = max(sq[0][0], x - r), max(sq[0][1], y - r), min(sq[2][0], x + r), min(sq[2][1], y + r)
        f.d["fg"].ellipse(f.P([(x0, y0), (x1, y1)]), fill=rnd.choice(WASH))
    f.d["fg"].rectangle(f.P([sq[0], sq[2]]), outline=(176, 92, 110, 220), width=9)   # the pooled edge
    kanizsa(f, cx - 20, cy - 30, h, "fg", 80)
    for a in (0, 90, 180, 270, 45, 135, 225, 315):   # filling-in: outward, unoriented
        r = math.radians(a)
        f.arrow([(cx - 20 + math.cos(r) * 30, cy - 30 + math.sin(r) * 30), (cx - 20 + math.cos(r) * 120, cy - 30 + math.sin(r) * 120)], 4)
    f.arrow([(cx + h + 120, cy + h + 10), (cx + h + 40, cy + h - 60)], 6)
    f.label(cx + h + 60, cy + h + 20, "lifts onto a nearer plane")


def canal(f, path, w0, w1, upper, lower, bank=0.55, astro=0):
    """A brain capillary winding along a path (biology has no straight lines), its lumen w0 wide at the start and w1 at
    the end: high banks of endothelial cells sealed by tight junctions, plasma between, pericytes clinging to the wall,
    and (astro > 0, their size) astrocyte end-feet gripping it from above. Returns a function u -> (x, y, angle, width)."""
    c = curve(path, 40)
    L = [0]
    for i in range(1, len(c)):
        L.append(L[-1] + math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]))
    T, N, W = [], [], []
    for i in range(len(c)):
        (ax, ay), (bx, by) = c[max(0, i - 1)], c[min(len(c) - 1, i + 1)]
        d = math.hypot(bx - ax, by - ay) or 1
        T.append(((bx - ax) / d, (by - ay) / d))
        N.append(((by - ay) / d, -(bx - ax) / d))   # pointing to the upper bank, for a path going right
        W.append(w0 + (w1 - w0) * L[i] / L[-1])

    def edge(i, side, extra=0.0):
        k = side * (W[i] / 2 + extra * W[i])
        return c[i][0] + N[i][0] * k, c[i][1] + N[i][1] * k

    f.d[upper].polygon([edge(i, 1) for i in range(len(c))] + [edge(i, -1) for i in reversed(range(len(c)))], fill=PLASMA)
    for side, layer, tone in ((1, upper, 150), (-1, lower, 112)):
        i0 = 0
        while i0 < len(c) - 2:
            i1, length = i0, W[i0] * rnd.uniform(0.6, 0.9)   # cells as long as the channel is wide
            while i1 < len(c) - 1 and L[i1] - L[i0] < length:
                i1 += 1
            span = range(i0, i1 + 1)
            u = [(L[j] - L[i0]) / max(1e-6, L[i1] - L[i0]) for j in span]
            outer = [edge(j, side, bank * (0.6 + 0.4 * math.sin(math.pi * uj))) for j, uj in zip(span, u)]   # a plump cell
            f.d[layer].polygon([edge(j, side) for j in span] + outer[::-1], fill=grey(tone, 240), outline=NEAR, width=max(1, int(W[i0] / 50)))
            m = (i0 + i1) // 2
            nx, ny = edge(m, side, bank * 0.45)
            r = W[m] * bank * 0.22
            f.d[layer].ellipse([nx - r, ny - r, nx + r, ny + r], fill=grey(tone - 30, 240))   # its nucleus
            for k in range(3):   # the tight junction: stitches across the seam to the next cell
                sx, sy = edge(i1, side, bank * (0.2 + 0.2 * k))
                tx, ty = T[i1][0] * W[i1] * 0.06, T[i1][1] * W[i1] * 0.06
                f.d[layer].line([sx - tx, sy - ty, sx + tx, sy + ty], fill=FG, width=max(1, int(W[i1] / 60)))
            i0 = i1
    for u in (rnd.uniform(0.15, 0.3), rnd.uniform(0.55, 0.75)):   # pericytes on the upper wall, arms along it
        i = int(u * (len(c) - 1))
        x, y = edge(i, 1, bank * 1.05)
        r = W[i] * 0.2
        f.d[upper].ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=grey(96, 240))
        for di in (-1, 1):
            arm = [edge(min(len(c) - 1, max(0, i + di * k * 4)), 1, bank * 1.0) for k in range(5)]
            f.brush(upper, arm, max(2, W[i] / 30), grey(96, 240), smooth=False)
    if astro:   # astrocytes above the upper bank, their feet planted on it
        step = int(len(c) * astro * 260 / L[-1]) or 1
        for i in range(step // 2, len(c), step):
            top = edge(i, 1, bank)
            sx, sy = top[0] + N[i][0] * 110 * astro, top[1] + N[i][1] * 110 * astro
            f.star(upper, sx, sy, 40 * astro, NEAR, max(3, int(5 * astro)))
            for di in (-step // 4, 0, step // 4):
                j = min(len(c) - 1, max(0, i + di))
                fx, fy = edge(j, 1, bank * 0.95)
                f.brush(upper, [(sx, sy), ((sx + fx) / 2 + rnd.uniform(-8, 8), (sy + fy) / 2), (fx, fy)], max(3, int(6 * astro)), NEAR)
                f.d[upper].ellipse([fx - 16 * astro, fy - 9 * astro, fx + 16 * astro, fy + 9 * astro], fill=NEAR)   # the end-foot

    def along(u):
        i = min(len(c) - 1, int(u * (len(c) - 1)))
        return c[i][0], c[i][1], math.atan2(T[i][1], T[i][0]), W[i]
    return along


def boat(f, layer, x, y, h, angle=0.0):
    """The red-cell boat, squeezed into a bell by the narrow channel (heading along angle), and the little eye on board."""
    w = h * 1.15
    front = [(w * 0.5 * math.cos(math.radians(a)), h * 0.5 * math.sin(math.radians(a))) for a in range(-90, 91, 10)]
    rear = [(-w * 0.25, h * 0.5), (-w * 0.42, h * 0.36), (-w * 0.34, 0), (-w * 0.42, -h * 0.36), (-w * 0.25, -h * 0.5)]   # a shallow dimple, not a mouth
    ca, sa = math.cos(angle), math.sin(angle)
    at = lambda px, py: (x + px * ca - py * sa, y + px * sa + py * ca)
    f.d[layer].polygon([at(px, py) for px, py in front + rear], fill=RED)
    r = h * 0.2
    for dx, rr, col in ((0, r, (246, 236, 214, 255)), (r * 0.25, r * 0.5, ROSE), (r * 0.3, r * 0.2, FG)):
        ex, ey = at(w * 0.05 + dx, -h * 0.08)
        f.disc(layer, ex, ey, rr, col, outline=FG if rr == r else None, width=3 if rr == r else 0)


def rest(f):
    # V4 far and big, with its coloured surface; V2 in the middle; V1 near and fine
    for x in range(-40, 1320, 260):
        f.pyramid("far", x, 280, -10, FAR, 10, 36, 150)
    f.d["far"].ellipse(f.P([(420, 250), (980, 310)]), fill=WASH[0])
    for x in range(0, 1300, 130):
        f.pyramid("mid", x + 40, 420, 190, MID, 6, 20, 80)
    for x in range(0, 1300, 60):
        f.pyramid("near", x + 20, 540, 400, NEAR, 4, 11, 40)
    # the capillary winds through the bottom layer into the distance, as the river did in the retina; the boat on it
    along = canal(f, [(-60, 736), (240, 690), (470, 702), (720, 660), (930, 612), (800, 576), (600, 562), (680, 548), (860, 540)], 110, 8, "near", "fg", 0.42)
    x, y, a, w = along(0.14)
    boat(f, "fg", x, y, w * 0.9, a)
    for y, t in ((280, "V4"), (420, "V2"), (540, "V1")):
        f.label(30, y - 30, t, 30)
    for y, t in ((190, "Pyr."), (330, "St."), (470, "Bp.")):
        f.dots("notes", [(990, y + 14), (1130, y + 14)], 6, INK, 12)
        f.label(1140, y, t, 26)
    f.arrow([(130, 640), (360, 615), (560, 600)], 6)
    f.label(380, 570, "back in, by capillary")


def panel_reveal(f):
    for k, (ox, oy) in enumerate(((0, 0), (640, 0), (0, 360), (640, 360))):
        for x in range(ox + 30, ox + 640, 70):   # a bit of cortex behind every step
            f.pyramid("far", x + rnd.uniform(-10, 10), oy + 300, oy + 30, FAR, 3, 10, 30)
        cx, cy, hx, hy, r = ox + 320, oy + 190, 200, 105, 34
        if k == 3:   # (d) the panel, with its content; the pac-men stay as corner marks
            f.d["near"].rectangle([cx - hx, cy - hy, cx + hx, cy + hy], fill=PAPER, outline=(214, 200, 176, 255), width=6)
            for j, w in enumerate((260, 340, 300, 180)):
                f.brush("near", [(cx - hx + 40, cy - hy + 50 + j * 40), (cx - hx + 40 + w, cy - hy + 50 + j * 40)], 12 if j else 18, grey(150))
            kanizsa(f, cx, cy, hx, "fg", 18, hy=hy)
        else:
            if k == 2:   # (c) paper colour fills in from the mouths, inward, until the boundary holds it
                kanizsa(f, cx, cy, hx, "near", 92, PAPER, hy, mouths=True)
                for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                    f.arrow([(cx + sx * (hx - 50), cy + sy * (hy - 40)), (cx + sx * (hx - 140), cy + sy * (hy - 85))], 4)
            if k >= 1:   # (b) the boundary completes between them
                boundary(f, cx, cy, hx, hy, r, w=9)
            kanizsa(f, cx, cy, hx, "fg", r, hy=hy)   # (a) four pac-men, mouths in
        f.label(ox + 18, oy + 12, "abcd"[k], 32)
    f.d["notes"].line([(640, 10), (640, 710)], fill=FAR, width=2)
    f.d["notes"].line([(10, 360), (1270, 360)], fill=FAR, width=2)


def canal_detail(f):
    for x in range(40, 1280, 120):   # neurons beyond
        f.pyramid("far", x + rnd.uniform(-20, 20), 120, -20, FAR, 4, 14, 40)
    along = canal(f, [(-60, 500), (260, 440), (600, 520), (930, 430), (1340, 490)], 170, 150, "mid", "fg", 0.6, astro=1.2)
    x, y, a, w = along(0.42)
    boat(f, "near", x, y, w * 0.92, a)
    x, y, a, w = along(0.08)
    f.arrow([(x - 40, y + 10), (x + 140, y - 18)], 6)
    f.label(1000, 150, "astrocyte end-feet")
    f.label(140, 250, "pericyte")
    f.label(1060, 440, "plasma")
    f.label(30, 680, "tight junctions, the barrier")
    f.label(640, 560, "the boat squeezes into a bell")


if __name__ == "__main__":
    sheet = Sheet("sehn.ai  ·  cortex keyframes", BEATS, INTRO, notes=300)
    layers = {n: sheet.layer() for n in ("sky", "far", "mid", "near", "fg", "camera", "notes")}
    d = ImageDraw.Draw(layers["notes"])
    for i, draw in enumerate((blind_spot_lake, nerve, chiasm, lgn, radiation, v1, v2, v4, rest, panel_reveal, canal_detail, None)):
        f = Frame(layers)
        if draw:   # the colour script on 'sky': the retina's yellow, then the grey of the cortex
            f.d["sky"].rectangle([0, 0, FW, FH], fill=SKY["retina" if i == 0 else "cortex"])
            draw(f)
        x, y = sheet.origin(i)
        f.paste(layers, x, y)
        # the reasoning, under the frame's own hint, wrapped onto the ruled lines
        words, line, ly = NOTES[i].split(), "", y + FH + 56
        for w in words:
            if d.textlength(line + " " + w, font=sans(26)) > FW:
                d.text((x, ly), line, font=sans(26), fill=INK)
                line, ly = w, ly + 34
            else:
                line = (line + " " + w).strip()
        d.text((x, ly), line, font=sans(26), fill=INK)
    # a little softness, like a brush
    for n in ("far", "mid", "near", "fg"):
        layers[n] = layers[n].filter(ImageFilter.GaussianBlur(1.2))
    sheet.save(sys.argv[1] if len(sys.argv) > 1 else "lab/dive/keyframes", "cortex-sheet", layers)
