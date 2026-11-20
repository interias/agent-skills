# Brückenbilder

`board-v2.png` (1440 px breit) und `board-v2-handy.png` (390 px breit, doppelte Auflösung) im README
des Repositorys sind Bildschirmfotos der [Flottenbrücke](../../flottenbruecke/README.md) mit den
Beispieldaten aus `flottenbruecke/beispiel/bericht.json`. Neu aufnehmen:

1. Die Brücke lokal auf einem freien Port starten, `BRUECKE_DB` auf eine Wegwerfdatei, mit
   `BRUECKE_PIN` und `BRUECKE_TOKEN`.
2. Den Bericht posten, alle Zeitstempel so verschoben, dass `stand` jetzt ist (sonst wird das
   Projekt grau und die Wartezeiten stimmen nicht).
3. Die Seite bei 1440 px aufnehmen, „Erledigt heute“ und die Paketliste von #38 aufgeklappt; bei
   390 px mit Gerätefaktor 2 so, wie sie lädt. Jeweils die ganze Seite, Fensterhöhe gleich der
   Seitenhöhe, damit die feste Fußleiste unten steht.
4. Die Brücke wieder stoppen.
