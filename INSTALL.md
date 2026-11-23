# Installieren und aktualisieren

Für den Agenten, der die Skills dieses Repositorys auf einem Rechner einrichtet oder nach einem
Andocken aktualisiert. Alles läuft über `install.ps1` im Wurzelverzeichnis; das Skript beschreibt sich
selbst (`Get-Help .\install.ps1 -Detailed`).

## Voraussetzungen

- **Claude Code.** Die Skills `mission` und `mission-aufraeumen` sowie der Agent-Typ `kundschafter`
  hängen `guard.ps1` als PreToolUse-Hook aus `~/.claude/skills/mission/scripts/` ein; `mission` muss
  dafür installiert sein.
- **Windows PowerShell 5.1 mit Pester 3.4** (liegt Windows bei) für die Tests der Skripte:
  `Invoke-Pester .\mission\scripts\<name>.Tests.ps1`, für das Installationsskript
  `Invoke-Pester .\install.Tests.ps1`.
- **Optional: Graphify** für den Code-Graphen von `/mission` (`uv tool install graphifyy`). Ohne es
  läuft `/mission` ohne Graph.
- **Bun** im Benutzer-`PATH` für den Flotten-Treiber `flotte` (`bun --version`); zur Laufzeit braucht er
  keine Pakete.
- **Optional: Docker** für die [Flottenbrücke](flottenbruecke/README.md); `install.ps1` lässt sie aus.
- **Python mit Pillow** für die Skripte von `mail-antwort`.
- **Python mit Playwright und Chromium** für das Kit von `persona-review`; prüfen mit
  `python -P persona-review/scripts/selftest.py`.

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

- **Skills:** kopiert jeden Ordner der obersten Ebene mit `SKILL.md` (die Skills der Tabelle
  [„Die Teile“](README.md#die-teile)) nach `~/.claude/skills/<name>`. `arbeitspferd/` bleibt außen
  vor. Ein vorhandener Zielordner wird vorher nach `~/.claude/skills-backup/<name>-<Zeitstempel>/`
  gesichert und erst geleert, wenn die Sicherung nachweislich vollständig ist. Ordner unter alten
  Namen (`prd`, `prd-nacharbeit`, `prd-aufraeumen`, `epic`, `epic-nacharbeit`, `epic-aufraeumen`)
  werden gesichert und entfernt, sobald ihr neuer Name installiert wird. Wer von den alten Namen
  umsteigt, liest [`docs/UMSTELLUNG.md`](docs/UMSTELLUNG.md).
- **Agent-Typen:** kopiert `agents/*.md` nach `~/.claude/agents/`; eine abweichende vorhandene Datei
  wird vorher gesichert.
- **Entfernte Skills und Agent-Typen abräumen** (nur ohne `-Skill`): Installierte Kopien von
  Skills und Agent-Typen, die es im Repository nicht mehr gibt, stehen auf einer festen Liste im
  Skript; eine solche Kopie wird gesichert und entfernt, wenn ihr Frontmatter-Feld `name:` (in
  `SKILL.md` bzw. der Agent-Datei) genau ihren Namen trägt. Ein Ordner gleichen Namens mit anderem
  Inhalt oder ohne `SKILL.md` bleibt stehen, ebenso jeder Name, der nicht auf der Liste steht.

Das zweite Konto (Konfigordner, Startskripte, Theme,
Windows-Terminal-Profil) richtet `install.ps1` nicht ein, sondern
[`arbeitspferd/einrichten.ps1`](arbeitspferd/README.md) — nur auf Rechnern mit zweitem Konto.

**Immer Kopie, nie Junction oder Symlink.** Ein rekursives Löschen folgt einem Link und löscht die
Quelle mit — passiert am 18.09.2026 in KOKOS mit `node_modules`-Junctions. Findet das Skript im
Ziel einen Reparse-Point, meldet es `ABORT`, lässt diesen Skill-Ordner oder diese Agent-Datei
unberührt und macht mit den übrigen weiter; am Ende steht trotzdem `Done.`. Jedes `ABORT` meldest
du, statt es zu umgehen.

## Ändern

`~/.claude/skills` wird nie direkt bearbeitet — das driftet unbemerkt vom Repo ab. Änderungen
gehen auf einen Branch und als Pull Request hierher; nach dem Andocken `install.ps1` erneut laufen
lassen.

Im Zielprojekt erwarten die Missions-Skills eine Adapterdatei `.claude/epic.md`; ihr Vertrag steht in
[`mission/references/adapter.md`](mission/references/adapter.md).

## Das Plugin `mattpocock-skills` entfernen

Frühere Installationen setzten das Plugin `mattpocock-skills` voraus. Die Skills dieses
Repositorys brauchen es nicht mehr ([ADR-0001](docs/adr/0001-eigene-skills-statt-pocock.md)); wer
es noch hat, entfernt es:

```powershell
claude plugin uninstall mattpocock-skills@claude-plugins-official
```

`--scope project` oder `--scope local`, wenn es dort installiert wurde (Standard ist `user`).
Steht danach in der `settings.json` des Kontos noch der Eintrag
`"mattpocock-skills@claude-plugins-official": true` unter `enabledPlugins`, löschst du die Zeile.
Auf dem zweiten Konto die `settings.json` in dessen Konfigordner prüfen. Die Änderung greift in
einer neuen Sitzung. Ein Block `## Agent skills` in der `AGENTS.md` eines Zielprojekts und
`docs/agents/*.md`, die das Plugin konfigurierten, bleiben unberührt und schaden nicht.
