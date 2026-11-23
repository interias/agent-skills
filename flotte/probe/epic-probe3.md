---
# Adapter of probe 3 of the fleet driver (#14 in agent-skills, round 5)
merge: nach_gate
issue_form: spec
ready_label: ready-for-agent
base_branch: main
commit_language: de
commit_style: conventional
plan_artifact: file
code_graph: off
isolation: none-needed
window: 2
test_commands: [pwsh -NoProfile -File werkzeug/gate.ps1]
env_files: [.env]
worktree_may_start: [compose]
ram_warn_percent: 85
ram_hold_percent: 90
ram_min_free_gb: 3
gate_command: pwsh -NoProfile -File werkzeug/gate.ps1 -Alle
gate_always_command: pwsh -NoProfile -File werkzeug/gate.ps1 -Immer
gate_areas:
  - alpha/ = alpha
  - beta/ = beta
  - gamma/ = gamma
nach_merge:
  - git pull -q --ff-only
---
# Adapter flotte-probe

Probe-Repository ohne CI. Der Andockblock in der PR-Beschreibung ersetzt die Checks
(`mission/references/adapter.md`, „Andocken“).

- **Andockprüfung:** `pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` im Missions-Worktree, nach dem
  letzten Commit. Seine Zusammenfassung (ab der letzten Zeile `== Gate: …Basis…`) gehört als
  Codeblock unter `## Gate` in die PR-Beschreibung.
- **Je Paket** reicht `pwsh -NoProfile -File werkzeug/gate.ps1` (nur die berührten Bereiche).
- **isolation: none-needed:** Jedes Paket legt eigene Dateien in seinem Bereich an; der
  Compose-Dienst in `gamma` hat keinen Zustand und je Worktree einen eigenen Projektnamen.
- **Bereiche:** `alpha/`, `beta/`, `gamma/`. Dateien dort sind kurze Textdateien; eine Datei darf
  nicht leer sein und nicht `ROT` enthalten.
- **Spec-Modus ohne Missionsziele:** Der Pull Request schließt die Spec mit `Closes #<spec>`.
