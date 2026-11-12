# Vorlage: Zusammenfassung einer Runde

Der Host schreibt sie als `runde<N>/ZUSAMMENFASSUNG.md`. Leser ist der Mensch, der entscheidet:
oben die Zahlen, dann die Befunde nach Gruppen, unten die Grenzen.

```markdown
# Persona-Review <Funktion>, Runde <N>: Zusammenfassung

- **Stand:** <Datum>, Code-Stand `<commit>`, lokal (<base_url>, Datenbankkopie `<local_db>`).
- **Besetzung:** <n> Personas, Modell <Modell>. <Folgerunde: dieselben Fälle auf neuen
  Datensätzen; neue Personas einzeln genannt.>
- **Daten:** <welche Stammdaten, was fehlt bewusst>.
- **Ablage:** Berichte in `berichte/<persona>.md`, Screenshots in `kit/<persona>/`.

## Überblick

| Persona | Fall | Einheiten | Klicks (davon Suche) | Klicks je Einheit | Noten V/K/E |
|---|---|---|---|---|---|
| … | … | … | … | … | … |
| **Summe** | | | | | |

V = Verständlichkeit, K = Klickaufwand, E = Vertrauen ins Ergebnis (1 = sehr gut, 5 = schlecht).
<Ein Satz: Wie viele kamen ans Ziel?>

## Vergleich mit Runde <N−1>  (nur Folgerunden)

| Persona | Einheiten | Klicks | davon Suche | Klicks je Einheit | V/K/E |
|---|---|---|---|---|---|
| … | a → b | a → b | a → b | a → b | a → b |
| **Summe gleicher Fälle** | | | | | |

**Was sich verbessert hat** / **Was gleich geblieben ist** / **Was schlechter wurde** — je mit der
Zahl und dem Ticket, das es erklärt.

## A. Fehler, im Code bestätigt

1. **<Befund>** (<Personas>):
   - **Ursache im Code:** `<datei:zeile>`, <Mechanismus>.
   - **Folge:** <was die Persona erlebt hat>.
   - **Vorschlag:** <kleinste Behebung>; vor dem Merge beheben? <ja/nein>

## B. Fehler laut Berichten, nicht im Code bestätigt

<Je Befund: Personas, was berichtet wurde, warum nicht bestätigt (gesucht wo, nicht nachstellbar).>

## C. Konzept, Entscheidung nötig

<Je Befund: was gebaut ist und wo es festgelegt ist, warum es nicht zur Arbeit passt, Optionen,
Empfehlung.>

## D. Testdaten und Stammdaten, kein Code

## E. Kleinigkeiten

## Nicht als Befund gewertet

<Je Punkt der Grund.>

## Vorschläge für weniger Klicks, nach Wirkung

## Grenzen dieser Runde

- Die Personas sind Modelle, keine Menschen. Klickzahlen sind Schätzungen aus Skripten.
- <Was nur lokal so ist, z. B. Entwicklungs-Overlays.>
- <Was an den Testdaten liegt.>
```

## Rundenvergleich lesen

- **Klicks je Einheit** und **Suche** sind die Leitzahlen. Die Gesamtklicks steigen, wenn Personas
  in der Folgerunde mehr erfassen, weil es leichter geht; das ist kein Rückschritt.
- **Vertrauen** als Mittel über die gleichen Fälle; neue Personas getrennt ausweisen.
- Verglichen werden nur gleiche Fälle mit gleichem Modell. Eine Abweichung davon steht im Kopf.
- Jede Verbesserung nennt das Ticket oder die Änderung, die sie erklärt; eine Verbesserung ohne
  Erklärung ist Streuung, bis die nächste Runde sie bestätigt.
