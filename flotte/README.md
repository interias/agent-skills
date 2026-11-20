# `flotte` für Menschen

Der Flotten-Treiber: ein Programm (TypeScript, läuft mit Bun), das mehrere `/epic`-Läufe
gleichzeitig als `claude -p` auf einem oder mehreren Konten fährt. Belegung, Bremsen, Merge,
Aufräumen, Tafel und Logbuch macht das Programm; ein Sprachmodell, der Admiral, entscheidet nur je
Frageblock. Die vollständige Beschreibung mit allen Schaltern steht in [`SKILL.md`](SKILL.md), der
Wechsel von und zu `/epic-flotte` in [`references/umschalten.md`](references/umschalten.md).

## Starten

Aus einem Terminal im Projektordner, nicht aus einer Sitzung:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" fahren --konten 1,2 --bruecke http://127.0.0.1:4747
```

| Schalter | Wirkung |
|---|---|
| `--konten 1,2` | Konten, auf die neue Epics verteilt werden; ein Epic bleibt bei seinem Konto |
| `--epics 15,21` | nur diese Epics; ohne Angabe alle freigegebenen, alle 15 Minuten neu eingesammelt |
| `--dauerhaft` | nicht enden, wenn nichts mehr freigegeben ist, sondern auf neue Epics warten |
| `--konto-max 3=1` | höchstens so viele Epics gleichzeitig auf diesem Konto |
| `--admiral <konto>` | alle Admiral-Aufrufe auf ein festes Konto legen |
| `--bruecke <url>` | Stand an die [Flottenbrücke](../flottenbruecke/README.md) melden, Antworten dort abholen |
| `--ohne-nacharbeit` | offene Punkte eines Laufs nicht mit `/epic-nacharbeit` abarbeiten |

## Anhalten und neu starten

Ein Lauf ist ein eigener `claude -p` in einer eigenen Prozessgruppe. Er schreibt sein Log selbst
und überlebt den Treiber; der Zustand steht nach jedem Takt in `zustand.json`. Ein Neustart prüft
je Epic PID und Startzeit: Ein Lauf, der noch lebt, wird nur beobachtet; einer, der inzwischen
endete, wird aus seinem Log ausgewertet. Nichts startet doppelt.

Anders der Merge: `merge.ps1`, das Gate des Treibers und die `nach_merge`-Befehle sind Kinder des
Treibers und sterben mit Strg+C mitten im Schritt. Deshalb zum Aktualisieren:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" anhalten .
```

Der Treiber startet dann nichts Neues mehr, lässt einen begonnenen Merge zu Ende laufen und endet
mit dem Ereignis „Angehalten auf Wunsch“. Danach aktualisieren und mit demselben Aufruf neu
starten. Läuft kein Treiber, wirkt die Datei `anhalten` beim nächsten Start sofort; löschen, wenn
das nicht gewollt ist.

Ein weiteres Konto zuschalten: [`SKILL.md`](SKILL.md), „Weiteres Konto
zuschalten“, eingerichtet nach [`arbeitspferd/README.md`](../arbeitspferd/README.md).

## Was der Treiber tut

1. **Belegen:** Kollisionsstufen und Reihenfolge-Kanten aus Adapter und Issues bestimmen, wie
   viele Epics gleichzeitig laufen (nie mehr als vier). Ein Epic mit dem Label `prio/hoch` (am Epic
   oder an einem Kind) kommt als erstes in die nächste Belegung; kollidiert es mit einem laufenden,
   wartet es, und nichts Kollidierendes überholt es. Laufende Epics werden nie abgebrochen.
2. **Bremsen** in jedem Takt: RAM, Plattenplatz und Verbrauch je Konto. Gelb startet nichts Neues,
   Rot hält auch Fortsetzungen an.
3. **Fragen** eines Laufs gehen an den Admiral. Er entscheidet, was sich bis zum Merge widerrufen
   lässt; der Rest geht an dich, auf Tafel, Issue und Brücke.
