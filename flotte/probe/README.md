# Generalprobe (#14, Stufe 4)

Der Treiber fährt echte `claude -p`-Läufe mit Haiku in `interias/flotte-probe` (privat).

## Aufbau

- Im Probe-Repo:
  - `.claude/epic.md`: hier `epic.md`, mit `merge: nach_gate`, `CHANGELOG.md` in `always_collide` und `git pull --ff-only` als `nach_merge`.
  - `.claude/skills/kurz-lauf/SKILL.md`: hier `kurz-lauf.SKILL.md`. Eine Seite Regeln, dasselbe Protokoll wie `/epic`: Tor-Frage, bauen, Gate-Block, `FLOTTE-ENDE`.
  - Ein leeres `CHANGELOG.md`.
- Drei Mini-Epics mit je zwei Paketen (je eine neue Datei):
  - „Gruß“ und „Farben“ teilen nur `CHANGELOG.md`: kleine Kollision.
  - „Abschied“ hat `> **Reihenfolge:** nach #<Gruß>`.
- Aufruf (Repo-Klon unter `<dir>`):

  ```
  bun src/cli.ts fahren <dir>/flotte-probe --forge interias/flotte-probe --epics 12,13,14 \
    --konten ~/.claude,~/.claude-arbeitspferd --skill kurz-lauf --modell haiku \
    --admiral-modell haiku --admiral-effort keine --leerlauf-min 15 --takt-s 15 \
    --sweep-root <dir> --sweep-temp <dir>/leer-temp --ohne-docker --ohne-nacharbeit --max-min 90
  ```

## Ergebnis vom 19.11.2026

Gemessen mit `flotte messen` (Transkripte, `usage.ps1`) und aus den Ereignissen des Treibers.
**Mit den alten Läufen nicht vergleichbar:** Haiku, Mini-Epics.

| Kennzahl | #12 | #13 | #14 |
|---|---|---|---|
| Starts des Laufs (Start und Fortsetzungen) | 4 | 3 | 2 |
| Fehlstarts | 0 | 0 | 0 |
| Rückfragen an den Menschen / Entscheidungen des Admirals | 1 / 0 | 1 / 0 | 0 / 1 |
| Warten auf den Menschen (min) | 1,1 | 23,5 ¹ | 0 |
| Kalte Zeit (min, Treiber) | 4,9 | 2,4 | 0 |
| PR bereit bis gemergt (min) | 38,5 ² | 5,5 ³ | 2,3 |
| Orchestrierung (`weighted`, Admiral) | 90 967 | 24 444 | 17 598 |
| Reste danach (Worktrees, Branches, Container) | 0 | 0 | 0 |

1. Die Antwort kam spät, weil der „Mensch“ der Probe die Sitzung war, die sie fuhr.
2. Wegen eines Fehlers in `merge.ps1` blockiert, nach dem Fix zurückgesetzt und im zweiten Durchgang gemergt; Treiber-Neustart aus der Zustandsdatei.
3. Der erste Merge lief noch mit dem Fehler, darauf folgte ein Nachbesserungsauftrag an den Lauf.

Die Wochen-Hochrechnung beider Konten senkte die Obergrenze auf 1; die Epics liefen nacheinander.

Die Probe deckte zwei Fehler auf; beide sind behoben:

- **`merge.ps1` las die Ausgabe von `gh` in der Konsolen-Codepage.** „Gate grün.“ passte deshalb nie, und `nach_gate` hätte in keinem Repo ohne CI gemergt. Behoben auf dem Branch der Merge-Regel.
- **Bei Gleichstand ging jeder Lauf an Konto 1.** Jetzt bekommt das Konto mit weniger Epics den Lauf.
