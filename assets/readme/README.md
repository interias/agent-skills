# README-Grafiken

`ablauf.png` und `rueckfrage.png` im README des Repositorys werden aus `ablauf.html` und
`rueckfrage.html` gerendert, jeweils breit (880 px) und schmal für Handys (400 px, Anker `#schmal`),
beide mit Gerätefaktor 2. Das README zeigt die schmale Fassung über `<picture>` bis 600 px
Fensterbreite. LCARS-Farben wie auf der Brücke, kleinste Schrift 16 px bei Originalgröße. Die
Schriften kommen von Google Fonts (das Rendern braucht Netz).

Ändert sich der Ablauf, erst die HTML-Datei anpassen, dann neu rendern, mit Python und Playwright
aus diesem Ordner:

```python
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    br = pw.chromium.launch()
    for name in ('ablauf', 'rueckfrage'):
        for art, breite in (('', 880), ('-schmal', 400)):
            pg = br.new_page(viewport={'width': breite, 'height': 400}, device_scale_factor=2)
            pg.goto(Path(f'{name}.html').resolve().as_uri() + ('#schmal' if art else ''))
            pg.evaluate('document.fonts.ready')
            pg.wait_for_timeout(800)
            pg.locator('body').screenshot(path=f'{name}{art}.png')
            # flat colours: a palette of 96 keeps the edges smooth and each file far below 250 KB
            Image.open(f'{name}{art}.png').convert('RGB').quantize(colors=96, method=Image.Quantize.FASTOCTREE).save(f'{name}{art}.png', optimize=True)
            pg.close()
    br.close()
```
