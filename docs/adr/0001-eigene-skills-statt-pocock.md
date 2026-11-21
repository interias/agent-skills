# ADR-0001 — Eigene Skills statt mattpocock/skills

**Status:** Entschieden
**Datum:** 2026-11-21

## Kontext
Die Grilling-, Spec- und Ticket-Kette und einige Werkzeug-Skills (`tdd`, `code-review`, …) kamen aus
`mattpocock/skills` (MIT). Der Satz wird dort laufend umgebaut; jede größere Änderung stört den
Arbeitsablauf. Er verlangt ein Setup, das unsere angepassten Fassungen überschreibt, schreibt
Tickets ohne unsere Pflichtabschnitte und kennt nur eine Frage je Runde.

## Entscheidung
Wir schreiben eigene, schlanke Skills für das, was wir nutzen, und entfernen mattpocock/skills
vollständig (Repository-Kopien und Plugin); die Herkunft steht in `QUELLEN.md`.

## Begründung
Wir brauchen wenig davon, aber genau zugeschnitten: ein Gespräch, aus dem fast immer ein Ticket
wird. Weiter mitzuziehen hieße fremde Umbauten nachzuvollziehen; daneben zu stellen hieße zwei
Wahrheiten. Übernommen werden die Ideen, die sich bewährt haben (vertikale Schnitte, ADR-Schwelle,
Fachsprache in `CONTEXT.md`), nicht die Dateien.

## Konsequenzen
Pflege liegt bei uns. Eigene Fassungen gibt es für `tdd`, `code-review`, `diagnosing-bugs`,
`codebase-design`, `research`, `prototype`; die Grilling-Kette geht im Bereitschaftsraum auf, der
Rest entfällt ersatzlos.
