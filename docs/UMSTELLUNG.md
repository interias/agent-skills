# Umstellung auf den Sprachraum (ADR-0003)

Für alle, die diese Skills auf einem eigenen Rechner oder einer eigenen Forge (etwa Gitea)
betreiben und von den alten Namen (`/epic`, `epic-implementer-*`, …) umsteigen. Der Wechsel ist
hart: Es bleiben keine alten Namen als Weiterleitung stehen.

## Was sich ändert und warum

Skills, Befehle, Oberfläche und Texte sprechen den Wortschatz aus [`CONTEXT.md`](../CONTEXT.md)
(„Sprachraum“): Aus dem Epic wird die **Mission**, aus dem Kind das **Missionsziel**, aus dem Lauf
der **Außeneinsatz**, aus Implementer und Reviewer **Ingenieur** und **Erster Offizier**, aus Gate
und Merge **Andockprüfung** und **Andocken**. Entschieden ist das in
[ADR-0003](adr/0003-sprachraum-star-trek-harter-wechsel.md). Labels, Adapter-Schlüssel,
Branch-Präfixe und Skriptnamen bleiben technisch (siehe [unten](#was-technisch-bleibt)), damit kein
Projekt und kein Adapter angefasst werden muss.

## Alt → neu

**Skills und Slash-Befehle** (Ordner unter `~/.claude/skills/`)

| Alt | Neu |
|---|---|
| `/epic` | `/mission` |
| `/epic-nacharbeit` | `/mission-nacharbeit` |
| `/epic-aufraeumen` | `/mission-aufraeumen` |

`flotte` und die übrigen Skills heißen wie zuvor. Aufruf-Text des Treibers: „Rufe den Skill
`mission` mit #<nr> auf“ (Nacharbeit: „… `mission-nacharbeit` …“), Auftragspräfix
`Flotte, Mission #<nr>: …`.

**Treiber `flotte`**

| Alt | Neu |
|---|---|
| `flotte epic <nr> …` | `flotte mission <nr> …` |
| `--skill epic` (Standard) | `--skill mission` (Standard) |
| `--merge-skript` mit Standard `epic/scripts/merge.ps1` | Standard `mission/scripts/merge.ps1` |

Alle übrigen Unterbefehle (`fahren`, `anhalten`, `messen`, `lernen`, `triage`, `auftrag`, `adapter`, …)
und die Option `--epics` bleiben. Wer `--skill` oder `--merge-skript` mit den alten Werten übergibt, ändert sie in
seinem Startaufruf.

**Agent-Typen** (`subagent_type`, Dateien unter `~/.claude/agents/`)

| Alt | Neu |
|---|---|
| `epic-implementer-mechanisch` | `ingenieur-mechanisch` |
| `epic-implementer-standard` | `ingenieur-standard` |
| `epic-implementer-urteil` | `ingenieur-urteil` |
| `epic-implementer-urteil-hoch` | `ingenieur-urteil-hoch` |
| `epic-reviewer-standard` | `erster-offizier-standard` |
| `epic-reviewer-urteil` | `erster-offizier-urteil` |
| `epic-kundschafter` | `kundschafter` |
| `epic-lauf` (längst entfallen) | – |

Die Beschreibung der Agent-Aufrufe bleibt `Implementer #<nr> …` und `Reviewer #<nr> …`; der
Treiber liest sie für Detailansicht und Prognose.

**Skript- und Referenzpfade**

| Alt | Neu |
|---|---|
| `~/.claude/skills/epic/scripts/worktree.ps1` | `~/.claude/skills/mission/scripts/worktree.ps1` |
| `…/epic/scripts/guard.ps1` | `…/mission/scripts/guard.ps1` |
| `…/epic/scripts/ram.ps1` | `…/mission/scripts/ram.ps1` |
| `…/epic/scripts/sweep.ps1` | `…/mission/scripts/sweep.ps1` |
| `…/epic/scripts/merge.ps1` | `…/mission/scripts/merge.ps1` |
| `…/epic/scripts/usage.ps1` | `…/mission/scripts/usage.ps1` |
| `…/epic/scripts/graph.ps1` | `…/mission/scripts/graph.ps1` |
| `…/epic/scripts/fortsetzen.ps1` | `…/mission/scripts/fortsetzen.ps1` |
| `…/epic/references/adapter.md` | `…/mission/references/adapter.md` |
| `…/epic/references/forge.md` | `…/mission/references/forge.md` |
| `…/epic/references/worktree.md` | `…/mission/references/worktree.md` |
| `…/epic/references/lauftafel.md` | `…/mission/references/lauftafel.md` |
| `…/epic/references/lauftafel.html` | `…/mission/references/lauftafel.html` |

Der ganze Ordner `epic/` heißt jetzt `mission/`, auch `SKILL.md`, `README.md`, `scripts/README.md` und die
`scripts/*.Tests.ps1`; die Dateinamen darin bleiben.

Der Hook der Skills heißt jetzt `$HOME/.claude/skills/mission/scripts/guard.ps1 -Profile epic`; die
Profilnamen `epic`, `kundschafter` und `aufraeumen` bleiben. Steht der alte Pfad in eigenen
`settings.json`, Skripten oder Adaptern, ändert man ihn dort. Im Adapter dieses Repositorys
(`.claude/epic.md`) heißen die `test_commands` jetzt
`Invoke-Pester .\mission\scripts\{worktree,guard,ram,sweep,merge}.Tests.ps1`; wer sie in seinem
eigenen Adapter nennt, zieht sie nach.

**Brücke:** „5 h“ und „Woche“ heißen Hauptenergie und Reserveenergie. Schilde (freier Kontext) zeigt
die Brücke nicht, sie zeigt keinen Kontext.

## Was technisch bleibt

Diese Namen ändern sich nicht. Der Wächter-Test
([`flotte/test/waechter.test.ts`](../flotte/test/waechter.test.ts), `AUSNAHMEN`) nimmt sie als Wort aus
oder prüft sie nicht, weil sie in Code (Backticks) stehen:

- die Adapterdatei `.claude/epic.md`, das Label `epic` und alle Adapter-Schlüssel (`epic_label`,
  `merge`, `gate_command`, `gate_*`, …);
- die Branch-Präfixe `epic/<nr>-…` und `agent/<nr>-…`, der Worktree-Ordner `<worktree_root>/epic-<nr>`
  und der Code-Graph `.git/epic-graph/`;
- die Skriptnamen (`gate.ps1`, `merge.ps1`, …), die Profilnamen des Hooks und die Treiber-Option
  `--epics`;
- die Marken im Protokoll zwischen Lauf und Treiber: `FLOTTE-FRAGE`, `FLOTTE-ENDE`, `## Gate`,
  `Gate grün.`, die Überschrift `### Was das Epic offen lässt` und die Umgebungsvariable
  `EPIC_LOCK_HOLDER`;
- die Rollenschlüssel `implementer` und `reviewer` im Treiberprotokoll (etwa das Feld `phase`);
- der Probe-Skill `epic-stapel` und der Name des externen Skills `mattpocock-skills:grilling`.

## Installieren

Umgeschaltet wird in einem ruhigen Moment ohne laufenden Treiber: anhalten, mergen, installieren,
neu starten.

1. **Treiber anhalten:** im Projektordner
   `bun "$HOME\.claude\skills\flotte\src\cli.ts" anhalten .`. Der Treiber startet nichts Neues und
   endet; die Läufe selbst arbeiten weiter (siehe [unten](#was-mit-laufenden-einsätzen-geschieht)).
2. **Stand holen:** den Stand dieser Umstellung in die eigene Kopie des Repositorys mergen oder
   pullen (`git pull` auf `main`), dann
3. **Installieren,** wie in [`INSTALL.md`](../INSTALL.md): erst `powershell -File install.ps1 -DryRun`,
   Ausgabe lesen, dann `powershell -File install.ps1` (voller Lauf, ohne `-Skill`). Das Skript
   - installiert `mission`, `mission-nacharbeit`, `mission-aufraeumen` und die neuen Agenten
     (`ingenieur-*`, `erster-offizier-*`, `kundschafter`);
   - sichert für jeden installierten neuen Skill den alten Ordner (`epic`, `epic-nacharbeit`,
     `epic-aufraeumen`) nach `~/.claude/skills-backup/<alt>-<Zeitstempel>/` und entfernt ihn, ohne
     das Frontmatter zu prüfen; das gilt auch mit `-Skill mission` für `epic`;
   - sichert die alten Agent-Dateien `epic-implementer-*`, `epic-reviewer-*`, `epic-kundschafter` und
     `epic-lauf` unter `~/.claude/agents/` nach `~/.claude/skills-backup/agents-<Zeitstempel>/` und
     entfernt sie, aber nur bei einem vollen Lauf, nur wenn das Frontmatter-Feld `name:` genau den
     alten Namen trägt und die Datei kein Symlink ist. Sonst bleibt sie stehen, mit einer Zeile
     dazu; dann von Hand prüfen und löschen.

   Von Hand ist sonst nichts zu entfernen. Eigene Änderungen in den alten Ordnern liegen danach nur
   noch in der Sicherung.
4. **Eigene Verweise nachziehen:** alte Pfade und Namen aus der Tabelle oben in eigenen
   `settings.json`, Skripten, Adaptern und Startaufrufen ersetzen.
5. **Brücke** (falls sie läuft): `git pull`, im Ordner `flottenbruecke/`
   `docker compose up -d --build`. Treiber und Brücke gehören zusammen auf denselben Stand; ob eine
   alte Brücke mit einem neuen Treiber zusammenarbeitet, ist nicht geprüft.
6. **Neu starten:** den Treiber mit demselben Aufruf wie vorher starten (`fahren …`), in einer
   neuen Sitzung. Neue Skills und Agent-Typen greifen erst in einer neuen Sitzung.

## Was mit laufenden Einsätzen geschieht

- **Ein Lauf überlebt den Treiber** (ein eigener `claude -p`), `anhalten` beendet ihn nicht. Eine
  Sitzung, die mit dem alten Skill läuft, hat dessen Text und Hook (`…/skills/epic/scripts/guard.ps1`)
  schon geladen und liest den Skill nicht neu. Sobald installiert ist, gibt es den alten Ordner
  nicht mehr. Der Hook blockiert bei einem Fehler (`onFailure block`); eine Alt-Sitzung kann dann
  keine Shell-Befehle mehr ausführen (nicht geprüft). Deshalb vor dem Installieren **zu Ende laufen
  lassen**, bis kein Lauf mehr arbeitet (Ebene „Unterwegs“ der Brücke leer, oder
  `flotte zustand <repo>`), oder den Lauf anhalten.
- **Alte Logs bleiben lesbar.** Detailansicht, Prognose und `flotte messen` erkennen in den Logs
  früherer Läufe auch die alten Agent-Typen `epic-implementer-*` und `epic-reviewer-*`.
- **Offene Pull Requests, Missions-Branches (`epic/…`), Labels und `.claude/epic.md` bleiben
  gültig.** Eine Mission mit offenem PR braucht keinen Lauf; Nacharbeit und Aufräumen starten
  danach als `/mission-nacharbeit` und `/mission-aufraeumen`.
- **Einen angehaltenen Lauf fortsetzen** geht nur mit dem Skript am neuen Ort, nie mit blankem
  `claude --resume`; es gibt `guard.ps1` als Hook der Sitzung mit:

  ```powershell
  powershell -NoProfile -File "$HOME\.claude\skills\mission\scripts\fortsetzen.ps1" -Session <id>
  ```

  Für das zweite Konto kommt `-ConfigDir <Ordner>` dazu. Eine Sitzung aus der Zeit vor der
  Umstellung kennt aber noch den alten Skilltext mit den alten Pfaden. Sicherer ist, die Mission
  neu zu starten (`/mission #<nr>`, oder der Treiber startet sie): Der Lauf nimmt den vorhandenen
  Missions-Branch wieder auf.
