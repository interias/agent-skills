# Umschalten von `/epic-flotte` auf `flotte` — und zurück

`epic-flotte` und `leitstand` bleiben unverändert. Umschalten heißt: Neue Einsätze startet der
Treiber, nicht mehr der Admiral-Chat oder der Leitstand. Beides lässt sich je Einsatz wählen.

## Voraussetzungen

1. **Merge-Regel (#15) ist auf `main`.** Ohne sie mergt `merge.ps1` nach den alten Regeln und kennt `merge: mensch` nicht.
2. **Die Stufen-PRs von `flotte` sind auf `main`**, in Reihenfolge.
3. **Bun ist installiert** (`bun --version`). Der Treiber braucht zur Laufzeit keine Pakete, also kein `bun install`.
4. **Beide Konten sind angemeldet.** Ein Test je Konto, er kostet einen Haiku-Aufruf:
   `claude -p --model haiku "OK"`, für Konto 2 mit `CLAUDE_CONFIG_DIR=~/.claude-arbeitspferd`.

## Einrichten (einmal, von Stefan)

1. `install.ps1 -Skill flotte` kopiert den Ordner nach `~/.claude/skills/flotte`. Die Skripte findet der Treiber dort als Nachbarn: `~/.claude/skills/epic/scripts` und `~/.claude/skills/leitstand/scripts/merge.ps1`. Liegt im Hauptverzeichnis ein `flotte/node_modules`, vorher löschen: Es wird sonst mitkopiert und gebraucht wird es nicht.
2. **`settings.json` bleibt, wie es ist.**
   - Eine Statuszeile braucht es nicht; der Verbrauch kommt aus den Läufen selbst.
   - Eine Erlaubnisregel für den Merge braucht es nicht, weil der Treiber `merge.ps1` selbst aufruft und kein Lauf mergt.
   - `guard.ps1` sperrt `gh pr merge` in den Läufen weiter.
3. **Im Projektadapter `.claude/epic.md`** des jeweiligen Projekts, über einen PR:
   - `merge: mensch` (Standard) oder `merge: nach_gate`.
   - Bei Repos ohne CI die Gate-Schlüssel, falls der Block anders aussieht als der Standard.
   - Optional `nach_merge:` als Liste von Befehlen, die nach jedem Merge im Hauptverzeichnis laufen.

## Ein Einsatz mit dem Treiber

1. **Keine Flotte im selben Repository.** Weder `/epic-flotte` noch der Leitstand darf dort Epics führen. Der Treiber sperrt nur gegen einen zweiten Treiber, nicht gegen einen Admiral-Chat.
2. **Starten:** im Terminal, nicht in einer Claude-Sitzung. Das Fenster bleibt offen, solange der Einsatz läuft.

   ```
   bun ~/.claude/skills/flotte/src/cli.ts fahren C:\Users\stefa\git\<projekt> --forge interias/<projekt> --epics 15,21 --konten ~/.claude,~/.claude-arbeitspferd
   ```

3. **Tafel öffnen:** `<projekt>\.git\flotte\tafel.html`.
4. **Fragen** kommen als `FRAGE AN DEN MENSCHEN` ans Issue (mit GitHub-Benachrichtigung) und stehen auf der Tafel. Beantwortet werden sie mit `flotte antworten`; die Zeile zum Kopieren steht im Kommentar.
5. **Unterbrechen:** Strg+C beendet den Treiber.
   - Läufe, die gerade arbeiten, laufen bis zum Ende ihres Zugs weiter.
   - Ein neuer `fahren`-Aufruf mit denselben Epics setzt aus `zustand.json` fort: Er beobachtet lebende Läufe, liest die Ergebnisse beendeter Läufe aus deren Log und startet nichts doppelt.

## Rückweg zu `/epic-flotte` oder zum Leitstand

1. **Treiber beenden** (Strg+C) und den Stand ansehen: `bun ~/.claude/skills/flotte/src/cli.ts zustand <projekt>`. Dort steht je Epic Stufe, Konto, Sitzung, PR und ob gerade ein Prozess läuft (`pid`).
2. **Laufende Prozesse** zu Ende laufen lassen oder mit `taskkill /PID <pid> /T` beenden. Danach räumt `worktree.ps1 -Action CleanupStale -RepoRoot <projekt>` ihre Worktrees ab.
3. **Offene Epics übergeben:**
   - Eine Sitzung lässt sich auf ihrem Konto fortsetzen, mit vollem Kontext: im Projekt `claude --resume <sitzung>` (für Konto 2 mit `CLAUDE_CONFIG_DIR`).
   - Oder `/epic-flotte` bzw. der Leitstand übernimmt die Epics neu. Epic-Branches und PRs bleiben dabei bestehen.
4. **Offene PRs** bleiben offen. Wer mergt, bestimmt weiter der Adapterschlüssel `merge`: `merge.ps1` des Leitstands liest ihn genauso.
5. **Aufräumen:** `<projekt>\.git\flotte\` löschen, wenn der Zustand nicht mehr gebraucht wird. Das Logbuch-Issue bleibt offen (es zählt in KIBO nie als Ticket) und steht am Ende auf `active: false`.

Der Rückweg braucht keine Änderung an `settings.json`, an `epic-flotte` oder am Leitstand.
