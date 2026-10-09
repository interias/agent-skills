# Vorschaubild der Agentenflotte

`vorschau.png` im README des Repositorys ist die Desktop-Zeichnung des Mods selbst: `vorschau.ts`
ruft `fleetSvg` aus `agentenflotte/hooks/svg.ts` mit einer Beispielflotte eines `/epic`-Laufs auf
und schreibt `vorschau.html`. Gerendert wird mit reduzierter Bewegung, damit ein ruhiges Standbild
entsteht: 960 × 184 px, doppelte Auflösung.

Ändert sich die Zeichnung des Mods, neu erzeugen (Git Bash, aus diesem Ordner; der eigene
Profilordner verhindert, dass ein offenes Edge den Aufruf übernimmt):

```bash
bun vorschau.ts
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --user-data-dir="$(cygpath -w "$TEMP")\edge-vorschau" \
  --default-background-color=00000000 --force-device-scale-factor=2 \
  --force-prefers-reduced-motion --virtual-time-budget=2000 --window-size=960,184 \
  --screenshot="$(cygpath -w $PWD)\vorschau.png" "file:///$(cygpath -m $PWD)/vorschau.html"
```
