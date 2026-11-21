# ADR-0004 — Der Brücken-Chat läuft über `claude -p` auf den Abo-Konten

**Status:** Entschieden
**Datum:** 2026-11-21

## Kontext
Der Bereitschaftsraum soll auch als Chat auf der Flottenbrücke laufen. Zur Wahl standen ein
API-Schlüssel direkt aus dem Brücken-Container, der Treiber als Träger und ein eigener Dienst.

## Entscheidung
Ein eigener Dienst `flotte chat` auf dem Rechner holt Chat-Nachrichten von der Brücke und führt
je Chat eine fortgesetzte `claude -p`-Sitzung (`--resume`) mit dem gewählten Konto aus.

## Begründung
So zahlt der Chat aus dem Abo wie die Läufe, nicht je Token, und gehorcht derselben
Verbrauchsbremse. Der Container kann `claude` nicht starten; der Treiber lebt je Repository und
endet mit seinem Einsatz, ein Chat gehört keinem Einsatz.

## Konsequenzen
Der Chat darf im Repository nur lesen und `flotte auftrag` aufrufen. Konto und Modell
(Standard Opus 5.5) wählt der Mensch je Chat. Die Brücke speichert nur Nachrichten und Stand,
keine Anmeldedaten.
