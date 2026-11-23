# `/mission-aufraeumen` für Menschen

Räumt nach dem Andocken ab, was ein `/mission`-Lauf bewusst stehen lässt: Missions-Worktree, Missions-Branch,
Reste von Paketen. Gelöscht wird nur, was nachweislich im Basiszweig liegt. Die Anweisungen an den
Agenten stehen in [`SKILL.md`](SKILL.md), was wann aufgeräumt wird in
[`mission/scripts/README.md`](../mission/scripts/README.md).

- **Aufruf:** `/mission-aufraeumen <PR-Nr.>`, ersatzweise mit der Nummer der Mission oder dem Namen des
  Missions-Branches. Ohne Argument sucht der Skill den jüngsten angedockten PR eines `epic/…`-Branches
  und legt ihn dir zur Bestätigung vor. Unter dem Flotten-Treiber räumt das Programm selbst auf.
- **Ablauf:**
  1. Reste toter Sitzungen abräumen (`worktree.ps1 -Action CleanupStale`), prüfen, dass der PR
     wirklich *angedockt* ist und nicht nur geschlossen.
  2. Den Basiszweig des PRs holen, ohne das Hauptverzeichnis umzuschalten. Maßgeblich ist die
     `base` des PRs, nicht der Adapter: Eine Mission kann von einer anderen abzweigen.
  3. Bestandsaufnahme mit Andock-Nachweis je Eintrag: Missions-Branch, übrige Paket-Branches,
     Worktrees, auf Wunsch Altlasten. Die Liste siehst du vor dem ersten Löschen.
  4. Löschen in fester Reihenfolge: Worktrees (`worktree.ps1 -Action Down`), Reste auf der Platte,
     `git worktree prune` und Code-Graph, lokale Branches mit `git branch -d`, Remote-Branches.
  5. Bericht: was weg ist, was bleibt und warum.
- **Was stehen bleibt:** ein schmutziger Worktree, ein Branch mit eigenem Commit oder
  revertiertem Andocken, ein Branch, den `-d` verweigert (etwa nach einem Squash-Andocken). Sie werden
  gemeldet, nie mit `-D` oder `--force` entfernt. Laufende Läufe anderer Missionen fasst der Skill nicht
  an.
- **Bei dir:** jeder Remote-Branch. Vor `git push --delete` fragt der Berechtigungsdialog; ohne Ja
  bleibt er stehen.
