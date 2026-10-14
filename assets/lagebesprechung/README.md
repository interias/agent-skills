# Lagebesprechung

`lagebesprechung.png` im README des Repositorys wird aus `lagebesprechung.html` gerendert:
1200 × 520 px, doppelte Auflösung, transparenter Grund. Gestaltung wie beim
[Prozessbild](../prozess/README.md).

Ändert sich `epic-lagebesprechung`, erst `lagebesprechung.html` anpassen, dann neu rendern (Git
Bash, aus diesem Ordner):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1200,520 \
  --screenshot="$(cygpath -w $PWD)\lagebesprechung.png" "file:///$(cygpath -m $PWD)/lagebesprechung.html"
```
