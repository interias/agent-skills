---
forge: gitea
api: http://mb-vsv-cast:3003/api/v1/repos/Breuckmann/agent-skills
push_remote: origin
forbidden_remotes: [github]
main_branch: main
ready_label: ready-for-agent
skip_labels: [needs-triage, needs-info, wontfix, ready-for-human]
epic_label: epic
glossary: CONTEXT.md
must_read: [CONTEXT.md, README.md]
test_commands:
  worktree: powershell -NoProfile -Command "Invoke-Pester .\epic\scripts\worktree.Tests.ps1"
  agentenflotte: cd agentenflotte && claude plugin test .
  guard: powershell -NoProfile -Command "Invoke-Pester .\epic\scripts\guard.Tests.ps1"
isolation: none-needed
worktree_root: ../agent-skills-worktrees
commit_style: conventional-with-scope
commit_language: en
plan_artifact: publish
---

# Projektadapter für `/epic` — agent-skills

## Zugang

Kein Token im Repository. Gitea wird mit Basic Auth aus dem Git-Credential-Speicher angesprochen
(`references/forge.md`, „Ohne Token"). `github` ist ein Spiegel auf GitHub, auf den kein Lauf pusht.

## Isolation

`none-needed`: Die Pester-Tests bauen jedes Testrepository in `$TestDrive`, die Plugin-Tests laufen
im Harness von `claude plugin test` mit gemockten Ereignissen. Es gibt keine Datenbank, keine Ports
und keine Dienste, die sich parallele Worktrees teilen könnten.

## Was hier anders ist als in einem Produktrepo

- Die Dateien dieses Repositorys **sind** die Skills, mit denen der Lauf selbst arbeitet. Ein Lauf
  liest seine Regeln aus der installierten Fassung unter `~/.claude/skills`, nicht aus dem
  Worktree; Änderungen wirken erst nach `install.ps1`. Ein Lauf ruft `install.ps1` nie auf.
- `install.ps1` installiert nur Skill-Ordner der obersten Ebene und `agents/*.md`. Experimentelle
  Fassungen liegen unter `experimente/` und werden dadurch nicht aktiv.
- Commit-Nachrichten englisch mit Scope (`feat(epic): …`, `fix(agentenflotte): …`), PR-Titel deutsch.
