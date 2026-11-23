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
