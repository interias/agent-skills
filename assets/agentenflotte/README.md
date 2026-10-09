# Vorschaubild der Agentenflotte

`vorschau.png` im README des Repositorys ist die Desktop-Zeichnung des Mods selbst: `vorschau.ts`
ruft `fleetSvg(fleet, now, isWorking, alert)` aus `agentenflotte/hooks/svg.ts` mit einer Beispielflotte eines `/epic`-Laufs (ein Reviewer wartet, Alarm gelb) auf
und schreibt `vorschau.html`. Gerendert wird mit reduzierter Bewegung, damit ein ruhiges Standbild
entsteht: 960 × 240 px (1920 × 480 px im PNG), doppelte Auflösung.

Ändert sich die Zeichnung des Mods, neu erzeugen (Git Bash, aus diesem Ordner; der eigene
Profilordner verhindert, dass ein offenes Chrome den Aufruf übernimmt; mit Edge geht es genauso,
wenn `msedge.exe` vorhanden ist):

```bash
bun vorschau.ts
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --hide-scrollbars --user-data-dir="$(cygpath -w "$TEMP")\chrome-vorschau" \
  --default-background-color=00000000 --force-device-scale-factor=2 \
  --force-prefers-reduced-motion --virtual-time-budget=2000 --window-size=960,240 \
  --screenshot="$(cygpath -w $PWD)\vorschau.png" "file:///$(cygpath -m $PWD)/vorschau.html"
```
