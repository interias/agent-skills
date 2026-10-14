# Installieren und aktualisieren

Für den Agenten, der die Skills dieses Repositorys auf einem Rechner einrichtet oder nach einem
Merge aktualisiert. Alles läuft über `install.ps1` im Wurzelverzeichnis; das Skript beschreibt sich
selbst (`Get-Help .\install.ps1 -Detailed`).

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

   Nur einen Skill: `-Skill <ordnername>`. Agent-Typen und Plugins bleiben dann unberührt.
4. **Nachprüfen:** Jeder Skill-Ordner des Repositorys liegt unter `~/.claude/skills/<name>`, jede
   Datei aus `agents/` unter `~/.claude/agents/`, und `claude plugin list` zeigt `agentenflotte`.
   Neue Skills und Agent-Typen greifen erst in einer neuen Sitzung.

## Was das Skript tut

- **Skills:** kopiert jeden Skill-Ordner nach `~/.claude/skills/<name>`. Ein vorhandener Zielordner
  wird vorher nach `~/.claude/skills-backup/<name>-<Zeitstempel>/` gesichert und erst geleert,
  wenn die Sicherung nachweislich vollständig ist. Ordner unter alten Namen (`prd`, `prd-nacharbeit`,
  `prd-aufraeumen`, `prd-flotte`) werden gesichert und entfernt.
- **Agent-Typen:** kopiert `agents/*.md` nach `~/.claude/agents/`; eine abweichende vorhandene Datei
  wird vorher gesichert.
- **Plugins:** installiert die Plugins aus `.claude-plugin/marketplace.json` über die `claude`-CLI im
  User-Scope, mit diesem Repo als Marketplace `breuckmann-agent-skills`. Claude Code liest das
  Plugin direkt aus diesem Ordner — ein Branchwechsel hier ändert den Mod der nächsten Sitzung. Ein
  Update greift nur, wenn `version` in `agentenflotte/.claude-plugin/plugin.json` steigt.

**Immer Kopie, nie Junction oder Symlink.** Ein rekursives Löschen folgt einem Link und löscht die
Quelle mit — passiert am 18.09.2026 in KOKOS mit `node_modules`-Junctions. Findet das Skript im
Ziel einen Reparse-Point, bricht es ab; diesen Abbruch meldest du, statt ihn zu umgehen.

## Ändern

`~/.claude/skills` wird nie direkt bearbeitet — das driftet unbemerkt vom Repo ab. Änderungen
gehen auf einen Branch und als Pull Request hierher; nach dem Merge `install.ps1` erneut laufen
lassen.

Im Zielprojekt erwarten die Epic-Skills eine Adapterdatei `.claude/epic.md`; ihr Vertrag steht in
[`epic/references/adapter.md`](epic/references/adapter.md). Die Einrichtung der vorgelagerten
Skills aus `mattpocock-skills` für Gitea: [`mattpocock-skills/`](mattpocock-skills/README.md).
