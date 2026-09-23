# Draws the agent-skills repository avatar once on a 512-unit grid and writes avatar.svg and avatar.png
# (512 x 512). Motif "Agenten-Prompt" (proposal E of the avatar drafts, 23.09.2026): the prompt ">_" the
# agents work at, a lime cursor and a spark, on the cut-corner plate of Neon Night — with a cyan edge,
# where KIBO's icon has a magenta one, so the two tell apart in Gitea.
#
#   python assets/avatar/gen_avatar.py
#
# Needs Pillow. Upload avatar.png in Gitea under the repository's settings (Repository-Avatar).
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE, EDGE, CYAN, LIME, YELLOW = '#0d0620', '#00f0ff', '#00f0ff', '#7cff4f', '#fcee0a'

S = 512                      # grid; the draft was drawn on 64 units, so every value is draft × 8
PLATE_PTS = [(24, 24), (408, 24), (488, 104), (488, 488), (104, 488), (24, 408)]
EDGE_W = 20
CHEVRON = [(104, 168), (216, 256), (104, 344)]
CHEVRON_W = 40
CURSOR = (248, 320, 392, 360)
SPARK = [(376, 88), (392, 128), (432, 144), (392, 160), (376, 200), (360, 160), (320, 144), (360, 128)]
GLOW = 12                    # blur radius in grid units

def svg():
    pts = lambda ps: ' '.join(f'{x},{y}' for x, y in ps)
    x0, y0, x1, y1 = CURSOR
    return '\n'.join([
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}">',
        '<title>agent-skills</title>',
        '<defs><filter id="glow" x="-60%" y="-60%" width="220%" height="220%">'
        f'<feGaussianBlur stdDeviation="{GLOW}" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
        f'<polygon points="{pts(PLATE_PTS)}" fill="{PLATE}" stroke="{EDGE}" stroke-width="{EDGE_W}"/>',
        '<g filter="url(#glow)">',
        f'<polyline points="{pts(CHEVRON)}" fill="none" stroke="{CYAN}" stroke-width="{CHEVRON_W}" '
        'stroke-linecap="round" stroke-linejoin="round"/>',
        f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="{LIME}"/>',
        f'<polygon points="{pts(SPARK)}" fill="{YELLOW}"/>',
        '</g>', '</svg>', ''])

def render(px):
    k = 8 * px / S                       # supersampling factor per grid unit
    n = round(S * k)
    sc = lambda ps: [(round(x * k), round(y * k)) for x, y in ps]
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    plate = sc(PLATE_PTS)
    d.polygon(plate, fill=PLATE)
    d.line(plate + plate[:2], fill=EDGE, width=round(EDGE_W * k), joint='curve')
    marks = Image.new('RGBA', img.size, (0, 0, 0, 0))
    md = ImageDraw.Draw(marks)
    chevron = sc(CHEVRON)
    md.line(chevron, fill=CYAN, width=round(CHEVRON_W * k), joint='curve')
    r = CHEVRON_W * k / 2
    for x, y in (chevron[0], chevron[-1]):                  # round caps
        md.ellipse((x - r, y - r, x + r, y + r), fill=CYAN)
    x0, y0, x1, y1 = CURSOR
    md.rectangle((round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k)), fill=LIME)
    md.polygon(sc(SPARK), fill=YELLOW)
    img = Image.alpha_composite(img, marks.filter(ImageFilter.GaussianBlur(GLOW * k)))
    img = Image.alpha_composite(img, marks)
    return img.resize((px, px), Image.LANCZOS)

open(os.path.join(HERE, 'avatar.svg'), 'w', encoding='utf-8').write(svg())
render(512).save(os.path.join(HERE, 'avatar.png'))
print('ok', HERE)
