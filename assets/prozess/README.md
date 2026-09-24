# Prozessbild

`prozess.png` im README des Repositorys wird aus `prozess.html` gerendert: 1200 × 560 px, doppelte
Auflösung, transparenter Grund. Jede Beschriftung steht auf einem weißen Schild, damit das Bild in
einem hellen und einem dunklen Gitea-Theme gleich lesbar ist. Die Schilder bemisst ein Skript beim
Rendern aus den echten Textmaßen; die Schriften kommen von Google Fonts, das Rendern braucht also
Netz.

Ändert sich der Ablauf, erst `prozess.html` anpassen, dann neu rendern (Git Bash, aus diesem Ordner):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu \
  --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --window-size=1200,560 \
  --screenshot="$(cygpath -w $PWD)\prozess.png" "file:///$(cygpath -m $PWD)/prozess.html"
```
