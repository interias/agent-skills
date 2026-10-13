"""Draw red markings on a screenshot and optionally crop it.

Usage: python -P markieren.py <in.png> <out.png> <marks.json>

marks.json (coordinates in pixels of the input image):
{
  "marks": [
    {"type": "box",   "xy": [x0, y0, x1, y1], "label": "1", "label_pos": "above"},
    {"type": "arrow", "from": [x, y], "to": [x, y]},
    {"type": "text",  "xy": [x, y], "text": "fehlt"}
  ],
  "crop": [x0, y0, x1, y1]          # optional, applied after drawing
}
label_pos: above (default) | below | left | right -- pick the side that hides no data.
"""
import json
import math
import sys

from PIL import Image, ImageDraw, ImageFont

RED = (220, 38, 38)


def font(size):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def label(draw, xy, text, f, pad):
    x, y = xy
    l, t, r, b = draw.textbbox((x, y), text, font=f)
    draw.rectangle((l - pad, t - pad, r + pad, b + pad), fill=RED)
    draw.text((x, y), text, font=f, fill="white")


def main(src, dst, spec_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    im = Image.open(src).convert("RGB")
    draw = ImageDraw.Draw(im)
    w = max(3, round(min(im.size) / 250))
    f = font(max(16, w * 6))
    for m in spec.get("marks", []):
        kind = m["type"]
        if kind == "box":
            x0, y0, x1, y1 = m["xy"]
            draw.rectangle((x0, y0, x1, y1), outline=RED, width=w)
            if m.get("label"):
                l, t, r, b = draw.textbbox((0, 0), m["label"], font=f)
                gap = 2 * w
                pos = {
                    "above": (x0, y0 - (b - t) - gap - w),
                    "below": (x0, y1 + gap + w),
                    "left": (x0 - (r - l) - gap - w, y0),
                    "right": (x1 + gap + w, y0),
                }[m.get("label_pos", "above")]
                label(draw, (max(0, pos[0]), max(0, pos[1])), m["label"], f, w)
        elif kind == "arrow":
            (x0, y0), (x1, y1) = m["from"], m["to"]
            draw.line((x0, y0, x1, y1), fill=RED, width=w)
            a = math.atan2(y1 - y0, x1 - x0)
            head = w * 5
            pts = [(x1, y1)] + [(x1 - head * math.cos(a + s), y1 - head * math.sin(a + s)) for s in (0.45, -0.45)]
            draw.polygon(pts, fill=RED)
        elif kind == "text":
            label(draw, tuple(m["xy"]), m["text"], f, w)
        else:
            raise ValueError(f"unknown mark type: {kind}")
    if spec.get("crop"):
        im = im.crop(tuple(spec["crop"]))
    im.save(dst)
    print(f"{dst} {im.size[0]}x{im.size[1]}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
