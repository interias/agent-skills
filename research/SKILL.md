---
name: research
description: Eine Frage anhand hochwertiger Primärquellen untersuchen und die Ergebnisse als Markdown-Datei im Repository festhalten. Für Themenrecherche, Fakten aus Dokumentation oder API und ausgelagerte Leserarbeit.
---

# Recherche

Eine Recherche beantwortet **eine Frage** aus **Primärquellen** und hinterlässt eine Datei, auf die
sich andere stützen können. Die Lesearbeit gibst du einem Kundschafter (Subagent im Hintergrund;
er liest und schreibt nur die eine Notiz), damit du weiterarbeitest, während er liest.

## Auftrag an den Kundschafter

Gib ihm die Frage, was schon bekannt oder ausgeschlossen ist, und wo er suchen darf. Er soll:

1. **Primärquellen** nutzen — offizielle Dokumentation, Quellcode, Spezifikationen, erstanbietende
   Schnittstellen —, keine Zweitdarstellung davon. Jede Aussage führt er bis zur Quelle zurück, die
   sie besitzt.
2. Zu jeder Aussage die **Fundstelle** nennen (Adresse oder Datei mit Zeile, Version oder Datum des
   Stands). Was er nicht belegen kann, steht als **ungeprüft** da, nicht als Fakt.
3. Alles in **einer** Markdown-Datei festhalten: die Frage, die Antwort in wenigen Sätzen vorweg,
   dann die Belege, zuletzt offene Punkte und Widersprüche zwischen Quellen.

## Ablage

Dorthin, wo das Repository solche Notizen schon führt; passe dich der Konvention an. Gibt es keine,
wähle einen sinnvollen Ort und sag, welchen. Die Datei enthält keine Zugangsdaten und keine lokalen
Pfade mit Benutzernamen.

## Danach

Der Kundschafter nimmt nichts ab und schreibt nicht in die Forge. Ein „nichts gefunden“ übernimmst
du ungeprüft; ein Fund, auf den eine Entscheidung, ein Befund oder eine Löschung folgt, prüfst du an
der Quelle nach, bevor du dich darauf stützt. Was dauerhaft gilt (eine Entscheidung, ein Begriff),
gehört in ADR oder `CONTEXT.md`, nicht nur in die Notiz.
