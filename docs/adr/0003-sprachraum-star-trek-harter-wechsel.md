# ADR-0003 — Sprachraum Star Trek, harter Wechsel

**Status:** Entschieden
**Datum:** 2026-11-21

## Kontext
Brücke, Admiral und Logbuch klangen schon nach Star Trek, der Rest nach Werkzeug (Epic, Gate,
Implementer). Gewählt werden konnte zwischen nur Oberfläche, Oberfläche und Forge, und allem
einschließlich Skillnamen; dazu Umstellen mit Weiterleitung oder hart.

## Entscheidung
Skills, Befehle, Oberfläche und Texte sprechen den Wortschatz aus `CONTEXT.md` („Sprachraum“), im
ganzen Repository, mit einem harten Wechsel ohne alte Namen; Labels und Adapter-Schlüssel bleiben
technisch.

## Begründung
Ein Wortschatz, der überall gilt, ist eindeutig; Weiterleitungen hielten zwei Namen lebendig und
das Repository dick. Labels umzubenennen hätte jedes Projekt und jeden Adapter berührt, ohne dass
man sie in der Oberfläche sieht.

## Konsequenzen
Umgeschaltet wird in einem ruhigen Moment ohne laufenden Treiber: anhalten, mergen, installieren,
neu starten. Ein Wächter-Test findet Altbegriffe. Eine Umstellungsanleitung sagt Nutzern anderer
Installationen, was sich ändert.
