# Renders icon.svg to icon-512.png and social-preview.html to social-preview.png (1280 x 640), with
# Playwright and Chromium; the social preview loads its fonts from Google Fonts (needs network).
#   python assets/render_icon.py
# Upload social-preview.png on GitHub under Settings > General > Social preview.
from pathlib import Path

from playwright.sync_api import sync_playwright

HIER = Path(__file__).parent
svg = (HIER / 'icon.svg').read_text(encoding='utf-8')

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 512, 'height': 512})
    pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", "<svg width=\"512\" height=\"512\" ", 1)}</body></html>')
    pg.screenshot(path=str(HIER / 'icon-512.png'), omit_background=True)
    pg.close()
    pg = b.new_page(viewport={'width': 1280, 'height': 640})
    pg.goto((HIER / 'social-preview.html').resolve().as_uri())
    pg.evaluate('document.fonts.ready')
    pg.wait_for_timeout(800)
    pg.screenshot(path=str(HIER / 'social-preview.png'))
    pg.close()
    b.close()
