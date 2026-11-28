---
forge: github
api: https://api.github.com/repos/interias/agent-skills
push_remote: origin
issue_form: tickets
main_branch: main
base_branch: main
merge: nach_gate
gate_command: pwsh -NoProfile -File ./gate.ps1
gate_night_command: pwsh -NoProfile -Command "bun install --cwd flotte; ./gate.ps1"
lern_issue: 119
ready_label: ready-for-agent
skip_labels: [needs-triage, needs-info, wontfix, ready-for-human]
epic_label: epic
glossary: CONTEXT.md
must_read: [CONTEXT.md, AGENTS.md]
test_commands:
  worktree: powershell -NoProfile -Command "Invoke-Pester .\mission\scripts\worktree.Tests.ps1"
  guard: powershell -NoProfile -Command "Invoke-Pester .\mission\scripts\guard.Tests.ps1"
  ram: powershell -NoProfile -Command "Invoke-Pester .\mission\scripts\ram.Tests.ps1"
  sweep: powershell -NoProfile -Command "Invoke-Pester .\mission\scripts\sweep.Tests.ps1"
  merge: powershell -NoProfile -Command "Invoke-Pester .\mission\scripts\merge.Tests.ps1"
  install: powershell -NoProfile -Command "Invoke-Pester .\install.Tests.ps1"
  bruecke_einrichten: powershell -NoProfile -Command "Invoke-Pester .\flottenbruecke\einrichten.Tests.ps1"
  startskript: powershell -NoProfile -Command "Invoke-Pester .\flotte\startskript.Tests.ps1"
  nachtlauf_aufgabe: powershell -NoProfile -Command "Invoke-Pester .\flotte\nachtlauf-aufgabe.Tests.ps1"
  flotte: cd flotte && bun test
  bruecke: cd flottenbruecke && python -m pytest -q
isolation: none-needed
worktree_root: ../agent-skills-worktrees
commit_style: conventional-with-scope
commit_language: en
plan_artifact: publish
---

# Projektadapter für `/mission` — agent-skills

## Zugang

Kein Token im Repository. Die Forge ist GitHub (`interias/agent-skills`), angesprochen mit `gh`
und dessen Anmeldung. Das Repository ist öffentlich: keine lokalen Pfade mit Benutzernamen, keine
IPs, keine Transkriptinhalte, keine echten Verbrauchswerte in Issues, PRs und Commits.

## Isolation

`none-needed`: Die Pester-Tests bauen jedes Testrepository in `$TestDrive`, die Tests von
`flottenbruecke` laufen ohne Dienste. Die Tests von `flotte` brauchen seit #73 Docker: der
Gitea-Test (`flotte/test/gitea.test.ts`) startet je Lauf ein eigenes Compose-Projekt
`agent-skills-<pkg>-gitea-<pid>` auf freiem Port und räumt es mit `down -v` wieder ab. Das ist die
einzige Ausnahme von `worktree_may_start` (Standard), entschieden am Vorab-Tor von #75. Wer die
Brücke zum Ansehen startet, tut das im Worktree mit eigenem Compose-Projekt auf freiem Port; der
laufende Stack `flottenbruecke` (4747) und ein laufender Treiber werden nie angefasst.

## Was hier anders ist als in einem Produktrepo

- Die Dateien dieses Repositorys **sind** die Skills, mit denen der Lauf selbst arbeitet. Ein Lauf
  liest seine Regeln aus der installierten Fassung unter `~/.claude/skills`, nicht aus dem
  Worktree; Änderungen wirken erst nach `install.ps1`. Ein Lauf ruft `install.ps1` nie auf.
- `install.ps1` installiert nur Skill-Ordner der obersten Ebene und `agents/*.md`.
- Angedockt wird nach grüner Andockprüfung (`merge: nach_gate`, `gate.ps1`: bun test, pytest, Pester) vom Flotten-Treiber. Der Pester-Teil fährt die Suiten in Windows PowerShell 5.1 mit Pester 3.4 und ist nur grün, wenn `Invoke-Pester` ein Ergebnis mit einer Testzahl über 0 und ohne roten Test liefert; die Zeile `pester: Pester <version>, … Tests, … rot` im Log belegt die Zahl (#129, #165). Installiert (`install.ps1`) wird weiter von Hand, wenn kein Treiber läuft.
- Der Nachtlauf (`gate_night_command`) ist hier derselbe Lauf wie `gate_command`, denn `gate.ps1` hat keinen Cache; davor `bun install` in `flotte/`, weil sein Worktree kein `node_modules` mitbringt (kein `link_dirs`). Scheitert `bun install`, läuft `gate.ps1` trotzdem und endet rot (Typprüfung): ein Rot mit Halt, kein Fehler des Nachtlaufs; der Nachtbefehl allein kann einen Fehler nicht vom Rot trennen.
- Ist ein Punkt eines Frageblocks des Admirals nicht lesbar oder abgeschnitten, wird er nicht als entschieden übernommen; der Lauf fragt nach und setzt bis dahin nichts um, das von diesem Punkt abhängt (Herkunft: Lernschleife L1, 2026-11-23).
- Commit-Nachrichten englisch mit Scope (`feat(epic): …`, `fix(flotte): …`), PR-Titel deutsch.
