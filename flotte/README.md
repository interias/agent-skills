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
| `--bruecke <url>` | Stand an die [Flottenbrücke](../flottenbruecke/README.md) melden, Antworten dort abholen, die Prototypen aus `prototypen/` (Adapter `prototype_dir`) fürs Holodeck schicken; für die Schiffsliste ruft er höchstens einmal je Minute je Konto `claude agents --json` auf (nur lesend) und meldet Konto, Ordnername (nie den Pfad), Name, Status, Art und Beginn der Sitzungen |
| `--ohne-nacharbeit` | offene Punkte eines Laufs nicht mit `/epic-nacharbeit` abarbeiten |

## Einstellungen ohne Neustart

Die Startparameter und die festen Schwellen sind nur Anfangswerte. Auf der Brücke (Maschinenraum,
mit PIN) lassen sich ändern: Epics gleichzeitig (1–4), Pakete je Epic gleichzeitig (1–3), die Konten
der Läufe, das Admiral-Konto, die 5-h-Schwellen der Verbrauchsbremse (gelb/rot) und je Konto „bis
100 % leerfahren“, die RAM-Schwelle, das Plattenminimum und der Leerlauf. Der Treiber prüft die
Grenzen selbst und lehnt einen ungültigen Wert mit einem Ereignis ab.

- **Wirkung ab dem nächsten Takt.** Nichts Laufendes wird abgebrochen: Eine gesenkte Obergrenze
  startet nur weniger, ein entferntes Konto startet nichts Neues, seine Läufe bleiben dort. Die
  Pakete je Epic stehen im Auftrag an `/epic` („höchstens N Pakete gleichzeitig“); eine Änderung
  erreicht laufende Läufe mit dem nächsten Fortsetzen.
- **Jede Änderung** steht als Ereignis und im Flottenlogbuch („Einstellung … von … → auf …, Mensch
  über die Brücke“). Die Brücke zeigt je Einstellung den Wert und woher er kommt (Start, Brücke,
  Standard).
- **Neustart:** Die Werte der Brücke stehen in `zustand.json` und gelten weiter. Ein Startparameter,
  der ausdrücklich gesetzt ist, gewinnt beim Start; das Ereignis nennt beide Werte.
- **Nicht einstellbar:** Merge-Regel (Adapter), Rechte, Geheimnisse, Updates.

Grenzen und Form: [`SCHNITTSTELLE.md`](../flottenbruecke/SCHNITTSTELLE.md), „Einstellungen“.

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
   lokale Epic-Branch, wenn er ganz in der Basis liegt). Nennt der Adapter `lern_issue`, schreibt
   nebenher die Lernschleife (`flotte lernen`, Haiku) höchstens drei belegte Vorschläge als Kommentar
   in dieses Issue. Umgesetzt wird nichts davon von selbst; du wählst aus.

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

## Messen

`flotte messen <einsaetze.json>` (Form: `messung/einsaetze.beispiel.json`) liest die Transkripte
der Läufe samt ihrer Subagenten und gibt je Einsatz unter anderem aus:

- **`tokens`:** Eingabe, Cache-Schreiben, Cache-Lesen und Ausgabe, je Agent-Typ, je Epic und je
  Paket, jeweils mit **Cache-Quote** (Lesen durch alles, was hineinging). Je Paket die Zahl der
  Implementer- und Reviewer-Läufe, also die **Review-Runden**.
- **`kontext_anteil`** je Agent-Typ: welcher Anteil seiner gewichteten Tokens auf Werkzeugergebnisse
  einer Art fällt — Test, Gate, Diff (`git diff/show/log`), Lesen, übrige Shell. Ein Ergebnis kostet
  einmal das Schreiben in den Cache und danach bei jedem weiteren Modellaufruf das Lesen. Der Anteil
  ist die **Obergrenze** dessen, was eine Maßnahme sparen kann, die diese Ergebnisse kürzt.
- **`verlauf`** (unter dem Treiber): Durchlaufzeit je Epic ohne Warten auf dich und die
  Fehlerquote (Rückgabe an den Lauf, blockiert, abgebrochen).

**Was das schon entschieden hat (21.11.2026).** Für das „Sparpaket“ aus der Skill-Recherche lief
`flotte messen` über alle Läufe der drei Konten vom 1. bis 21.11.2026 (448 Implementer und
Reviewer, 195 Pakete). Je Agent-Typ kosteten Testausgaben 0,4–0,5 % der Tokens, Diffs im Review
4,2–4,5 %, Lesen 5–10 %, übrige Shell 5–17 %; die Cache-Quote lag bei 96–98 %. 13 von 195 Paketen
brauchten eine zweite Review-Runde. Ein Hook, der Testausgabe kürzt, ein enger Nach-Review und ein
Review-Paket als Datei hätten höchstens diese Anteile treffen können; sie wurden deshalb nicht
übernommen (Begründung im Pull Request des Sparpakets).

## Bei dir

Fragen, die der Admiral nicht entscheiden darf; das Mergen bei `merge: mensch`; eine Anmeldung,
wenn ein Konto abgemeldet ist; Widerruf einer Entscheidung als Kommentar am Issue oder auf der
Brücke; ein blockiertes Epic neu einreihen oder aufgeben (Brücke); Vorrang mit `prio/hoch` oder auf
der Brücke; ein freigegebenes Epic aufnehmen, ein Epic pausieren und fortsetzen (Brücke, Sternenkarte).
