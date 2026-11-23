---
# Adapter der Generalprobe des Flotten-Treibers (#14 in agent-skills)
merge: nach_gate
always_collide:
  - CHANGELOG.md
nach_merge:
  - git pull -q --ff-only
---
# Adapter flotte-probe

Probe-Repository ohne CI. Der Andockblock in der PR-Beschreibung ersetzt die Checks
(`mission/references/adapter.md`, „Andocken“).