4. **Nacharbeit:** Nennt das Ende eines Laufs offene Punkte, setzt der Treiber ihn einmal mit
   `/epic-nacharbeit` fort, solange der PR offen ist.
5. **Mergen** nur nach dem Adapterschlüssel `merge`: bei `mensch` meldet er „PR bereit“, bei
   `nach_gate` reiht er den PR in die Merge-Schlange und mergt mit `merge.ps1`, nur mit
   Gate-Nachweis aus dem Log des Laufs (fehlt er, fährt er das Gate selbst).
6. **Nach dem Merge** die `nach_merge`-Befehle des Adapters, dann Aufräumen (`CleanupStale`, der
   lokale Epic-Branch, wenn er ganz in der Basis liegt).

Den Stand zeigen die Tafel (`<git common dir>/flotte/tafel.html`), das Logbuch-Issue mit Label
`flotte` und die Brücke. Einzelne Befehle wie `flotte zustand`, `flotte antworten` und
`flotte zuschauen` stehen in [`SKILL.md`](SKILL.md).

## Prognose

Die Brücke sagt je wartendem Epic „voraussichtlich 3–5 h“ und oben in „Erledigt heute“, wann der
Backlog etwa leer ist. Gerechnet wird je Repository aus dem, was der Treiber dort gemessen hat:

- **Messen:** Je fertigem Epic schreibt der Treiber eine Zeile in
  `<git common dir>/flotte/messungen.jsonl`. Sie überdauert Einsätze. In der Zeile stehen:
  - die Arbeitszeit vom ersten Start bis zum letzten `FLOTTE-ENDE`, ohne die Zeit, in der der ganze
    Lauf auf dich wartete;
  - die Gate-Zeit des Treibers und das Konto;
  - je Paket die Klasse (mechanisch, Standard, Urteil, Urteil-hoch) und die Eskalationen, gelesen
    aus den Implementer-Aufrufen im Log des Laufs.
- **Rechnen:** Monte-Carlo über die gemessenen Verteilungen statt eines Mittelwerts, 2000 Züge mit
  festem Seed. Je Zug kommen aus den Messungen:
  - ein Tempo (Arbeitszeit je gewichtetem Paket eines fertigen Epics);
  - die Pakete des neuen Epics mit Klasse und Eskalationen;
  - eine Gate-Zeit.

  Die Komplexität zählt über die Klasse (Gewicht 0,5 / 1 / 2 / 3, je Eskalation +1), verteilt auf
  bis zu drei Pakete gleichzeitig, nicht über die bloße Zahl der Tickets. Für den Backlog verteilt
  die Rechnung alle freigegebenen, noch offenen Epics auf die Plätze der Obergrenze. Ein laufendes
  Epic braucht dabei nur noch seinen Rest. Angezeigt wird die Spanne P50–P90.
- **Schwelle:** erst ab 5 gemessenen Epics (Adapter `prognose_ab`). Vorher zeigt die Brücke
  „Prognose ab 5 Epics · bisher N“. Jedes weitere Epic rechnet sie von selbst mit.
- **Selbstprüfung:** Beim ersten Start eines Epics merkt sich der Treiber die Prognose; am Ende hält
  er fest, ob die echte Dauer samt Gate zwischen P10 und P90 lag. Die Brücke zeigt „traf 7 von 10“.
  Liegt die Quote ab 5 geprüften Epics unter 60 %, blendet sie die Prognose aus: „zu ungenau für
  dieses Projekt“.
- **Wartezeit auf dich** ist nirgends eingerechnet; die Brücke sagt das dazu.

`flotte messen` gibt die Messungen unter `prognose` mit aus: Anzahl, Verteilungen, Pakete je Klasse
und Trefferquote.

## Bei dir

Fragen, die der Admiral nicht entscheiden darf; das Mergen bei `merge: mensch`; eine Anmeldung,
wenn ein Konto abgemeldet ist; Widerruf einer Entscheidung als Kommentar am Issue oder auf der
Brücke; ein blockiertes Epic neu einreihen oder aufgeben (Brücke); Vorrang mit `prio/hoch`.
