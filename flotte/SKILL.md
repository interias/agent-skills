---
name: flotte
description: Flotten-Treiber — ein Programm statt eines Admiral-Chats führt mehrere /epic-Läufe gleichzeitig als `claude -p` auf einem oder zwei Konten. Belegung, Bremsen, Merge, Aufräumen, Tafel und Logbuch macht das Programm; ein Sprachmodell entscheidet nur je Frageblock (Admiral). Start aus einem Terminal, nicht aus einer Sitzung.
---

# Flotte

`flotte` ist ein Programm (TypeScript, läuft mit Bun). Es macht, was `/epic-flotte` als Prosa
beschreibt. Ein Sprachmodell kommt nur an zwei Stellen vor:

- in den **Läufen**: `/epic` unverändert, als `claude -p`, jeder Zug endet mit `FLOTTE-FRAGE` oder `FLOTTE-ENDE` (`epic-flotte/SKILL.md`, „Die Blöcke“),
- im **Admiral**: ein `claude -p --json-schema` je Frageblock, nur mit Lesewerkzeugen.

Voraussetzung ist die Merge-Regel aus #15: der Adapterschlüssel `merge` und die neue `merge.ps1`.

## Starten

Aus einem Terminal, im Hauptverzeichnis des Projekts oder mit Pfad:

```
bun ~/.claude/skills/flotte/src/cli.ts fahren <repo> --forge <owner/name> --epics 15,21,32 --konten ~/.claude,~/.claude-arbeitspferd
```

Mögliche Schalter:

| Schalter | Standard |
|---|---|
| `--skill` | `epic` |
| `--modell` | Standard des Kontos |
| `--admiral-modell` / `--admiral-effort` | `fable` / `high` |
| `--ping-modell` | `haiku` |
| `--leerlauf-min` | `30` |
| `--takt-s` | `60` |
| `--platte-min-gb` | `20` |
| `--ram-warn` | `75` |
| `--sweep-root <dir>` und `--sweep-temp <dir>` | ohne Angabe läuft kein Sweep |
| `--ohne-docker` | Docker wird mit aufgeräumt |
| `--ohne-nacharbeit` | Nacharbeit läuft |
| `--merge-skript` | `merge.ps1` des Leitstands |
| `--max-min` | ohne Grenze |

Weitere Befehle, jeder gibt genau ein JSON-Objekt aus:

- `flotte zustand <repo>`: Zustand und Sperre.
- `flotte antworten <repo> <epic> <frage> <Antwort>`: eine Antwort des Menschen an den laufenden Treiber.
- `flotte belegung`, `verbrauch`, `ressourcen`, `bloecke`, `lauf`: die Werkzeuge einzeln.
- `flotte messen <einsaetze.json>`: Kennzahlen aus den Transkripten.

## Was der Treiber tut

1. **Einer je Repository.** Die Sperre liegt in `<git common dir>/flotte/treiber.lock`, der Zustand daneben in `zustand.json`. Nach einem Neustart setzt der Treiber aus der Datei fort. Läufe, die noch leben, beobachtet er nur.
2. **Belegung** aus Adapter und Issues: Kollisionsstufen (keine 4, klein 3, mittel 2, groß 1 gleichzeitig, nie mehr als vier) und Reihenfolge-Kanten. Ein Epic startet erst nach dem Merge seines Vorgängers. Jede neue Belegung nennt ihren Beleg.
3. **Bremsen** in jedem Takt:
   - RAM über `ram.ps1`; `warn` und `hold` halten an, ein Messfehler gilt als `hold`. Weiter geht es erst 5 Punkte unter der Warnschwelle.
   - Plattenplatz.
   - Verbrauch je Konto aus dem `rate_limit_event` der Läufe, in `<CLAUDE_CONFIG_DIR>/flotte/verbrauch.json`. Gelb startet nichts Neues, Rot hält auch Fortsetzungen an. Ein Wert, der älter als 30 Minuten ist, gilt als rot; dann holt ein Mini-Lauf mit Haiku einen frischen.
4. **Fragen:** Der Admiral entscheidet, was sich bis zum Merge widerrufen lässt. Jede Entscheidung kommt als Kommentar ans Issue; einflussreiche Entscheidungen kommen zusätzlich ins Logbuch. Was beim Menschen liegt, parkt nur die Pakete aus `Betrifft:`; die übrigen laufen weiter (`weiter ohne <Pakete>`).
5. **Fehler:**
   - Ein Fehlstart wird höchstens zweimal neu gestartet.
   - Bei einem Netzfehler setzt der Treiber höchstens zweimal mit `--resume` fort.
   - Endet ein Zug ohne Block, fragt der Treiber einmal nach; danach gilt der Lauf als abgebrochen.
   - Nach N Minuten ohne Ausgabe bricht er den Lauf ab.
   - `permission_denials` blockieren das Epic, ohne zweiten Versuch.
   - Nach jedem toten Lauf räumt `CleanupStale` auf.
6. **Ende eines Laufs:**
   - Mit `merge: nach_gate` ruft der Treiber `merge.ps1` auf. Fehlt der Gate-Block oder ist er veraltet, geht der Auftrag zurück an den Lauf.
   - Mit `merge: mensch` (Standard) meldet er „PR bereit“ und erkennt den Merge später.
   - Nach dem Merge: die `nach_merge`-Befehle des Adapters, dann `CleanupStale`. Bekommt ein anderer offener PR einen Konflikt, geht ein Auftrag an dessen Lauf.
7. **Sichtbar:**
   - Tafel: `<git common dir>/flotte/tafel.html` im Browser öffnen; sie lädt sich selbst neu.
   - Logbuch: ein Issue mit Label `flotte`, mit dem KIBO-Block. Die Bremse steht dort nur als Stufe, nie in Prozent.

## Was beim Menschen liegt

- **Fragen**, die der Admiral nicht entscheiden darf. Sie stehen als `FRAGE AN DEN MENSCHEN` am Issue und auf der Tafel. Antwort mit `flotte antworten …`.
- **Mergen** bei `merge: mensch`, und das Umstellen auf `nach_gate` im Adapter.
- **Konto anmelden**, wenn ein Lauf mit einem Anmeldefehler endet (das Epic steht dann auf „blockiert“).
- **Widerruf** einer Entscheidung: als Kommentar am Issue. Der Lauf setzt ihn im nächsten Zug oder in der Nacharbeit um.
- **Blockierte und abgebrochene Epics:** Der Grund steht am Issue.

Umschalten von `/epic-flotte` und zurück: `references/umschalten.md`.
