# Brückenbilder

`board-v2.png` (1440 px breit) und `board-v2-handy.png` (390 px breit, doppelte Auflösung) sind
Bildschirmfotos der [Flottenbrücke](../../flottenbruecke/README.md) mit den Beispieldaten aus
`flottenbruecke/beispiel/bericht.json`. Neu aufnehmen:

1. Die Brücke lokal auf einem freien Port starten, `BRUECKE_DB` auf eine Wegwerfdatei, mit
   `BRUECKE_PIN` und `BRUECKE_TOKEN`.
2. Den Bericht posten, alle Zeitstempel so verschoben, dass `stand` jetzt ist (sonst wird das
   Projekt grau und die Wartezeiten stimmen nicht).
3. Die Seite bei 1440 px aufnehmen, „Erledigt heute“ und die Paketliste von #38 aufgeklappt; bei
   390 px mit Gerätefaktor 2 so, wie sie lädt. Jeweils die ganze Seite, Fensterhöhe gleich der
   Seitenhöhe, damit die feste Fußleiste unten steht.
4. Die Brücke wieder stoppen.

`bereit-tickets.png` und `bereit-tickets-handy.png` zeigen dasselbe Beispiel, auf die Zeile
„Bereit“ gescrollt (auf dem Handy „Unterwegs“ aufgeklappt), die Tickets von #41 aufgeklappt (#42 im spec-Modus ohne Leiste).
`tanks-uebrig.png` und `tanks-uebrig-handy.png` zeigen nur den Kopf mit den Tanks („62 % übrig“).
