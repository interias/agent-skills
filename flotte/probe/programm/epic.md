---
# Adapter of the before/after probe of the epic program (agent-skills#69, stage 0 and stage 4)
merge: nach_gate
issue_form: tickets
epic_label: epic
ready_label: ready-for-agent
dependency_source: [header, body]
base_branch: main
commit_language: de
commit_style: conventional
plan_artifact: file
code_graph: off
isolation: none-needed
window: 3
max_rounds: 3
test_commands:
  gate: pwsh -NoProfile -File werkzeug/gate.ps1
ram_warn_percent: 85
ram_hold_percent: 90
ram_min_free_gb: 3
gate_command: pwsh -NoProfile -File werkzeug/gate.ps1 -Alle
gate_always_command: pwsh -NoProfile -File werkzeug/gate.ps1 -Immer
gate_areas:
  - obst/ = obst
  - verse/ = verse
  - thema/ = thema
nach_merge:
  - git pull -q --ff-only
---
# Adapter flotte-probe

Probe-Repository ohne CI. Der Gate-Block in der PR-Beschreibung ersetzt die Checks
(`epic/references/adapter.md`, „Merge“).

- **Merge-Gate:** `pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` im Epic-Worktree, nach dem
  letzten Commit. Seine Zusammenfassung (ab der letzten Zeile `== Gate: …Basis…`) gehört als
  Codeblock unter `## Gate` in die PR-Beschreibung.
- **Je Paket** reicht `pwsh -NoProfile -File werkzeug/gate.ps1` (nur die berührten Bereiche). Das
  ist zugleich der einzige Testbefehl; ein Lauf ist ein Volllauf.
- **isolation: none-needed:** Jedes Paket arbeitet an kurzen Textdateien; es gibt keinen Dienst
  und keine Datenbank.
- **Bereiche:** `obst/`, `verse/`, `thema/`. Eine `.txt`-Datei darf nicht leer sein und nicht
  `ROT` enthalten. Was das Gate darüber hinaus verlangt, sagt seine Ausgabe.
- **Modus tickets:** Das Epic nennt seine Kinder in der Kopfzeile `> **Reihenfolge:** Kinder: …`,
  harte Kanten stehen im Kind unter `## Blocked by`. Der Pull Request schließt Epic und Kinder.
