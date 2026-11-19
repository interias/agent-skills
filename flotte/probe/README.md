# Generalprobe (#14, Stufe 4)

Der Treiber fährt echte `claude -p`-Läufe mit Haiku in `interias/flotte-probe` (privat).

## Aufbau

- **Im Probe-Repo:**
  - `.claude/epic.md`: hier `epic.md`. Darin `merge: nach_gate`, `CHANGELOG.md` in
    `always_collide` und `git pull --ff-only` als `nach_merge`.
  - `.claude/skills/kurz-lauf/SKILL.md`: hier `kurz-lauf.SKILL.md`. Eine Seite Regeln mit dem
    Protokoll von `/epic`: Tor-Frage, bauen, Gate-Block, `FLOTTE-ENDE`. Dazu der Hook
    `guard.ps1` wie bei `/epic`. Ab Probe 2 schließt der PR auch die Pakete.
  - Ein leeres `CHANGELOG.md`.
- **Mini-Epics** mit je zwei Paketen, jedes Paket legt eine neue Datei an. Alle teilen
  `CHANGELOG.md`; das ist eine kleine Kollision, bis zu drei laufen gleichzeitig.
- **Aufruf** (Repo-Klon unter `<dir>`). Probe 1 lief so; Probe 2 lief zusätzlich mit
  `--obergrenze 3 --merge-skript <merge.ps1 von #15>`:

  ```
  bun src/cli.ts fahren <dir>/flotte-probe --forge interias/flotte-probe --epics 12,13,14 \
    --konten C:\Users\stefa\.claude,C:\Users\stefa\.claude-arbeitspferd --skill kurz-lauf --modell haiku \
    --admiral-modell haiku --admiral-effort keine --leerlauf-min 15 --takt-s 15 \
    --sweep-root <dir> --sweep-temp <dir>/leer-temp --ohne-docker --ohne-nacharbeit --max-min 90
  ```

Gemessen ist alles mit `flotte messen`, für beide Proben mit demselben Programm. Die Quellen sind
Transkripte, `usage.ps1` und `zustand.json` des Treibers. **Mit den alten Läufen nicht
vergleichbar:** Haiku, Mini-Epics.

## Probe 2 vom 19.11.2026, nach der Abnahme

