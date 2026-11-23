# ADR-0006 — Fernzugriff auf die Brücke über Tailscale, als Zusatz und nur zur Ansicht

**Status:** Entschieden
**Datum:** 2026-11-23

## Kontext
Die Flottenbrücke lief bisher nur im LAN. Nach ruhigen Wochen mit Komm soll der Mensch sie auch
unterwegs sehen (#48). Zur Wahl standen Tailscale und ein eigener Cloudflare-Tunnel mit
Zugangsschutz (Cloudflare Access), beide nur mit kostenlosen Leistungen.

## Entscheidung
Fernzugriff über Tailscale, als optionaler Zusatz: ein Compose-Profil `fernzugriff` mit einem
Tailscale-Container, standardmäßig aus. Der Container reicht im Tailnet per `tailscale serve` (HTTPS,
ohne Funnel) an einen eigenen Eingang der Brücke weiter, Port 8001 im Container, der auf dem Rechner
nirgends veröffentlicht ist. Über diesen Eingang ist die Brücke nur Ansicht: Seite und lesende
Endpunkte wie im LAN, jede Anfrage außer GET und HEAD wird abgelehnt, ebenso das Abholen von Treiber, Werft und Chat-Dienst
(ein GET, das schreibt), auch mit richtiger PIN. Der Cloudflare-Tunnel ist verworfen.

## Begründung
Tailscale braucht keine eigene Domain und keine öffentliche Adresse: Die Brücke ist nur für Geräte
im eigenen Tailnet erreichbar, und Tailscale stellt ein gültiges HTTPS-Zertifikat. Ein
Cloudflare-Tunnel macht die Brücke öffentlich erreichbar und hängt ihren Schutz allein an der Regel
in Cloudflare Access; dazu braucht er eine bei Cloudflare verwaltete Domain, und Cloudflare sieht
den Verkehr im Klartext.

Den Fernweg erkennt die Brücke am Eingang, nicht am Absender: Hinter Docker Desktop teilen sich oft
alle Geräte eine Adresse, und einen Kopf kann jeder Client im LAN selbst setzen. Ein zweiter
Listener im selben Prozess ist der einfachste tragfähige Weg: Die Brücke liest den Port des
Sockets, auf dem die Anfrage ankam, beide Eingänge teilen Speicher und PIN-Sperre, und im LAN ist
Port 8001 nicht veröffentlicht. Die Sperre gilt als Grundsatz für jede Methode außer GET und HEAD,
nicht als Liste von Endpunkten, damit auch jeder spätere Endpunkt gedeckt ist.

## Konsequenzen
Antworten, Handlungen und das Anmelden von Web-Push gehen weiter nur im LAN; unterwegs sieht der
Mensch die Lage und handelt am Rechner oder über `flotte antworten`. Der Schlüssel steht nur in der
`.env` und gelangt damit, wie die PIN, auch in die Umgebung des Brücken-Containers. Wer den Zusatz
einschaltet, braucht ein Tailscale-Konto und im Tailnet eingeschaltete HTTPS-Zertifikate. Ein
Handeln über den Fernweg wäre eine neue Entscheidung, frühestens mit der Geräteanmeldung (#46).
