---
name: flotte
description: Flotten-Treiber — ein Programm statt eines Admiral-Chats führt mehrere /epic-Läufe gleichzeitig als `claude -p` auf einem oder zwei Konten. Belegung, Bremsen, Merge, Aufräumen, Tafel und Logbuch macht das Programm; ein Sprachmodell entscheidet nur je Frageblock (Admiral). Start aus einem Terminal, nicht aus einer Sitzung.
---

# Flotte

`flotte` ist ein Programm (TypeScript, läuft mit Bun). Es macht, was `/epic-flotte` als Prosa
beschreibt. Ein Sprachmodell kommt nur an zwei Stellen vor:

- in den **Läufen**: `/epic` unverändert, als `claude -p`, jeder Zug endet mit `FLOTTE-FRAGE` oder `FLOTTE-ENDE` (`epic-flotte/SKILL.md`, „Die Blöcke“),
- im **Admiral**: ein `claude -p --json-schema` je Frageblock, mit `--tools Read,Grep,Glob`.

Admiral und Läufe starten mit `--strict-mcp-config`: kein MCP-Server und kein claude.ai-Konnektor
des Kontos. Läufe zusätzlich ohne `RemoteTrigger`, `PushNotification`, `PublishPlugin`,
`ShareOnboardingGuide` und `DesignSync`. Der Treiber prüft die Werkzeugliste im `init`-Ereignis:

- Der Admiral darf nur `Glob`, `Grep`, `Read` und `StructuredOutput` sehen.
- Ein Lauf darf kein `mcp__`-Werkzeug sehen.

Sieht ein Aufruf mehr, beendet der Treiber ihn sofort. Die Fragen des Admirals gehen dann an den
Menschen, das Epic eines Laufs wird blockiert.

Voraussetzung ist die Merge-Regel aus #15: der Adapterschlüssel `merge` und die neue `merge.ps1`.
Eine ältere `merge.ps1` ruft der Treiber nicht auf.

## Starten

Aus einem Terminal, im Hauptverzeichnis des Projekts oder mit Pfad:

```
bun C:\Users\stefa\.claude\skills\flotte\src\cli.ts fahren <repo> --forge <owner/name> --epics 15,21,32 --konten C:\Users\stefa\.claude,C:\Users\stefa\.claude-arbeitspferd
```

Mögliche Schalter:

| Schalter | Standard |
|---|---|
| `--skill` | `epic` |
| `--modell` | Standard des Kontos |
| `--admiral-modell` / `--admiral-effort` | `fable` / `high` |
| `--ping-modell` | `haiku` |
| `--leerlauf-min` | `60` |
| `--takt-s` | `60` |
| `--platte-min-gb` | `20` |
| `--ram-warn` | aus dem Adapter, sonst `75`; geht auch an `ram.ps1` |
| `--obergrenze` | aus der Wochen-Hochrechnung (4, 2 oder 1); fest gesetzt nur für Proben |
| `--sweep-root <dir>` und `--sweep-temp <dir>` | ohne Angabe läuft kein Sweep |
| `--ohne-docker` | Docker wird mit aufgeräumt |
| `--ohne-nacharbeit` | Nacharbeit läuft |
| `--merge-skript` | `merge.ps1` des Leitstands |
| `--max-min` | ohne Grenze |
| `--konto-max <dir>=<n>` | ohne Grenze; höchstens n Epics dieses Einsatzes auf diesem Konto (ein Konto, das noch reichen muss) |

### Weiteres Konto zuschalten

Ein drittes Konto (`~/.claude-arbeitspferd-3`) arbeitet nur unter dem Treiber; der Leitstand kennt
es nicht. Eingerichtet und angemeldet wird es wie in `arbeitspferd/README.md`, „Weiteres Konto
einrichten“. Zugeschaltet wird es nur, wenn der Mensch es sagt:

1. Treiber mit Strg+C anhalten. Die Läufe arbeiten weiter, der Zustand steht schon in `zustand.json`.
2. Mit demselben Aufruf neu starten, `--konten` um den Ordner erweitert. `~` versteht der Treiber selbst:

   ```
   bun ~\.claude\skills\flotte\src\cli.ts fahren <repo> --forge <owner/name> --epics 15,21,32 --konten ~\.claude,~\.claude-arbeitspferd,~\.claude-arbeitspferd-3 --konto-max ~\.claude-arbeitspferd-3=1
   ```