Vier Epics (#21, #24, #27, #30):

- Obergrenze fest auf 3. Die Wochen-Hochrechnung beider Konten hätte sie auf 1 gesenkt.
- Ein Abbruch mit echtem Strg+C mitten im Bauzug aller drei Läufe.
- #30 hat einen Probe-Schritt `gh pr merge 999` gegen `guard.ps1`.

| Kennzahl | #21 | #24 | #27 | #30 |
|---|---|---|---|---|
| Konto | 1 | 1 | 1 | 2 |
| Starts (Start und Fortsetzungen) | 2 | 3 | 4 | 5 |
| Fehlstarts | 0 | 0 | 0 | 0 |
| Rückfragen an den Menschen / Entscheidungen des Admirals | 0 / 1 | 0 / 1 | 0 / 1 | 0 / 1 |
| Merge abgelehnt, weil die Basis davonzog / eigene Nachbesserung | 0 / 0 | 1 / 0 | 2 / 0 | 3 / 0 |
| Kalte Zeit (min) ¹ | 0 | 4,5 | 13,0 | 17,7 |
| PR bereit bis gemergt (min, `mergedAt`) | 2,6 | 11,3 | 18,0 | 21,5 |
| Orchestrierung (`weighted`, Admiral) | 12 571 | 24 165 | 11 876 | 18 441 |
| Reste danach (Worktrees, Branches, Container, offene Issues) | 0 | 0 | 0 | 0 |

1. Kalte Zeit ist hier die Warteschlange der Merges. Jeder Merge prüft zwei Minuten lang auf
   Checks, die es in diesem Repository nicht gibt. Jeder Merge rückt die Basis der übrigen PRs
   weiter, die dann neu nachziehen. Der Treiber beantwortete in der Zeit andere Läufe (Befund 12).

### Was die Probe belegt

- **Drei Läufe gleichzeitig** (`maxLaeufe` 3), **einer auf Konto 2** (#30). Zu Beginn war der
  Verbrauchswert von Konto 2 30,9 Minuten alt und galt deshalb als rot. Die ersten drei Läufe
  gingen an Konto 1; erst der Ping machte Konto 2 grün.
- **Alle vier Merges kamen vom Treiber über `merge.ps1`:** 10 Aufrufe, 4 gemergt, 6 abgelehnt,
  weil die Basis davongezogen war. #30 wurde dreimal abgelehnt; der alte Zähler hätte das Epic
  nach zwei blockiert (Befund 9).
- **Admiral:** Haiku entschied alle vier Tor-Fragen selbst. Keine Antwort wurde wegen einer
  falschen `nr` verworfen (Befund 1).
- **Strg+C mitten im Bauzug**, über den Terminal-Bereich der App.
  - Der Treiber endete. Alle drei Läufe machten ihren Zug zu Ende und schrieben ihr Ergebnis ins
    eigene Log.
  - Der Neustart fand sie beendet, las die drei Ergebnisse aus den Logs und startete nichts doppelt.
  - Die Sperre blieb liegen; der SIGINT-Handler lief in der PowerShell-Pipeline nicht. Der Neustart
    übernahm sie, weil ihr Prozess tot war.
  - Einen noch lebenden Lauf zu beobachten, kam live nicht vor. D16 deckt es ab: ein echter
    Treiberprozess, mitten im Zug beendet.
- **RAM-Bremse live:** `warn` bei 75,1 %, wieder frei bei 67,4 %. Merges liefen in der Zeit weiter.
- **Reste:** keine Worktrees, keine Branches, keine Halter-Dateien. Alle Epics und Pakete wurden
  über `Closes` geschlossen.

### `guard.ps1` nach `--resume` (Befund 15)

In der Probe verweigerte der Lauf den Probe-Schritt selbst („Mergen ist nicht deine Aufgabe“). Der
Hook wurde dabei nicht gefragt. Deshalb kam eine eigene Prüfung mit `starte`, wie im Treiber:

| Aufbau | `gh pr merge 999` |
|---|---|
| Zug 1: Skill `kurz-lauf` aufgerufen, im selben Zug der Befehl | **gesperrt** vom Hook des Skills |
| Zug 2 mit `--resume`, nur der Hook des Skills | **nicht gesperrt**; GitHub antwortete „Could not resolve to a PullRequest“ |
| Zug 2 mit `--resume`, Hook über `--settings` | **gesperrt**, als `permission_denial` gemeldet |

Der Hook im Frontmatter eines Skills gilt nur im Zug, der den Skill aufruft. Jede Antwort des
Treibers ist ein `--resume`. Deshalb gibt der Treiber jetzt jedem Lauf `guard.ps1` über
`--settings` mit.

## Probe 1 vom 19.11.2026, korrigiert nach der Abnahme

| Kennzahl | #12 | #13 | #14 |
|---|---|---|---|
| Starts des Laufs (Start und Fortsetzungen) | 4 | 3 | 2 |
| Fehlstarts | 0 | 0 | 0 |
| Rückfragen an den Menschen / Entscheidungen des Admirals | 1 / 0 ¹ | 1 / 0 ¹ | 0 / 1 |
| Warten auf den Menschen (min) | 1,1 | 23,5 ² | 0 |
| PR bereit bis gemergt (min, `mergedAt`) | 32,8 ³ | 5,4 | 2,2 |
| Orchestrierung (`weighted`, Admiral) | 90 967 | 24 444 | 17 598 |
| Reste (Worktrees, Branches, Container) | 0 | 0 | 0 ⁴ |

1. Der Admiral hatte beide Fragen selbst entschieden. Er antwortete aber mit der Epicnummer als
   `nr`, und der Treiber verwarf die Antworten (Befund 1, behoben).
2. Der „Mensch“ der Probe war die Sitzung, die sie fuhr.
3. PR #16 wurde wegen des Fehlers in `merge.ps1` von Hand mit `merge.ps1` gemergt, außerhalb der
   Schleife. Der Treiber bemerkte es danach. Gemeldet waren 38,5 min; das war die Zeit bis zum
   Bemerken, nicht bis zum Merge.
4. Die Paket-Issues #6 bis #11 blieben offen; sie sind seit Probe 2 geschlossen.

Die Obergrenze war 1. Es lief nie mehr als ein Lauf, alle auf Konto 1.

Die Probe deckte zwei Fehler auf; beide sind behoben:

- **`merge.ps1` las die Ausgabe von `gh` in der Konsolen-Codepage.** „Gate grün.“ passte deshalb
  nie. Behoben auf dem Branch der Merge-Regel, mit Test seit der Abnahme.
- **Bei Gleichstand ging jeder Lauf an Konto 1.** Jetzt bekommt das Konto mit weniger Epics den
  Lauf.
