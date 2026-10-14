# Mailbild

`mail-antwort.png` im README des Repositorys wird aus `mail-antwort.html` gerendert: 1200 × 620 px,
doppelte Auflösung, transparenter Grund. Gestaltung wie beim [Prozessbild](../prozess/README.md).

Ändert sich `mail-antwort`, erst `mail-antwort.html` anpassen, dann neu rendern (Git Bash, aus
diesem Ordner):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1200,620 \
  --screenshot="$(cygpath -w $PWD)\mail-antwort.png" "file:///$(cygpath -m $PWD)/mail-antwort.html"
```