3. `--konto-max <ordner>=<n>` ist die Grenze: Das Konto übernimmt in diesem Einsatz höchstens n
   Epics. Gezählt wird jedes Epic, das ihm schon zugeteilt ist, auch ein fertiges. Ohne die Angabe
   verteilt der Treiber neue Epics auf alle Konten mit grünem Verbrauch.

Ein Epic bleibt bei dem Konto, dem es zugeteilt ist, auch für Fortsetzungen und Nacharbeit. Ein
Konto deshalb erst wieder aus `--konten` nehmen, wenn keines seiner Epics mehr offen ist.

Weitere Befehle, jeder gibt genau ein JSON-Objekt aus:

- `flotte zustand <repo>`: Zustand und Sperre.
- `flotte antworten <repo> <epic> <frage> <Antwort>`: eine Antwort des Menschen an den laufenden Treiber.
- `flotte zuschauen <repo> <epic> [--einmal]`: folgt dem Log eines Laufs, je Zeile ein Schritt (Werkzeug und Ziel, Text des Laufs).
- `flotte adapter [<ordner>...]`: nennt die Projektadapter ohne Schlüssel `merge` (ohne Angabe die Repositorys unter `~/git`). Vor dem Einspielen aufrufen: In diesen Projekten mergt danach ein Mensch.
- `flotte belegung`, `verbrauch`, `ressourcen`, `bloecke`, `lauf`: die Werkzeuge einzeln.
- `flotte messen <einsaetze.json>`: Kennzahlen aus den Transkripten. Unter dem Treiber liest es Fragen, Wartezeit, kalte Zeit und Starts aus `zustand.json` (`treiberZustand` im Einsatz).

## Was der Treiber tut

1. **Einer je Repository.** Die Sperre liegt in `<git common dir>/flotte/treiber.lock`, der Zustand daneben in `zustand.json`. Nach einem Neustart setzt der Treiber aus der Datei fort. Ein Lauf schreibt sein Log selbst und überlebt den Treiber. Läufe, die noch leben (PID und Startzeit passen), beobachtet der Treiber nur.
2. **Belegung** aus Adapter und Issues: Kollisionsstufen (keine 4, klein 3, mittel 2, groß 1 gleichzeitig, nie mehr als vier) und Reihenfolge-Kanten. Ein Epic startet erst nach dem Merge seines Vorgängers. Bei Gleichstand gewinnt die Wahl, deren Epics weniger Gate-Bereiche (`gate_areas`) teilen. Jede neue Belegung nennt ihren Beleg.
3. **Bremsen** in jedem Takt:
   - RAM über `ram.ps1`: `warn` und `hold` halten an, weiter geht es erst 5 Punkte unter der Warnschwelle. Ein Messfehler gilt als `hold`, mit seinem Fehlertext; die nächste gute Messung gibt frei.
   - Plattenplatz.
   - Verbrauch je Konto aus dem `rate_limit_event` der Läufe, in `<CLAUDE_CONFIG_DIR>/flotte/verbrauch.json`. Gelb startet nichts Neues, Rot hält auch Fortsetzungen an. Ein Wert, der älter als 30 Minuten ist, gilt als rot. Ein Lauf meldet nur etwa ein- bis zweimal je Zug, deshalb holt ab 15 Minuten ein Mini-Lauf mit Haiku einen frischen Wert, auch während auf dem Konto ein Lauf arbeitet. Das geschieht nur, wenn auf dem Konto etwas starten oder weiterlaufen will, also nicht, während alles auf den Menschen wartet.
4. **Fragen:** Der Admiral entscheidet, was sich bis zum Merge widerrufen lässt. Sein Schema lässt als `nr` nur die Nummern der Fragen zu. Jede Entscheidung kommt als Kommentar ans Issue; einflussreiche Entscheidungen kommen zusätzlich ins Logbuch. Was beim Menschen liegt, parkt nur die Pakete aus `Betrifft:`; die übrigen laufen weiter (`weiter ohne <Pakete>`).
5. **Fehler:**
   - Ein Fehlstart wird höchstens zweimal neu gestartet.
   - Bei einem Netzfehler setzt der Treiber höchstens zweimal mit `--resume` fort.
   - Endet ein Zug ohne Block, fragt der Treiber einmal nach; danach gilt der Lauf als abgebrochen.
   - Nach `--leerlauf-min` ohne Ausgabe beendet er den Zug und setzt ihn einmal fort. Beim zweiten Mal bricht er das Epic ab. Lebt unter dem Lauf ein Kindprozess (ein Gate, eine Testsuite), gilt die Stille als Arbeit, bis zum Vierfachen von `--leerlauf-min`; das Ereignis nennt den Kindprozess.
   - `permission_denials` blockieren das Epic, ohne zweiten Versuch.
   - Ausnahme sind Sperren von `guard.ps1`. Der Treiber gibt den Hook jedem Zug über `--settings` mit, weil der Hook des Skills nach `--resume` nicht mehr gilt. Nach einer Sperre darf der Lauf seinen Weg ändern, wie im Fenster. Blockiert wird das Epic erst in einem dieser Fälle:
     - Der Zug scheitert an der Sperre.
     - Dieselbe Regel sperrt ein zweites Mal.
     - Im Epic kommt die dritte Sperre.
   - Nach jedem toten Lauf räumt `CleanupStale` auf. Es verschont die Worktrees der Epics, die noch laufen oder warten: Jeder Lauf bekommt `EPIC_LOCK_HOLDER`, eine Datei in `<git common dir>/flotte/halten/`. Der Treiber löscht sie erst, wenn das Epic endet.
