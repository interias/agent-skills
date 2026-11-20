# Renders app/static/icon.svg to the PNG icons (needs Playwright with Chromium):
#   python icon_png.py
# apple-touch-icon is square and opaque: iOS rounds the corners itself.
from pathlib import Path

from playwright.sync_api import sync_playwright

STATIC = Path(__file__).parent / 'app' / 'static'
svg = (STATIC / 'icon.svg').read_text(encoding='utf-8')

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, groesse, eckig in [('icon-32.png', 32, False), ('apple-touch-icon.png', 180, True), ('icon-192.png', 192, False), ('icon-512.png', 512, False)]:
        pg = b.new_page(viewport={'width': groesse, 'height': groesse})
        bild = svg.replace('rx="112" fill="#000"', 'fill="#000"') if eckig else svg
        pg.set_content(f'<html><body style="margin:0;background:transparent">{bild.replace("<svg ", f"<svg width=\"{groesse}\" height=\"{groesse}\" ", 1)}</body></html>')
        pg.screenshot(path=str(STATIC / name), omit_background=True)
        pg.close()
    b.close()
