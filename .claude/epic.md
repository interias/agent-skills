---
forge: github
api: https://api.github.com/repos/interias/agent-skills
push_remote: origin
issue_form: tickets
main_branch: main
base_branch: main
merge: mensch
ready_label: ready-for-agent
skip_labels: [needs-triage, needs-info, wontfix, ready-for-human]
epic_label: epic
glossary: CONTEXT.md
must_read: [CONTEXT.md, README.md]
test_commands:
  worktree: powershell -NoProfile -Command "Invoke-Pester .\epic\scripts\worktree.Tests.ps1"
  guard: powershell -NoProfile -Command "Invoke-Pester .\epic\scripts\guard.Tests.ps1"
  ram: powershell -NoProfile -Command "Invoke-Pester .\epic\scripts\ram.Tests.ps1"
  sweep: powershell -NoProfile -Command "Invoke-Pester .\epic\scripts\sweep.Tests.ps1"
  flotte: cd flotte && bun test
  bruecke: cd flottenbruecke && python -m pytest -q
isolation: none-needed
worktree_root: ../agent-skills-worktrees
commit_style: conventional-with-scope
commit_language: en
plan_artifact: publish
---

# Projektadapter für `/epic` — agent-skills

## Zugang

Kein Token im Repository. Die Forge ist GitHub (`interias/agent-skills`), angesprochen mit `gh`
und dessen Anmeldung. Das Repository ist öffentlich: keine lokalen Pfade mit Benutzernamen, keine
IPs, keine Transkriptinhalte, keine echten Verbrauchswerte in Issues, PRs und Commits.

## Isolation

`none-needed`: Die Pester-Tests bauen jedes Testrepository in `$TestDrive`, die Tests von `flotte`
und `flottenbruecke` laufen ohne Dienste. Wer die Brücke zum Ansehen startet, tut das im Worktree
mit eigenem Compose-Projekt auf freiem Port; der laufende Stack `flottenbruecke` (4747) und ein
laufender Treiber werden nie angefasst.

## Was hier anders ist als in einem Produktrepo

- Die Dateien dieses Repositorys **sind** die Skills, mit denen der Lauf selbst arbeitet. Ein Lauf
  liest seine Regeln aus der installierten Fassung unter `~/.claude/skills`, nicht aus dem
  Worktree; Änderungen wirken erst nach `install.ps1`. Ein Lauf ruft `install.ps1` nie auf.
- `install.ps1` installiert nur Skill-Ordner der obersten Ebene und `agents/*.md`.
- Gemergt wird von Hand (`merge: mensch`): Der Lauf endet mit einem offenen Pull Request.
- Commit-Nachrichten englisch mit Scope (`feat(epic): …`, `fix(epic-flotte): …`), PR-Titel deutsch.
