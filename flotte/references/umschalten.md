# Umschalten vom Leitstand auf `flotte` — und zurück

Umschalten heißt: Neue Einsätze startet der Treiber, nicht mehr der
Leitstand. Das lässt sich je Einsatz wählen. **Der Leitstand bleibt dabei nicht unverändert**:
Er bekommt die neue `merge.ps1` und mergt ab dem Einspielen in keinem Projekt mehr ohne
`merge: nach_gate`.

## Voraussetzungen

1. **Merge-Regel (#15) und die Stufen-PRs von `flotte` sind auf `main`**, in Reihenfolge.
2. **Bun ist installiert** (`bun --version`). Zur Laufzeit braucht der Treiber keine Pakete, also
   kein `bun install`.
3. **Beide Konten sind angemeldet.** Ein Test je Konto kostet einen Haiku-Aufruf:
   `claude -p --model haiku "OK"`, für Konto 2 mit
   `CLAUDE_CONFIG_DIR=<kontenordner 2>` (der Ordner aus `flotte/SKILL.md`, „Konten“).
4. **Je Projekt mit `merge: nach_gate`, auch mit CI:** Das Gate des Projekts schreibt die Basis in
   seine Kopfzeile (`Basis <remote>/<basis> @ <sha>` und `(HEAD <sha>)`). Sonst mergt die
   Merge-Regel nie, und das Epic wird nach den Nachbesserungen blockiert. In hexanite fehlt die
   Basis bisher; dort erst `gate/gate.mts` anpassen, bis dahin `merge: mensch`.
5. **Für die Merge-Schlange** braucht der Adapter `gate_command`: der Befehl, mit dem der Treiber
   das Gate im Epic-Worktree selbst fährt und an dem er den Gate-Aufruf eines Laufs erkennt. Ohne
   ihn lässt sich kein Gate nachweisen, und ein Mensch mergt.
   Wer die Wiederholungen klein halten will, trägt dazu `gate_areas` und `gate_always_command` ein
   (`epic/references/adapter.md`, „Merge“).

## Vor dem Umschalten, in dieser Reihenfolge

Eingespielt wird für die ganze Maschine, nicht für ein Repository: `merge.ps1`, `guard.ps1` und
`worktree.ps1` ändern sich für jede Sitzung in jedem Projekt, auch für eine, die schon läuft.

- Ab dann mergt der Leitstand nur noch bei `merge: nach_gate`. In jedem Projekt mit
  `merge: mensch` oder ohne den Schlüssel mergt ein Mensch.
- In hexanite heißt das: von Hand mergen, bis `gate/gate.mts` die Basis ausgibt und der Adapter auf
  `nach_gate` steht.
- Deshalb kommt der Adapter zuerst.
- Welche Projekte das trifft, sagt `bun <stapel>\flotte\src\cli.ts adapter`: die Projektadapter unter
  `~/git` ohne Schlüssel `merge`, gelesen von `origin/HEAD`. Einzelne Ordner gehen als Argumente.

1. **Auf der ganzen Maschine läuft keine Flotte und kein `/epic`,** in keinem Projekt und auf
   keinem Konto. Weder der Leitstand noch ein Fenster mit `/epic` arbeitet
   gerade. Einspielen, während eine davon läuft, ändert ihr die Merge-Regel und den Hook mitten im
   Einsatz.
2. **Adapter zuerst:** im Projektadapter `.claude/epic.md`, über einen PR auf die Basis:
   - `merge: mensch` (Standard) oder `merge: nach_gate`. **Achtung bei `nach_gate`:** Dann reicht
     ein `ready-for-agent`-Label (`ready_label`), auch an einem einzigen Kind eines Epics, damit ein
     Treiber ohne `--epics` das Epic einsammelt, baut und nach grünem Gate selbst mergt. Das Label
     erst setzen, wenn das gewollt ist.
   - Die Gate-Schlüssel (`gate_heading`, `gate_green`, `gate_base`,
     `gate_head`, `gate_partial`), falls der Block anders aussieht als der Standard, und
     `gate_command`, `gate_always_command`, `gate_areas` für die Merge-Schlange
     (`epic/references/adapter.md`, „Merge“).
   - Ein Repository ohne CI erkennt `merge.ps1` selbst (keine Workflows, keine Checks auf der
     Basis) und wartet dort nicht mehr zwei Minuten auf Checks.
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
     `arbeitspferd\leitstand\scripts\merge.ps1` nach `<skills>\leitstand\scripts\`
     (`<skills>`: der Skill-Ordner des Kontos, etwa `~/.claude/skills`).

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
   - **Außerhalb des Treibers:** Der Hook im Kopf von `/epic` gilt nur im Zug, der den Skill
     aufruft. Eine `/epic`-Sitzung deshalb mit
     `powershell -NoProfile -File <skills>\epic\scripts\fortsetzen.ps1 -Session <id>`
     fortsetzen (Konto 2: `-ConfigDir <kontenordner 2>`). Das Skript gibt
     `guard.ps1` über `--settings` mit, wie der Treiber. Mit blankem `claude --resume` läuft sie
     ohne `guard.ps1`.
5. **Das erste echte Epic mit `merge: mensch` fahren.** Es zeigt, was die Generalprobe nicht
   zeigen kann: den Anteil der Rückfragen mit einem Fable-Admiral, lange Züge von `/epic` unter
   `-p` und das Aufräumen mit Docker.

## Ein Einsatz mit dem Treiber

1. **Keine Flotte im selben Repository.** Der Leitstand führt dort keine Epics.
   Der Treiber sperrt nur gegen einen zweiten Treiber, nicht gegen den Leitstand.
2. **Starten:** im Terminal im Projektordner, nicht in einer Claude-Sitzung. Das Fenster bleibt
   offen, solange der Einsatz läuft. Repository und Forge nimmt der Treiber aus dem Ordner und
   aus `origin`. Ohne `--epics` nimmt er die Epics mit `ready_label` und sammelt alle 15 Minuten
   neu ein; er endet, wenn nichts mehr offen und nichts Neues freigegeben ist (`--dauerhaft`:
   er wartet weiter). Konten gehen als Kurzname (`1`, `2`, `3`, siehe `flotte/SKILL.md`).

   ```
   bun <skills>\flotte\src\cli.ts fahren --konten 1,2
   ```

   Fest auf einige Epics: `--epics 15,21`. Ein anderes Repository: `fahren <repo> --forge <owner/name>`.

   **Läufe auf Konto 2, Admiral auf Konto 1:** `--konten 2 --admiral 1`. Alle Admiral-Aufrufe
   laufen dann auf Konto 1, jeder Lauf auf Konto 2. Sollen Läufe Konto 1 nur begrenzt nutzen,
   nimmt man beide Konten in `--konten` und setzt `--konto-max 1=<n>`: höchstens n Epics arbeiten
   dort gleichzeitig. Ein gemergtes, blockiertes oder abgebrochenes Epic gibt seinen Platz frei.

3. **Tafel öffnen:** `<projekt>\.git\flotte\tafel.html`. Einem Lauf zusehen:
   `flotte zuschauen <projekt> <epic>` in einem zweiten Terminal.
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

## Rückweg zum Leitstand

1. **Treiber beenden** (Strg+C) und den Stand ansehen:
   `bun <skills>\flotte\src\cli.ts zustand <projekt>`. Dort steht je Epic Stufe,
   Konto, Sitzung, PR und ob gerade ein Prozess läuft (`pid`).
2. **Laufende Prozesse** zu Ende laufen lassen oder mit `taskkill /PID <pid> /T` beenden.
3. **Halter löschen:** `<projekt>\.git\flotte\halten\` leeren. Solange dort eine Datei je Epic
   liegt, lässt `CleanupStale` die Worktrees dieses Epics stehen. Erst danach räumt
   `worktree.ps1 -Action CleanupStale -RepoRoot <projekt>` sie ab.
4. **Offene Epics übergeben:**
   - Am sichersten übernimmt der Leitstand die Epics neu. Epic-Branches und PRs
     bleiben dabei bestehen.
   - Eine Sitzung lässt sich auf ihrem Konto auch mit vollem Kontext fortsetzen: im Projekt
     `fortsetzen.ps1 -Session <sitzung>` aus `epic\scripts`, für Konto 2 mit `-ConfigDir`. Das
     Skript gibt `guard.ps1` mit; blankes `claude --resume` liefe ohne den Hook.
5. **Offene PRs** bleiben offen. Wer mergt, bestimmt weiter der Adapterschlüssel `merge`, denn
   `merge.ps1` des Leitstands liest ihn genauso.
6. **Alte `merge.ps1` zurück,** nur wenn der Leitstand wieder ohne `merge: nach_gate` mergen soll:
   - `einrichten.ps1` hat die vorige Fassung gesichert, unter
     `<skills>-backup\arbeitspferd-<zeit>\leitstand\scripts\merge.ps1`.
   - Diese Datei nach `<skills>\leitstand\scripts\` zurückkopieren.
   - Die alten `guard.ps1` und `worktree.ps1` liegen von `install.ps1` unter
     `<skills>-backup\epic-<zeit>\scripts\`. Für den Merge durch den Leitstand
     brauchen sie nicht zurück.
   - Danach ruft der Treiber `merge.ps1` nicht mehr auf (Befund 7), und ein Mensch mergt seine PRs.
7. **Aufräumen:** `<projekt>\.git\flotte\` löschen, wenn der Zustand nicht mehr gebraucht wird.
   `flotte messen` liest Fragen und Wartezeiten aus `zustand.json`; vorher messen. Das
   Logbuch-Issue bleibt offen (es zählt in KIBO nie als Ticket) und steht am Ende auf
   `active: false`.

Der Rückweg braucht keine Änderung an `settings.json`. Am Leitstand nur
Schritt 6, und auch den nur, wenn er wieder ohne `merge: nach_gate` mergen soll.