6. **Ende eines Laufs:**
   - Mit `merge: nach_gate` kommt das Epic in die **Merge-Schlange**, in der Reihenfolge seines `FLOTTE-ENDE`. Nur ihr Kopf ist dran, neben der Schleife: Während `merge.ps1` und das Gate laufen, beantwortet der Treiber andere Läufe.
     - Ist der Gate-Block im PR gültig, mergt `merge.ps1`.
     - Sonst holt der Treiber selbst die Basis in den Epic-Worktree (`git merge origin/<basis>`), fährt `gate_command` des Adapters dort, schreibt den Block in die PR-Beschreibung, pusht und mergt. Hat sich die Basis seit dem letzten vollen grünen Lauf nur in Bereichen bewegt, die das Epic nicht berührt (`gate_areas`), fährt er nur `gate_always_command`. Hat die Sitzung des Laufs den Epic-Worktree mitgenommen, legt der Treiber ihn mit `worktree.ps1 Up` neu an und baut ihn nach dem Merge mit `Down` ab.
     - Ein Konflikt oder ein rotes Gate geht mit der Ausgabe an den Lauf zurück (`--resume`); das Epic stellt sich hinten an, die Schlange läuft weiter. Ein rotes Gate setzt den Worktree auf den Stand des PRs zurück. Nach zwei Rückgaben wird das Epic bei der dritten blockiert.
     - Bei n Epics in der Schlange sind so höchstens n−1 Gate-Wiederholungen nötig. Der Zähler steht als `gateWiederholungen` je Epic und in der Statistik; nach drei eigenen Gate-Läufen für dasselbe Epic wird es blockiert.
     - Ohne `gate_command` im Adapter bleibt es beim alten Weg: Der Lauf bessert den Block selbst nach (zwei Nachbesserungen, fünf Basis-Nachzüge).
   - Mit `merge: mensch` (Standard) meldet er „PR bereit“ und erkennt den Merge später.
   - Nach dem Merge: die `nach_merge`-Befehle des Adapters, dann `CleanupStale`, dann der lokale Epic-Branch, wenn er ganz in `origin/<basis>` liegt. Bekommt ein anderer offener PR außerhalb der Schlange einen Konflikt, geht ein Auftrag an dessen Lauf.
7. **Sichtbar:**
   - Tafel: `<git common dir>/flotte/tafel.html` im Browser öffnen; sie lädt sich selbst neu. Sie zeigt je Lauf den letzten Schritt und seine Zeit und die Merge-Schlange.
   - Logbuch: ein Issue mit Label `flotte`, mit dem KIBO-Block. Die Bremse steht dort nur als Stufe, nie in Prozent.

## Was beim Menschen liegt

- **Fragen**, die der Admiral nicht entscheiden darf. Sie stehen als `FRAGE AN DEN MENSCHEN` am Issue und auf der Tafel. Antwort mit `flotte antworten …`.
- **Mergen** bei `merge: mensch`, und das Umstellen auf `nach_gate` im Adapter.
- **Konto anmelden**, wenn ein Lauf mit einem Anmeldefehler endet (das Epic steht dann auf „blockiert“).
- **Widerruf** einer Entscheidung: als Kommentar am Issue. Der Lauf setzt ihn im nächsten Zug oder in der Nacharbeit um.
- **Blockierte und abgebrochene Epics:** Der Grund steht am Issue.

Umschalten von `/epic-flotte` und zurück: `references/umschalten.md`.
