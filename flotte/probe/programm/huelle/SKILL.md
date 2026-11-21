---
name: epic-stapel
description: Hülle der Nachher-Probe des Epic-Programms (agent-skills#69, Stufe 4) in flotte-probe — fährt `flotte epic` für ein Epic unter dem Flotten-Treiber und reicht seine Blöcke FLOTTE-FRAGE und FLOTTE-ENDE durch. Nur auf Auftrag des Treibers.
allowed-tools: Bash(pwsh -NoProfile -File .claude/skills/epic-stapel/scripts/programm.ps1:*)
---

# Hülle: `flotte epic` unter dem Treiber

Das Programm `flotte epic` arbeitet das Epic ab: Schnitt, Tor, Pakete, Merges, Pull Request. Du
startest es über ein Skript und gibst seine Blöcke wörtlich weiter. Du liest keinen Code, baust
nichts, entscheidest nichts und fragst niemanden. `N` ist die Epic-Nummer aus dem Auftrag.

Jeder Befehl steht hier vollständig. Du rufst ihn mit dem Werkzeug Bash genau so auf, einzeln und
ohne etwas davor oder dahinter: kein `cd`, kein `&&`, keine Umleitung. Schlägt ein Aufruf fehl,
versuchst du ihn nicht in anderer Form, sondern beendest den Zug mit der Fehlermeldung.

## Warten auf den nächsten Block

Bash mit `timeout: 600000`:

```
pwsh -NoProfile -File .claude/skills/epic-stapel/scripts/programm.ps1 -Epic N
```

- Beginnt die Ausgabe mit `FLOTTE-FRAGE` oder `FLOTTE-ENDE`, beendest du den Zug. Dein letzter Text
  ist genau diese Ausgabe, Zeichen für Zeichen, ohne Zusatz davor oder danach.
- Beginnt sie mit `LAEUFT`, rufst du denselben Befehl sofort noch einmal auf.
- Bei jeder anderen Ausgabe (`PROGRAMM BEENDET`, `PROGRAMM GESCHEITERT`, ein Fehler) beendest du den
  Zug mit dieser Ausgabe als Text, ohne Block.

## Nachrichten des Treibers

Der erste Auftrag nennt das Epic: sofort „Warten auf den nächsten Block“.

Eine Nachricht `Flotte, Epic #N: Antwort … auf FLOTTE-FRAGE …` trägt nummerierte Zeilen wie
`1. A — Herkunft: …`. Für jede Zeile, die mit einer Zahl beginnt, ein Aufruf, die Zeile wörtlich in
einfachen Anführungszeichen (ein Apostroph in der Zeile fällt weg):

```
pwsh -NoProfile -File .claude/skills/epic-stapel/scripts/programm.ps1 -Epic N -Antwort '<Zeile>'
```

Danach „Warten auf den nächsten Block“. Bei jeder anderen Nachricht des Treibers (Leerlauf,
Verbindung, Nachfrage, neu eingereiht) ebenso sofort „Warten auf den nächsten Block“.
