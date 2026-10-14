# Brückenbild

`agentenflotte.png` im README des Repositorys wird aus `agentenflotte.html` gerendert:
1200 × 560 px, doppelte Auflösung, transparenter Grund. Terminal und Statuszeile sind ein Beispiel;
das Radar folgt Maßen und Farben von `radarSvg` in `agentenflotte/hooks/taktik.tsx`.

Ändert sich das Plugin sichtbar, erst `agentenflotte.html` anpassen, dann neu rendern (Git Bash,
aus diesem Ordner):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1200,560 \
  --screenshot="$(cygpath -w $PWD)\agentenflotte.png" "file:///$(cygpath -m $PWD)/agentenflotte.html"
```
