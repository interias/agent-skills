# Wackelige Tests

Gelesen, wenn ein Test zum zweiten Mal als Lastflake auffällt (`SKILL.md`, Phase 4c) — in der
Nacharbeit, nicht mitten im Paket. Ein wackeliger Test wird repariert, nie übersprungen oder
gelöscht (Regel 5).

## 1. Sichtbar machen

Erst belegen, dass er wackelt, und wie oft:

| Suite | Befehl |
|---|---|
| Playwright | `npx playwright test <datei> --repeat-each=20 --workers=<adapter>`; in der Abnahme `--fail-on-flaky-tests` |
| Vitest | `npx vitest run <datei> --sequence.shuffle --retry=0`, in einer Schleife 20-mal |
| Jest | `npx jest <datei> --runInBand`, 20-mal; dann mit der Worker-Grenze des Adapters |
| pytest | `pytest <datei> -p no:randomly --count=20` (pytest-repeat), dann mit `-p randomly` |

Rot nur parallel, einzeln immer grün: geteilter Zustand (Schritt 3). Rot auch einzeln: Zeit oder
Reihenfolge im Test selbst (Schritt 2).

## 2. Auf die Bedingung warten, nicht auf eine Zeit

Ein `sleep`, `setTimeout` oder `waitForTimeout` mit geratener Dauer ist die häufigste Ursache:
auf einem belasteten Rechner reicht die Zeit nicht. Ersetzen durch Warten auf genau das, was der
Test danach prüft, mit Obergrenze:

- Playwright: `await expect(locator).toHaveText(...)`, `page.waitForResponse(...)` statt
  `waitForTimeout`.
- Testing Library: `await findBy...` / `waitFor(() => expect(...))`.
- Allgemein: eine Schleife, die die Bedingung alle 50–100 ms prüft und nach einer festen Grenze mit
  einer Meldung scheitert, die sagt, worauf sie gewartet hat.

Eine feste Wartezeit bleibt nur, wo die Zeit selbst geprüft wird (Entprellung, Timeout), und dann
mit falscher Uhr (`vi.useFakeTimers()`, `jest.useFakeTimers()`, `freezegun`).

## 3. Den Verursacher per Bisektion finden

Rot nur in der vollen Suite heißt meist: ein **anderer** Test hinterlässt Zustand (Datei, globale
Variable, Datenbankzeile, Mock, Uhr). Den Verursacher halbieren statt raten:

1. Liste der Testdateien in der Reihenfolge des roten Laufs (Ausgabe oder `--listTests`).
2. Erste Hälfte vor dem wackeligen Test laufen lassen, dann ihn: rot → Verursacher in dieser
   Hälfte, grün → in der anderen.
3. Wiederholen, bis eine Datei übrig bleibt; in ihr ebenso nach Tests halbieren.

Der Verursacher räumt danach auf (`afterEach`, Transaktion zurückrollen, Mock zurücksetzen); der
wackelige Test bekommt zusätzlich ein eigenes Setup, statt sich auf einen sauberen Vorgänger zu
verlassen.

## Herkunft

obra/superpowers (`condition-based-waiting.md`, `find-polluter.sh`, MIT) und die CLIs von
Playwright, Vitest, Jest und pytest; nur die Ideen, eigener Text. Sparpaket vom 21.11.2026.
