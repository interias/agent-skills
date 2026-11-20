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

Strg+C hält nur den Treiber an; die Läufe arbeiten weiter, und ein Neustart setzt aus
`zustand.json` fort. Ein weiteres Konto zuschalten: [`SKILL.md`](SKILL.md), „Weiteres Konto
zuschalten“, eingerichtet nach [`arbeitspferd/README.md`](../arbeitspferd/README.md).

## Was der Treiber tut

1. **Belegen:** Kollisionsstufen und Reihenfolge-Kanten aus Adapter und Issues bestimmen, wie
   viele Epics gleichzeitig laufen (nie mehr als vier).
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

## Bei dir

Fragen, die der Admiral nicht entscheiden darf; das Mergen bei `merge: mensch`; eine Anmeldung,
wenn ein Konto abgemeldet ist; Widerruf einer Entscheidung als Kommentar am Issue.
