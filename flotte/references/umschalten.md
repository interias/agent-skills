# Umschalten von `/epic-flotte` auf `flotte` — und zurück

Umschalten heißt: Neue Einsätze startet der Treiber, nicht mehr der Admiral-Chat oder der
Leitstand. Beides lässt sich je Einsatz wählen. `epic-flotte` bleibt unverändert, **der Leitstand
nicht**: Er bekommt die neue `merge.ps1` und mergt ab dem Einspielen in keinem Projekt mehr ohne
`merge: nach_gate`.

## Voraussetzungen

1. **Merge-Regel (#15) und die Stufen-PRs von `flotte` sind auf `main`**, in Reihenfolge.
2. **Bun ist installiert** (`bun --version`). Zur Laufzeit braucht der Treiber keine Pakete, also
   kein `bun install`.
3. **Beide Konten sind angemeldet.** Ein Test je Konto kostet einen Haiku-Aufruf:
   `claude -p --model haiku "OK"`, für Konto 2 mit
   `CLAUDE_CONFIG_DIR=C:\Users\stefa\.claude-arbeitspferd`.
4. **Je Projekt mit `merge: nach_gate` ohne CI:** Das Gate des Projekts schreibt die Basis in
   seine Kopfzeile (`Basis <remote>/<basis> @ <sha>` und `(HEAD <sha>)`). Sonst mergt die
   Merge-Regel nie, und das Epic wird nach den Nachbesserungen blockiert. In hexanite fehlt die
   Basis bisher; dort erst `gate/gate.mts` anpassen, bis dahin `merge: mensch`.

## Vor dem Umschalten, in dieser Reihenfolge

Eingespielt wird für die ganze Maschine, nicht für ein Repository: `merge.ps1`, `guard.ps1` und
`worktree.ps1` ändern sich für jede Sitzung in jedem Projekt, auch für eine, die schon läuft.

- Ab dann mergt der Leitstand nur noch bei `merge: nach_gate`. In jedem Projekt mit
  `merge: mensch` oder ohne den Schlüssel mergt ein Mensch.
- In hexanite heißt das: von Hand mergen, bis `gate/gate.mts` die Basis ausgibt und der Adapter auf
  `nach_gate` steht.
- Deshalb kommt der Adapter zuerst.

1. **Auf der ganzen Maschine läuft keine Flotte und kein `/epic`,** in keinem Projekt und auf
   keinem Konto. Weder der Leitstand noch `/epic-flotte` noch ein Fenster mit `/epic` arbeitet
   gerade. Einspielen, während eine davon läuft, ändert ihr die Merge-Regel und den Hook mitten im
   Einsatz.
2. **Adapter zuerst:** im Projektadapter `.claude/epic.md`, über einen PR auf die Basis:
   - `merge: mensch` (Standard) oder `merge: nach_gate`.
   - Bei Repositorys ohne CI die Gate-Schlüssel (`gate_heading`, `gate_green`, `gate_base`,
     `gate_head`), falls der Block anders aussieht als der Standard
     (`epic/references/adapter.md`, „Merge“).
   - Optional `nach_merge:`, eine Liste von Befehlen, die nach jedem Merge im Hauptverzeichnis
     laufen.
3. **Dann einspielen,** alle drei Skills. Der Treiber braucht ihre Skripte als Nachbarn:
   - `install.ps1 -Skill epic`: `guard.ps1` mit der Sperre gegen `gh pr merge` und `worktree.ps1`
     mit `EPIC_LOCK_HOLDER`.
   - `install.ps1 -Skill flotte`. Liegt im Hauptverzeichnis ein `flotte/node_modules`, vorher
     löschen. Es würde sonst mitkopiert, gebraucht wird es nicht.
   - **`leitstand`** mit der neuen `merge.ps1`: `install.ps1` spielt ihn nicht ein, das tut
     `pwsh -File arbeitspferd\einrichten.ps1`. Das Skript fasst auch das Terminal-Profil und das
     Theme an, deshalb vorher mit `-DryRun` ansehen. Wer das nicht will, kopiert nur
     `arbeitspferd\leitstand\scripts\merge.ps1` nach
     `C:\Users\stefa\.claude\skills\leitstand\scripts\`.

   Eine alte `merge.ps1`, die den Schlüssel `merge` nicht kennt, ruft der Treiber nicht auf. Er
   meldet das beim Start, und ein Mensch mergt.
4. **`settings.json` bleibt, wie es ist.**
   - Eine Statuszeile braucht es nicht; der Verbrauch kommt aus den Läufen selbst.
   - Eine Erlaubnisregel für den Merge braucht es nicht: Der Treiber ruft `merge.ps1` selbst auf,
     und kein Lauf mergt.
   - `guard.ps1` sperrt `gh pr merge` in den Läufen des Treibers auch nach `--resume`, weil der
     Treiber den Hook jedem Zug über `--settings` mitgibt. Eine Sperre blockiert das Epic erst,
     wenn der Zug daran scheitert, wenn dieselbe Regel ein zweites Mal sperrt oder bei der dritten
     Sperre im Epic.
   - **Außerhalb des Treibers gilt das nicht:** Der Hook im Kopf von `/epic` gilt nur im Zug, der
     den Skill aufruft. Eine `/epic`-Sitzung, die mit `claude --resume` fortgesetzt wird, läuft
     ohne `guard.ps1`.
5. **Das erste echte Epic mit `merge: mensch` fahren.** Es zeigt, was die Generalprobe nicht
   zeigen kann: den Anteil der Rückfragen mit einem Fable-Admiral, lange Züge von `/epic` unter
   `-p` und das Aufräumen mit Docker.

## Ein Einsatz mit dem Treiber

1. **Keine Flotte im selben Repository.** Weder `/epic-flotte` noch der Leitstand führt dort Epics.
   Der Treiber sperrt nur gegen einen zweiten Treiber, nicht gegen einen Admiral-Chat.
2. **Starten:** im Terminal, nicht in einer Claude-Sitzung. Das Fenster bleibt offen, solange der
   Einsatz läuft. Die Konten mit vollem Pfad angeben, ohne `~`: Die Shell löst nur die erste
   Tilde auf. Der Treiber erweitert zwar jede und bricht bei einem fehlenden Kontenordner ab, aber
   so bleibt der Befehl eindeutig.

   ```
   bun C:\Users\stefa\.claude\skills\flotte\src\cli.ts fahren C:\Users\stefa\git\<projekt> --forge interias/<projekt> --epics 15,21 --konten C:\Users\stefa\.claude,C:\Users\stefa\.claude-arbeitspferd
   ```

3. **Tafel öffnen:** `<projekt>\.git\flotte\tafel.html`.
4. **Fragen** kommen als `FRAGE AN DEN MENSCHEN` ans Issue, mit GitHub-Benachrichtigung, und
   stehen auf der Tafel. Beantwortet werden sie im Projektordner mit `flotte antworten . <epic>
   <frage> "<Antwort>"`. Die Zeile zum Kopieren steht im Kommentar.
5. **Unterbrechen:** Strg+C beendet den Treiber.
   - Seine Sperre (`treiber.lock`) gibt er nur frei, wenn das Signal bei ihm ankommt. Läuft er in
     einer PowerShell-Pipeline (etwa `… | Tee-Object`), kommt es nicht an; das war in der
     Generalprobe so. Die Sperre bleibt dann liegen, und der nächste `fahren`-Aufruf übernimmt sie,
     weil ihr Prozess tot ist.
   - Ein Lauf arbeitet in einer eigenen Prozessgruppe und schreibt sein Log selbst. Er macht
     seinen Zug zu Ende, auch wenn der Treiber hart stirbt. Getestet ist das in D16 (Treiberprozess
     mitten im Zug beendet) und in der Generalprobe.
   - Ein neuer `fahren`-Aufruf mit denselben Epics setzt aus `zustand.json` fort. Einen Lauf
     beobachtet er weiter, wenn PID und Startzeit noch zu ihm passen. Hat ein anderer Prozess die
     PID übernommen, liest er das Ergebnis aus dem Log. Er startet nichts doppelt.

## Rückweg zu `/epic-flotte` oder zum Leitstand

1. **Treiber beenden** (Strg+C) und den Stand ansehen:
   `bun C:\Users\stefa\.claude\skills\flotte\src\cli.ts zustand <projekt>`. Dort steht je Epic Stufe,
   Konto, Sitzung, PR und ob gerade ein Prozess läuft (`pid`).
2. **Laufende Prozesse** zu Ende laufen lassen oder mit `taskkill /PID <pid> /T` beenden.
3. **Halter löschen:** `<projekt>\.git\flotte\halten\` leeren. Solange dort eine Datei je Epic
   liegt, lässt `CleanupStale` die Worktrees dieses Epics stehen. Erst danach räumt
   `worktree.ps1 -Action CleanupStale -RepoRoot <projekt>` sie ab.
4. **Offene Epics übergeben:**
   - Am sichersten übernimmt `/epic-flotte` bzw. der Leitstand die Epics neu. Epic-Branches und PRs
     bleiben dabei bestehen.
   - Eine Sitzung lässt sich auf ihrem Konto auch mit vollem Kontext fortsetzen: im Projekt
     `claude --resume <sitzung>`, für Konto 2 mit `CLAUDE_CONFIG_DIR`. **Dann ohne `guard.ps1`:**
     Der Hook kam vom Treiber, und der Hook des Skills gilt nach `--resume` nicht. Die Sitzung
     deshalb nur unter Aufsicht weiterarbeiten lassen.
5. **Offene PRs** bleiben offen. Wer mergt, bestimmt weiter der Adapterschlüssel `merge`, denn
   `merge.ps1` des Leitstands liest ihn genauso.
6. **Alte `merge.ps1` zurück,** nur wenn der Leitstand wieder ohne `merge: nach_gate` mergen soll:
   - `einrichten.ps1` hat die vorige Fassung gesichert, unter
     `C:\Users\stefa\.claude\skills-backup\arbeitspferd-<zeit>\leitstand\scripts\merge.ps1`.
   - Diese Datei nach `C:\Users\stefa\.claude\skills\leitstand\scripts\` zurückkopieren.
   - Die alten `guard.ps1` und `worktree.ps1` liegen von `install.ps1` unter
     `C:\Users\stefa\.claude\skills-backup\epic-<zeit>\scripts\`. Für den Merge durch den Leitstand
     brauchen sie nicht zurück.
   - Danach ruft der Treiber `merge.ps1` nicht mehr auf (Befund 7), und ein Mensch mergt seine PRs.
7. **Aufräumen:** `<projekt>\.git\flotte\` löschen, wenn der Zustand nicht mehr gebraucht wird.
   `flotte messen` liest Fragen und Wartezeiten aus `zustand.json`; vorher messen. Das
   Logbuch-Issue bleibt offen (es zählt in KIBO nie als Ticket) und steht am Ende auf
   `active: false`.

Der Rückweg braucht keine Änderung an `settings.json` oder an `epic-flotte`. Am Leitstand nur
Schritt 6, und auch den nur, wenn er wieder ohne `merge: nach_gate` mergen soll.
