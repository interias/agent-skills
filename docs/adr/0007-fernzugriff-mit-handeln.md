# ADR-0007 — Über den Fernzugriff handelt ein Gerät wie im LAN

**Status:** Entschieden, löst den Teil „nur zur Ansicht“ von ADR-0006 ab
**Datum:** 2026-11-24

## Kontext
ADR-0006 hat den Fernweg über Tailscale auf Ansicht beschränkt und ein Handeln dort ausdrücklich
erst nach der Geräteanmeldung (#46) für denkbar erklärt. #46 ist gemergt: Jede Antwort und jede
Handlung verlangt ein gekoppeltes Gerät mit dem passenden Recht, und Rechte vergibt nur der Rechner
über seinen eigenen Eingang. Der Mensch hat den Fernzugriff eingerichtet, um unterwegs zu handeln,
nicht nur zu sehen (Stefan, 24.11.2026).

## Entscheidung
Über den Fernweg nimmt die Brücke die Schreibwege der Person an, mit derselben Prüfung wie im LAN:
Antworten, Handlungen, Werft-Handlungen, der Bereitschaftsraum, Web-Push an- und abmelden, Koppeln,
PIN prüfen und den Not-Aus auslösen. Eine feste Erlaubnisliste (`PERSON_FERN` in `app/main.py`) nennt
sie; jeder andere schreibende Weg und jede andere Methode bleibt dort `403`, ebenso das Abholen. Gesperrt
bleiben also die Wege der Dienste (Bericht, Quittungen, Holodeck, Werft-Bericht, Chat-Dienst) und die des
Rechners (Rechte, Entkoppeln, Not-Aus lösen).

## Begründung
Der Schutz hängt seit #46 am Gerät und seinem Recht, nicht mehr am Netz: Ein Gerät, das der Rechner
nicht freigegeben hat, handelt auch im LAN nicht. Der Fernweg ist nur für Geräte im eigenen Tailnet
erreichbar und spricht HTTPS mit dem Zertifikat von Tailscale, das Cookie des Geräts (`Secure`) geht
also auch dort. Eine Erlaubnisliste statt einer Sperrliste hält den Grundsatz aus ADR-0006: Ein neuer
Endpunkt ist über den Fernweg gesperrt, bis er bewusst dazukommt.

## Konsequenzen
Das Cookie gehört zum Namen, unter dem die Seite geöffnet wurde: Ein Handy koppelt sich unter dem
Tailnet-Namen einmal neu, und der Rechner gibt diesem Gerät das Recht. Wer ein entsperrtes, gekoppeltes
Gerät mit Handlungsrecht hat und im Tailnet ist, handelt ohne PIN (Entscheidung zu #46 vom selben Tag);
geht ein Gerät verloren, entkoppelt es der Rechner, oder jedes andere Gerät löst den Not-Aus aus.
Treiber, Werft und Chat-Dienst melden sich weiter nur am LAN-Eingang.
