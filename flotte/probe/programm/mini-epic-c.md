=== epic: Probe-Programm C: Themen
> **Reihenfolge:** Kinder: {{kinder}}

## Was
Zu dem hellen Thema in `thema/` kommen zwei weitere. Die beiden Missionsziele sind voneinander
unabhängig.

## Abnahmekriterien
- Alle Missionsziele sind angedockt.
- `pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` im Missions-Worktree.
=== kind c1: Thema nacht anlegen
Teil von #{{epic}}

## Was
Ein dunkles Thema für die Nacht.

## Abnahmekriterien
- `thema/nacht.txt` existiert und enthält genau die Zeile `Hintergrund: schwarz, Schrift: hellgrau`.
- Die Andockprüfung des Pakets ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1` im Worktree des Pakets.
=== kind c2: Thema sommer anlegen
Teil von #{{epic}}

## Was
Ein warmes Thema für den Sommer.

## Abnahmekriterien
- `thema/sommer.txt` existiert und enthält genau die Zeile `Hintergrund: sandgelb, Schrift: dunkelblau`.
- Die Andockprüfung des Pakets ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1` im Worktree des Pakets.
