# Erfahrungswerte Verbrauch

Was ein Paket vom Planlimit gekostet hat, je Einsatz und Paketklasse eine Zeile, per Pull Request
nachgetragen. Prozent beziehen sich auf das 5-Stunden-Fenster des Plans, der in der Zeile steht.
Der Treiber rechnet damit nicht; er bremst nur nach den Stufen in `bremsen.md`,
„Verbrauchsbremse".

| Datum | Projekt | Plan | Paketklasse | Pakete | Kosten je Paket (Mittel, Spanne) | Runden-Einfluss | Eskalationen | Schwellen-Befund |
|---|---|---|---|---|---|---|---|---|

Prozent des Planlimits liefern nur `get_usage` und, unter dem Treiber, das `rate_limit_event` der
Läufe. Wohin der Verbrauch innerhalb eines Laufs ging —
je Rolle, je Paket, je Agent, und welche Werkzeugausgaben den Kontext gefüllt haben —, misst
`mission/scripts/usage.ps1` aus den Transkripten, auch nachträglich für abgeschlossene Läufe. Über einen
ganzen Einsatz, mit Cache-Quote und Kontextanteil je Agent-Typ: `flotte messen`, Abschnitt `tokens`
(`flotte/README.md`, „Messen“).
