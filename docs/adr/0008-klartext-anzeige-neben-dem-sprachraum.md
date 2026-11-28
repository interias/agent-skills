# ADR-0008 — Klartext-Anzeige neben dem Sprachraum

**Status:** Entschieden, ergänzt ADR-0003
**Datum:** 2026-11-28

## Kontext
Seit ADR-0003 spricht die Brücke durchgehend den Sprachraum (Mission, Andocken, Erster Offizier,
Holodeck …). Wer das Werkzeug neu benutzt und die üblichen Entwicklerbegriffe kennt (Epic, Merge,
Reviewer …), liest die Oberfläche schwer. Stefan hat in zwei Fragerunden am 28.11.2026 entschieden,
daneben eine Klartext-Anzeige anzubieten (#246).

## Entscheidung
Der Sprachraum bleibt Quelle und Standard. Die Brücke bietet je Gerät eine Klartext-Anzeige mit den
üblichen Entwicklerbegriffen. Skills, Forge-Kommentare, Windows-Meldungen des Treibers und die Doku
bleiben im Sprachraum; Labels, Adapter-Schlüssel, Befehle, Skillnamen, Anker und URLs bleiben
unverändert — der Modus ist reine Anzeige.

- **Eine Begriffstabelle** (`flottenbruecke/app/static/klartext.json`) trägt alle Klartext-Begriffe:
  die Tabelle Sprachraum → Klartext, die Wortformen mit Artikel und Fall für die Texte von Treiber und
  Läufen und die zweite Fassung der festen Texte der Brücke. Seite und Push lesen dieselbe Datei.
- **Umfang:** die ganze Brücke (Bereiche, Kopf, Fuß, Dialoge, Hinweise, `aria-label`/`title`,
  Push-Meldungen) und die Texte, die Treiber und Läufe schicken, beim Anzeigen.
- **Nie ersetzt:** Issue- und PR-Titel, Antworten des Menschen, Chat-Nachrichten, Code in Backticks,
  Pfade, Links, Projektnamen und der Name „Flottenbrücke“.
- **Schalter je Gerät** im Maschinenraum (Einrichtung). Ein gekoppeltes Gerät trägt die Einstellung in
  der Brücke, damit der Push sie kennt; ein nicht gekoppeltes im Browser. Standard: Sprachraum.
- **Suche** findet beide Wortschätze.

## Begründung
Eine Anzeige statt eines zweiten Wortschatzes im Repository hält ADR-0003: Quelle, Doku und Forge
sprechen weiter eine Sprache, und keine Schnittstelle ändert sich. Eine einzige Datei für alle
Klartext-Begriffe hält den Wächter-Test scharf: Sie ist seine einzige begründete Ausnahme.

## Konsequenzen
Ein neuer fester Text mit einem Begriff des Sprachraums braucht seine zweite Fassung in der
Begriffstabelle; ein Test rendert jede Ansicht mit den Beispieldaten im Klartext und findet, was
fehlt. Ein neuer Begriff des Sprachraums bekommt eine Zeile in der Tabelle.
