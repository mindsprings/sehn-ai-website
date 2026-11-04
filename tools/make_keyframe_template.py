# Blank keyframe sheet for the dive, as a layered OpenRaster file (.ora) that Krita opens with its layers,
# plus a flat PNG preview. Other sheets build on its Sheet (see make_cortex_sheet.py).
#   python tools/make_keyframe_template.py [outdir]      (default: lab/dive/keyframes)
import io, os, subprocess, sys, zipfile
from PIL import Image, ImageDraw, ImageFont

FW, FH = 1280, 720            # one 16:9 frame
GUT, LABEL = 80, 96
COLS, ROWS = 3, 3
HEAD = 230

PAPER = (251, 247, 238, 255)
INK = (110, 42, 71, 255)       # plum
FAINT = (191, 167, 127, 255)   # tan, for guides
PHONE = (231, 161, 182, 255)   # rose

BEATS = [
    ("01", "EYE", "the page opens on the eye", "scroll 0%"),
    ("02", "APPROACH", "the camera flies at the pupil", "scroll 5-40%"),
    ("03", "PUPIL", "through the pupil: the dark opens up", "scroll ~40%"),
    ("04", "THE WAY IN", "tunnel, or something else entirely?", "scroll 40-70%"),
    ("05", "EXIT", "first sight of the world", "scroll ~70%"),
    ("06", "WORLD", "the resting view; page content lives here", "scroll 100%"),
    ("07", "REVEAL", "drifting layers line up into ... ?", "after the world"),
    ("08", "FREE", "anything else: a detail, a character, the phone view", ""),
    ("09", "FREE", "", ""),
]
DEPTHS = ["sky", "far", "mid", "near", "fg"]   # back to front
INTRO = ["Draw each depth on its own layer (back to front: sky, far, mid, near, fg). "
         "Arrows for camera moves go on 'camera', words on 'notes'.",
         "Dashed rose box = what a phone sees.  Export: File > Export as PNG, and Tools > Scripts > Export Layers, "
         "into lab/dive/keyframes/."]


def font(family, size):
    try:
        path = subprocess.run(["fc-match", "-f", "%{file}", family], capture_output=True, text=True).stdout
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default(size)


mono = lambda s: font("IBM Plex Mono", s)
sans = lambda s: font("IBM Plex Sans", s)


def dashed(d, box, color, dash=18, gap=12, width=3):
    x0, y0, x1, y1 = box
    for (ax, ay, bx, by) in [(x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)]:
        length = max(abs(bx - ax), abs(by - ay))
        t = 0
        while t < length:
            e = min(t + dash, length)
            d.line([(ax + (bx - ax) * t / length, ay + (by - ay) * t / length),
                    (ax + (bx - ax) * e / length, ay + (by - ay) * e / length)], fill=color, width=width)
            t += dash + gap


class Sheet:
    """The empty sheet: paper, and the guides (title, frames, thirds, phone box, the beats' names and hints)."""

    def __init__(self, title, beats, intro=INTRO, notes=170):
        self.notes = notes
        rows = max(ROWS, -(-len(beats) // COLS))
        self.W = COLS * FW + (COLS + 1) * GUT
        self.H = HEAD + rows * (LABEL + FH + notes + GUT)
        self.paper = Image.new("RGBA", (self.W, self.H), PAPER)
        self.guides = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        d = ImageDraw.Draw(self.guides)
        d.text((GUT, 60), title, font=mono(56), fill=INK)
        for k, line in enumerate(intro):
            d.text((GUT, 140 + 42 * k), line, font=sans(30), fill=INK)
        for i, (num, name, hint, when) in enumerate(beats):
            x, y = self.origin(i)
            d.text((x, y - LABEL + 18), num + "  " + name, font=mono(44), fill=INK)
            if when:
                tw = d.textlength(when, font=mono(28))
                d.text((x + FW - tw, y - LABEL + 32), when, font=mono(28), fill=FAINT)
            d.rectangle([x, y, x + FW, y + FH], outline=INK, width=4)
            # thirds, and a small cross in the middle (where the camera dives)
            for k in (1, 2):
                d.line([(x + FW * k / 3, y + 4), (x + FW * k / 3, y + FH - 4)], fill=FAINT, width=1)
                d.line([(x + 4, y + FH * k / 3), (x + FW - 4, y + FH * k / 3)], fill=FAINT, width=1)
            cx, cy = x + FW / 2, y + FH / 2
            d.line([(cx - 18, cy), (cx + 18, cy)], fill=INK, width=2)
            d.line([(cx, cy - 18), (cx, cy + 18)], fill=INK, width=2)
            # the part of the frame a portrait phone keeps
            pw = FH * 9 / 19.5
            dashed(d, (cx - pw / 2, y + 6, cx + pw / 2, y + FH - 6), PHONE)
            # notes: the hint, then ruled lines down to the next row
            ny = y + FH + 22
            if hint:
                d.text((x, ny), hint, font=sans(30), fill=INK)
            for k in range((notes - 64) // 34):
                ly = ny + 64 + k * 34
                d.line([(x, ly), (x + FW, ly)], fill=FAINT, width=1)

    def origin(self, i):
        c, r = i % COLS, i // COLS
        return GUT + c * (FW + GUT), HEAD + r * (LABEL + FH + self.notes + GUT) + LABEL

    def layer(self):
        return Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))

    def save(self, out, name, drawn=None):
        """Writes out/name.ora (Krita opens it with its layers) and a flat out/name.png. drawn: {layer name: image}."""
        drawn = drawn or {}
        layers = [(n, drawn.get(n) or self.layer()) for n in ["notes", "camera"]] + [("guides", self.guides)] + \
                 [(n, drawn.get(n) or self.layer()) for n in reversed(DEPTHS)] + [("paper", self.paper)]
        merged = self.paper
        for n, img in reversed(layers[:-1]):
            merged = Image.alpha_composite(merged, img)
        stack = ['<?xml version="1.0" encoding="UTF-8"?>', f'<image version="0.0.5" w="{self.W}" h="{self.H}" xres="144" yres="144">', "<stack>"]
        for n, _ in layers:
            stack.append(f'<layer name="{n}" src="data/{n}.png" x="0" y="0" opacity="1.0" visibility="visible"/>')
        stack += ["</stack>", "</image>"]
        os.makedirs(out, exist_ok=True)
        ora = os.path.join(out, name + ".ora")
        with zipfile.ZipFile(ora, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(zipfile.ZipInfo("mimetype"), "image/openraster", compress_type=zipfile.ZIP_STORED)   # must come first, uncompressed
            z.writestr("stack.xml", "\n".join(stack))
            for n, img in layers:
                z.writestr(f"data/{n}.png", png(img))
            z.writestr("mergedimage.png", png(merged))
            thumb = merged.copy()
            thumb.thumbnail((256, 256))
            z.writestr("Thumbnails/thumbnail.png", png(thumb))
        merged.convert("RGB").save(os.path.join(out, name + ".png"), optimize=True)
        print(ora, f"{self.W}x{self.H}")


def png(img):
    b = io.BytesIO()
    img.save(b, "PNG", optimize=True)
    return b.getvalue()


if __name__ == "__main__":
    Sheet("sehn.ai  ·  dive keyframes", BEATS).save(sys.argv[1] if len(sys.argv) > 1 else "lab/dive/keyframes", "keyframe-sheet")
