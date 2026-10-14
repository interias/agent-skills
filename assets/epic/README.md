# Paketbild

`epic.png` im README des Repositorys wird aus `epic.html` gerendert: 1200 × 620 px, doppelte
Auflösung, transparenter Grund. Gestaltung wie beim [Prozessbild](../prozess/README.md).

Ändert sich `/epic`, erst `epic.html` anpassen, dann neu rendern (Git Bash, aus diesem Ordner):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1200,620 \
  --screenshot="$(cygpath -w $PWD)\epic.png" "file:///$(cygpath -m $PWD)/epic.html"
```

`lauftafel.png` ist ein Bildschirmfoto der Vorlage `epic/references/lauftafel.html` mit ihren
Musterdaten (1480 × 1080 px, aus dem Wurzelverzeichnis des Repositorys):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --virtual-time-budget=8000 --window-size=1480,1080 \
  --screenshot="$(cygpath -w $PWD)\assets\epic\lauftafel.png" \
  "file:///$(cygpath -m $PWD)/epic/references/lauftafel.html"
```
