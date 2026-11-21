=== epic: Probe-Programm A: Obstkorb
> **Reihenfolge:** Kinder: {{kinder}}

## Was
Drei Obstsorten bekommen je eine Datei im Bereich `obst/`. Die drei Kinder sind voneinander
unabhängig.

## Abnahmekriterien
- Alle Kinder sind gemergt.
- `pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` im Epic-Worktree.
=== kind a1: obst/apfel.txt anlegen
Teil von #{{epic}}

## Was
Eine Datei für den Apfel.

## Abnahmekriterien
- `obst/apfel.txt` existiert und enthält genau die Zeile `Apfel: suess und knackig`.
- Das Gate des Pakets ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1` im Worktree des Pakets.
=== kind a2: obst/birne.txt anlegen
Teil von #{{epic}}

## Was
Eine Datei für die Birne.

## Abnahmekriterien
- `obst/birne.txt` existiert und enthält genau die Zeile `Birne: saftig und weich`.
- Das Gate des Pakets ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1` im Worktree des Pakets.
=== kind a3: obst/pflaume.txt anlegen
Teil von #{{epic}}

## Was
Eine Datei für die Pflaume.

## Abnahmekriterien
- `obst/pflaume.txt` existiert und enthält genau die Zeile `Pflaume: blau und herb`.
- Das Gate des Pakets ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1` im Worktree des Pakets.
