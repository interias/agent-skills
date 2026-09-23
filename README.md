# agent-skills

Dieses Repository ist die versionierte Quelle für Claude-Code-Skills, die bisher nur lokal
unter `~/.claude/skills` lagen. Änderungen laufen ab jetzt über dieses Repo, nicht mehr direkt
am lokalen Ordner.

## Enthaltene Skills

- **prd** — Ein PRD-Issue samt Kind-Tickets, oder ein Spec-Issue mit sieben Abschnitten
  (`issue_form: prd` / `spec`), auf einem Epic-Branch abarbeiten: Graph planen, bis zu drei Pakete
  parallel in eigenen Worktrees umsetzen, jedes abgenommene Paket sofort in den Epic-Branch
  mergen, mit offenem Pull Request enden. Für Gitea, GitHub und GitLab.
- **prd-nacharbeit** — Die offenen Punkte eines abgeschlossenen `/prd`-Laufs abarbeiten:
  Fragerunden im Frontier-Verfahren, je Punkt entscheiden ob er in diese Sitzung passt oder ein
  Ticket braucht, dann umsetzen und nachdokumentieren. Legt keine Issues ohne ausdrückliche
  Entscheidung an.
- **prd-aufraeumen** — Nach dem Merge des Pull Requests eines `/prd`-Laufs aufräumen: zurück auf
  den Basiszweig des Pull Requests, ziehen, dann Epic- und Ticket-Branches sowie Worktree-Reste
  nach Prüfung entfernen. Löscht nichts, dessen Commits nicht nachweislich im Basiszweig liegen.

Die drei Skills gehören zusammen: `prd-nacharbeit` und `prd-aufraeumen` setzen einen `/prd`-Lauf
voraus und verweisen im Text aufeinander. Alle drei kennen beide Modi (`prd` mit Kind-Tickets,
`spec` mit oder ohne Kinder) und erwarten im jeweiligen Zielrepo eine projektlokale Adapterdatei
`.claude/prd.md`. Der verbindliche Vertrag für deren Schlüssel — welche es gibt, was sie
bedeuten, was gilt, wenn einer fehlt — steht in [`prd/references/adapter.md`](prd/references/adapter.md).

Für die Skills davor (`grill-with-docs`, `to-spec`, `to-tickets` aus dem Plugin
`mattpocock-skills`) liegt hier keine Kopie, sondern die Einrichtung für unser Gitea:
[`mattpocock-skills/`](mattpocock-skills/README.md).

## Aufbau

```
prd/
  SKILL.md
  references/
prd-nacharbeit/
  SKILL.md
prd-aufraeumen/
  SKILL.md
mattpocock-skills/     keine Skills: Einrichtung des Plugins für Gitea
install.ps1
```

Jeder Ordner entspricht einem Skill-Namen unter `~/.claude/skills/<name>`.

## Installieren / Aktualisieren

Erst trocken prüfen, was passieren würde:

```powershell
powershell -File install.ps1 -DryRun
```

Dann tatsächlich installieren:

```powershell
powershell -File install.ps1
```

Nur einen einzelnen Skill installieren:

```powershell
powershell -File install.ps1 -Skill prd
```

Das Skript kopiert die Skill-Ordner nach `~/.claude/skills/<name>`. Ein vorhandener Zielordner
wird vorher nach `~/.claude/skills-backup/<name>-<Zeitstempel>/` gesichert; erst wenn die
Sicherung nachweislich vollständig ist (Dateizahl geprüft), wird der Zielordner geleert und neu
befüllt.

## Warum Kopie statt Junction/Symlink

Das Skript kopiert immer, verlinkt nie. Ein rekursives Löschen auf einen verlinkten Ordner folgt
dem Link und löscht die Quelle mit — das ist am 18.09.2026 in KOKOS mit
`node_modules`-Junctions passiert. Vor dem Löschen des Zielordners prüft das Skript zusätzlich
auf Reparse-Points und bricht ab, falls es welche findet.

## Änderungen nur über Branch + Pull Request

`~/.claude/skills` nie direkt editieren — das driftet unbemerkt von diesem Repo ab. Änderungen
an einem Skill gehören auf einen Branch und als Pull Request hierher; danach `install.ps1`
laufen lassen, um sie lokal zu übernehmen.

Die laufende Verallgemeinerung dieses Vorgehens (weitere Skills, CI, o.ä.) ist in
[Epic #1](http://mb-vsv-cast:3003/Breuckmann/agent-skills/issues/1) beschrieben.
