# Flottenbild

`flotte.png` im README des Repositorys wird aus `flotte.html` gerendert: 1200 × 630 px, doppelte
Auflösung, transparenter Grund. Gestaltung wie beim [Prozessbild](../prozess/README.md): jede
Beschriftung auf einem weißen Schild, Schilder beim Rendern aus den echten Textmaßen bemessen,
Schriften von Google Fonts (das Rendern braucht Netz).

Ändert sich `epic-flotte`, erst `flotte.html` anpassen, dann neu rendern (Git Bash, aus diesem
Ordner):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1200,630 \
  --screenshot="$(cygpath -w $PWD)\flotte.png" "file:///$(cygpath -m $PWD)/flotte.html"
```
