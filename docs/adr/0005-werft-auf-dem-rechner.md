# ADR-0005 — Die Werft läuft auf dem Rechner, nicht im Brücken-Container

**Status:** Entschieden
**Datum:** 2026-11-21

## Kontext
Nach einem Merge auf `main` sollen die betroffenen Stacks von selbst nachgezogen werden, wie es
Coolify auf einer Plattform tut. Naheliegend wäre, das im FastAPI-Backend der Flottenbrücke zu tun,
die ohnehin läuft. Dazu bräuchte der Container den Docker-Socket des Rechners und die Repositorys.

## Entscheidung
Ein eigener Dienst `flotte werft` auf dem Rechner beobachtet `origin/main`, zieht die berührten
Stacks nach und fährt Migrationen; die Brücke hält nur Einstellungen, Stand und Freigaben.

## Begründung
Ein Container mit dem Docker-Socket ist faktisch Root auf dem Rechner, und die Brücke ist im LAN
erreichbar. Ein Dienst auf dem Rechner folgt dem Muster von Treiber und Chat-Dienst: Er holt bei der
Brücke ab, die Brücke befiehlt nichts direkt. Coolify wäre eine weitere Plattform neben den
Compose-Stacks.

## Konsequenzen
Was ein Repository bei welchem Pfad nachzieht, steht in seinem Adapter (Schlüssel `deploy`).
Migrationen in Testdatenbanken laufen selbst; eine Migration in eine Arbeitsdatenbank erst nach
geprüfter Sicherung und Freigabe des Menschen auf der Brücke.
