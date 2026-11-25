# Bremsen

Was der Treiber in jedem Takt misst und wann er anhält, steht in `flotte/SKILL.md`, „Was der
Treiber tut", Punkt 3. Hier stehen die Stufen dahinter.

## Verbrauchsbremse

Die Flotte verbraucht das Planlimit des Kontos, und Zusatzverbrauch ist meist abgeschaltet: Ein
volles Limit bricht einen Lauf mitten im Paket ab. Eine Pause an einem sauberen Punkt ist billiger.
Im Programm: `src/werkzeuge/verbrauch.ts`.

**Messen:** Je Konto liefert das `rate_limit_event` der Läufe je Fenster (5 Stunden, Woche) den
Verbrauch in Prozent und die Zeit bis zum Reset. Die **Hochrechnung** ist
`verbraucht ÷ verstrichener Anteil des Fensters` — bei 48 % nach 2 von 5 Stunden also 120 %. In
den ersten 30 Minuten eines Fensters zählt nur der Verbrauch, die Hochrechnung schwankt dort zu
stark.

| Stufe | 5-Stunden-Fenster |
|---|---|
| **Grün** | Hochrechnung unter 90 % |
| **Gelb** | Hochrechnung 90–120 %, oder verbraucht über 60 % |
| **Rot** | Hochrechnung über 120 %, oder verbraucht über 85 % |

**Wochenfenster:** Liegt die Hochrechnung der Woche über 100 %, sinkt die Obergrenze der Flotte
auf 2, über 130 % auf 1 — unabhängig von der Kollisionsstufe.

Der Treiber schätzt nicht, was ein Paket kosten wird; er bremst nur nach diesen Stufen.

**Kontowahl:** Die Stufen entscheiden, welche Konten einen Lauf nehmen dürfen (grün, aktiv, unter
`--konto-max`, nicht nach einem 429 gedrosselt); die Reihenfolge darunter gleicht den Verbrauch aus.
Der gemessene Verbrauch enthält auch Arbeit außerhalb der Flotte (eigene Chats). Der **Vorsprung**
eines Kontos ist der übrige Anteil des Wochenlimits minus der übrige Anteil der Zeit bis zu seinem
Reset, in Punkten; was mehr übrig ist, als die Zeit verlangt, verfiele sonst ungenutzt. Zuerst kommt
das Konto mit dem größten Vorsprung; liegen Konten bis 5 Punkte darunter, gewinnt das mit mehr Luft im
5-Stunden-Fenster, dann das mit weniger laufenden Läufen, dann weniger Missionen. Ein Konto ohne
Messwert der Woche steht hinten. So wählt der Treiber beim Start einer Mission, beim Ausweichen nach
einem 429 und beim Ausweichkonto des Admirals und des Triage-Laufs; eine laufende Mission wechselt
deshalb nie das Konto. Das Ereignis beim Start nennt den Grund („Start auf Konto 2: 24 Punkte
Vorsprung im Wochenfenster“), der Maschinenraum den Vorsprung je Konto. Im Programm:
`src/treiber/kontowahl.ts`.

**Verbrauch je Mission:** In jedem Takt liest der Treiber von den Transkripten der Läufe einer Mission
und ihrer Subagenten nur das Neue (Lesestand je Datei; die Sitzungen aus den Init-Zeilen der Logs unter
`laeufe/`) und zählt jede `message.id` einmal: Eingabe, Cache-Schreiben, Cache-Lesen, Ausgabe, die
gewichtete Summe (Eingabe + 1,25 Schreiben + 0,1 Lesen + 5 Ausgabe) und die Cache-Quote, je Paket und
Rolle. Frageblöcke des Admirals und Triage-Läufe zählen nicht mit. Der **Wochenanteil** ist geschätzt
(„≈“): der gemessene Wochenanteil des Kontos geteilt durch die gewichteten Tokens aller Missionsläufe
darauf im laufenden Wochenfenster (ab 1 Mio, sonst gilt die letzte Messung), mal die gewichteten
Tokens der Mission; weil andere Arbeit auf dem Konto mitzählt, liegt er eher zu hoch. Die Brücke
markiert die Zahl ab dem Doppelten des Mittels vergleichbarer abgeschlossener Missionen (gleiche
Paketzahl ± 1, sonst alle; aus `messungen.jsonl`) oder bei einer Cache-Quote unter 70 % ab 500 000
Eingabe-Tokens; nichts hält deshalb an. Die Endsumme steht im Logbuch der Brücke und ohne Anteil am
Planlimit als Zeile `Verbrauch: …` im Pull Request. Im Programm: `src/treiber/missionsverbrauch.ts`.

Die Schwellen sind ein **Entwurf** wie die Kollisionsstufen (`belegung.md`) und werden an echten
Einsätzen geschärft. Gemessene Kosten je Paket sammelt `verbrauch.md`; eine neue Zeile kommt per
Pull Request ins Skill-Repository.

## RAM-Bremse

Bricht der Speicher des Windows-Rechners ein, stürzt er mit allen Läufen ab. Gemessen wird mit dem
Skript von `/mission`:

```
powershell -NoProfile -ExecutionPolicy Bypass -File ~/.claude/skills/mission/scripts/ram.ps1 -RepoRoot <repo>
```

Stufen, Standards und die Schlüssel im Adapter: `mission/SKILL.md`, „Die RAM-Bremse". Laufende Pakete
laufen in jeder Stufe weiter; die Bremse hält nur Neues zurück.

- Ein Frageblock der Phase `ram` (ein Lauf hat selbst `hold` gemessen, `bloecke.md`) wird mit
  `warten` beantwortet, `weiter` folgt bei `ok`.
- **Schlägt die Messung fehl** (Exit 1 von `ram.ps1`), startet nichts; ohne Messwert gilt die
  Bremse als `hold`.
