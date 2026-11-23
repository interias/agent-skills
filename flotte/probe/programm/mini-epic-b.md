=== epic: Probe-Programm B: Verse mit Wächter
> **Reihenfolge:** Kinder: {{kinder}}

## Was
Die Andockprüfung bekommt einen Wächter für die Länge der Verse; danach kommt ein Vierzeiler, der ihn
ausreizt. Ein Zweizeiler ist davon unabhängig.

## Abnahmekriterien
- Alle Kinder sind angedockt.
- `pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` im Missions-Worktree.
=== kind b1: Wächter: Verse höchstens vier Zeilen
Teil von #{{epic}}

## Was
`werkzeug/gate.ps1` prüft im Bereich `verse`, dass keine `.txt`-Datei mehr als vier Zeilen hat.

## Implementation Decisions
- Die Prüfung gehört in die vorhandene Prüfung des Bereichs, nicht in ein eigenes Skript: Die
  Andockprüfung ist der einzige Testbefehl des Repositorys, und der Treiber erkennt nur seine Ausgabeform.
- Gezählt werden Zeilen mit Inhalt; eine abschließende Leerzeile zählt nicht. Grund: Editoren
  hängen sie unterschiedlich an, und der Wächter soll nicht vom Editor abhängen.

## Abnahmekriterien
- Eine `.txt`-Datei in `verse/` mit fünf Zeilen macht den Bereich `verse` rot, die Ausgabe nennt
  die Datei.
- Eine mit vier Zeilen (auch mit abschließender Leerzeile) bleibt grün.
- Alle übrigen Regeln der Andockprüfung und ihre Ausgabeform bleiben unverändert.

## Verifikationsweg
Positiv- und Gegenprobe mit je einer vorübergehenden Datei in `verse/`, danach entfernt;
`pwsh -NoProfile -File werkzeug/gate.ps1 -Alle` im Worktree des Pakets.
=== kind b2: verse/herbst.txt, ein Vierzeiler
Teil von #{{epic}}

## Blocked by
- #{{b1}}

## Was
Ein Vierzeiler über den Herbst.

## Abnahmekriterien
- `verse/herbst.txt` hat genau vier Zeilen und reimt sich paarweise.
- Die Andockprüfung des Pakets ist grün, mit dem Wächter aus #{{b1}}.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1` im Worktree des Pakets.
=== kind b3: verse/fruehling.txt, ein Zweizeiler
Teil von #{{epic}}

## Was
Ein Zweizeiler über den Frühling.

## Abnahmekriterien
- `verse/fruehling.txt` hat genau zwei Zeilen, die sich reimen.
- Die Andockprüfung des Pakets ist grün.

## Verifikationsweg
`pwsh -NoProfile -File werkzeug/gate.ps1` im Worktree des Pakets.
