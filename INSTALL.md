# Installieren und aktualisieren

Für den Agenten, der die Skills dieses Repositorys auf einem Rechner einrichtet oder nach einem
Merge aktualisiert. Alles läuft über `install.ps1` im Wurzelverzeichnis; das Skript beschreibt sich
selbst (`Get-Help .\install.ps1 -Detailed`).

## Voraussetzungen

- **Claude Code.** Die Skills `epic` und `epic-aufraeumen` sowie der Agent-Typ `epic-kundschafter`
  hängen `guard.ps1` als PreToolUse-Hook aus `~/.claude/skills/epic/scripts/` ein; `epic` muss
  dafür installiert sein.
- **Windows PowerShell 5.1 mit Pester 3.4** (liegt Windows bei) für die Tests der Skripte:
  `Invoke-Pester .\epic\scripts\<name>.Tests.ps1`.
- **Plugin `mattpocock-skills`**, eingerichtet nach [`mattpocock-skills/`](mattpocock-skills/README.md).
  `epic-nacharbeit` und `epic-lagebesprechung` setzen daraus `grilling` voraus.
- **Python mit Pillow** für die Skripte von `mail-antwort`.
- Nur für `experimente/scripts/spiegel.ps1`: Gitea-Zugang mit den Scopes `write:organization`,
  `write:repository` und `write:issue` (Token in `GITEA_API_TOKEN`, sonst `git credential fill`).

## Ablauf

1. **Auf `main` und aktuell sein:** `git status` sauber, `git pull`. Installiert wird der Stand des
   ausgecheckten Branches.
2. **Trocken prüfen** und die Ausgabe lesen:

   ```powershell
   powershell -File install.ps1 -DryRun
   ```

3. **Installieren:**

   ```powershell
   powershell -File install.ps1
   ```

   Nur einen Skill: `-Skill <ordnername>`. Die Agent-Typen bleiben dann unberührt.
4. **Nachprüfen:** Jeder Skill-Ordner des Repositorys liegt unter `~/.claude/skills/<name>` und
   jede Datei aus `agents/` unter `~/.claude/agents/`. Neue Skills und Agent-Typen greifen erst in
   einer neuen Sitzung.

## Was das Skript tut

- **Skills:** kopiert jeden Ordner der obersten Ebene mit `SKILL.md` — `epic`, `epic-aufraeumen`,
  `epic-flotte`, `epic-lagebesprechung`, `epic-nacharbeit`, `mail-antwort` — nach
  `~/.claude/skills/<name>`. `mattpocock-skills/` (ohne `SKILL.md`) und alles unter `experimente/`
  bleiben außen vor. Ein vorhandener Zielordner
  wird vorher nach `~/.claude/skills-backup/<name>-<Zeitstempel>/` gesichert und erst geleert,
  wenn die Sicherung nachweislich vollständig ist. Ordner unter alten Namen (`prd`, `prd-nacharbeit`,
  `prd-aufraeumen`, `prd-flotte`) werden gesichert und entfernt.
- **Agent-Typen:** kopiert `agents/*.md` nach `~/.claude/agents/`; eine abweichende vorhandene Datei
  wird vorher gesichert.

**Immer Kopie, nie Junction oder Symlink.** Ein rekursives Löschen folgt einem Link und löscht die
Quelle mit — passiert am 18.09.2026 in KOKOS mit `node_modules`-Junctions. Findet das Skript im
Ziel einen Reparse-Point, meldet es `ABORT`, lässt diesen Skill-Ordner oder diese Agent-Datei
unberührt und macht mit den übrigen weiter; am Ende steht trotzdem `Done.`. Jedes `ABORT` meldest
du, statt es zu umgehen.

## Ändern

`~/.claude/skills` wird nie direkt bearbeitet — das driftet unbemerkt vom Repo ab. Änderungen
gehen auf einen Branch und als Pull Request hierher; nach dem Merge `install.ps1` erneut laufen
lassen.

Im Zielprojekt erwarten die Epic-Skills eine Adapterdatei `.claude/epic.md`; ihr Vertrag steht in
[`epic/references/adapter.md`](epic/references/adapter.md). Die Einrichtung der vorgelagerten
Skills aus `mattpocock-skills` für Gitea: [`mattpocock-skills/`](mattpocock-skills/README.md).
