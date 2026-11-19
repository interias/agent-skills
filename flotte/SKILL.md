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

Weitere Befehle, jeder gibt genau ein JSON-Objekt aus:

- `flotte zustand <repo>`: Zustand und Sperre.
- `flotte antworten <repo> <epic> <frage> <Antwort>`: eine Antwort des Menschen an den laufenden Treiber.
- `flotte belegung`, `verbrauch`, `ressourcen`, `bloecke`, `lauf`: die Werkzeuge einzeln.
- `flotte messen <einsaetze.json>`: Kennzahlen aus den Transkripten. Unter dem Treiber liest es Fragen, Wartezeit, kalte Zeit und Starts aus `zustand.json` (`treiberZustand` im Einsatz).

## Was der Treiber tut

1. **Einer je Repository.** Die Sperre liegt in `<git common dir>/flotte/treiber.lock`, der Zustand daneben in `zustand.json`. Nach einem Neustart setzt der Treiber aus der Datei fort. Ein Lauf schreibt sein Log selbst und überlebt den Treiber. Läufe, die noch leben (PID und Startzeit passen), beobachtet der Treiber nur.
2. **Belegung** aus Adapter und Issues: Kollisionsstufen (keine 4, klein 3, mittel 2, groß 1 gleichzeitig, nie mehr als vier) und Reihenfolge-Kanten. Ein Epic startet erst nach dem Merge seines Vorgängers. Jede neue Belegung nennt ihren Beleg.
3. **Bremsen** in jedem Takt:
   - RAM über `ram.ps1`: `warn` und `hold` halten an, weiter geht es erst 5 Punkte unter der Warnschwelle. Ein Messfehler gilt als `hold`, mit seinem Fehlertext; die nächste gute Messung gibt frei.
   - Plattenplatz.
   - Verbrauch je Konto aus dem `rate_limit_event` der Läufe, in `<CLAUDE_CONFIG_DIR>/flotte/verbrauch.json`. Gelb startet nichts Neues, Rot hält auch Fortsetzungen an. Ein Wert, der älter als 30 Minuten ist, gilt als rot. Ein Lauf meldet nur etwa ein- bis zweimal je Zug, deshalb holt ab 15 Minuten ein Mini-Lauf mit Haiku einen frischen Wert, auch während auf dem Konto ein Lauf arbeitet. Das geschieht nur, wenn auf dem Konto etwas starten oder weiterlaufen will, also nicht, während alles auf den Menschen wartet.
4. **Fragen:** Der Admiral entscheidet, was sich bis zum Merge widerrufen lässt. Sein Schema lässt als `nr` nur die Nummern der Fragen zu. Jede Entscheidung kommt als Kommentar ans Issue; einflussreiche Entscheidungen kommen zusätzlich ins Logbuch. Was beim Menschen liegt, parkt nur die Pakete aus `Betrifft:`; die übrigen laufen weiter (`weiter ohne <Pakete>`).
5. **Fehler:**
   - Ein Fehlstart wird höchstens zweimal neu gestartet.
   - Bei einem Netzfehler setzt der Treiber höchstens zweimal mit `--resume` fort.
   - Endet ein Zug ohne Block, fragt der Treiber einmal nach; danach gilt der Lauf als abgebrochen.
   - Nach `--leerlauf-min` ohne Ausgabe beendet er den Zug und setzt ihn einmal fort. Beim zweiten Mal bricht er das Epic ab.
   - `permission_denials` blockieren das Epic, ohne zweiten Versuch.
   - Nach jedem toten Lauf räumt `CleanupStale` auf. Es verschont die Worktrees der Epics, die noch laufen oder warten: Jeder Lauf bekommt `EPIC_LOCK_HOLDER`, eine Datei in `<git common dir>/flotte/halten/`. Der Treiber löscht sie erst, wenn das Epic endet.
6. **Ende eines Laufs:**
   - Mit `merge: nach_gate` ruft der Treiber `merge.ps1` auf, neben der Schleife und einer nach dem anderen: Während `merge.ps1` auf Checks wartet, beantwortet der Treiber andere Läufe. Fehlt der Gate-Block oder ist er veraltet, geht der Auftrag zurück an den Lauf.
     - Nach zwei eigenen Nachbesserungen wird das Epic blockiert.
     - Zieht die Basis davon, weil ein anderes Epic gemergt wurde, zählt das getrennt, bis fünf.
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
