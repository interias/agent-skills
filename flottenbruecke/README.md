# Flottenbrücke

Ein kleiner, dauerhaft laufender Dienst (#28): Er zeigt alle Einsätze des Flotten-Treibers
(`flotte`) als Kanban-Board, über Repositorys und Konten hinweg, und nimmt die Antworten des
Menschen auf Fragen der Läufe entgegen. Nur im LAN, kein Tunnel. Die Brücke steuert sonst nichts:
kein Starten, Stoppen oder Mergen.

## Start

```
cp .env.example .env      # PIN eintragen, Port bei Bedarf ändern
docker compose up -d
```

Die Seite liegt unter `http://<rechner>:4747/` (Port aus `BRUECKE_PORT`), am Rechner wie vom
Handy im WLAN. Daten liegen im Docker-Volume `flottenbruecke_daten` (SQLite).

| Einstellung | Standard | Wofür |
|---|---|---|
| `BRUECKE_PORT` | `4747` | Port auf dem Rechner |
| `BRUECKE_BIND` | `0.0.0.0` | `127.0.0.1`: nur am Rechner |
| `BRUECKE_PIN` | leer | PIN fürs Antworten; leer schaltet das Antworten ab |
| `BRUECKE_TOKEN` | leer | optional: Treiber muss ihn als `X-Bruecke-Token` schicken |
| `BRUECKE_TZ` | `Europe/Berlin` | Zeitzone für „Gemergt (heute)“ |

Unter Windows muss die Firewall den Port im privaten Netz zulassen, damit das Handy ihn erreicht.

## Board

Spalten **Bereit**, **Läuft**, **Frage an dich**, **Merge-Schlange**, **Gemergt (heute)** und
**Blockiert**. Je Epic eine Karte mit Nummer, Titel, Repository, Konto, Segmentleiste der Pakete
und letztem Schritt mit Uhrzeit. Im Kopf die Bremsen je Konto als Stufe, RAM und Platte je
Rechner. Ein Projekt, das drei Takte lang nichts meldet, wird grau. Die Seite lädt alle 10 s neu
und ändert nur Karten, die sich geändert haben; eine Karte, an der du gerade antwortest, bleibt
stehen. Auf dem Handy stehen die Spalten untereinander, „Frage an dich“ zuerst, mit einer
Sprungleiste oben.

## Antworten

Eine Karte in „Frage an dich“ zeigt Lage, Optionen als Knöpfe (die Empfehlung markiert) und ein
Freitextfeld. Beim ersten Antworten fragt die Seite die PIN ab und merkt sie sich auf dem Gerät.
Bis der Treiber die Antwort abholt, lässt sie sich ändern. Der Treiber holt sie in seinem nächsten
Takt ab, behandelt sie wie `flotte antworten`, kommentiert am Issue mit der Herkunft „Mensch über
die Brücke“ und quittiert sie.

Ansehen ist im LAN frei, Antworten nur mit PIN. Fünf falsche PINs sperren das Antworten für fünf
Minuten (je Absenderadresse; hinter Docker Desktop teilen sich oft alle Geräte eine).

## Treiber

Die HTTP-Schnittstelle (Bericht, Abholen, Quittieren) steht in [`SCHNITTSTELLE.md`](SCHNITTSTELLE.md),
ein Beispielbericht in [`beispiel/bericht.json`](beispiel/bericht.json). Zum Ausprobieren ohne Treiber:

```
curl -X POST -H "Content-Type: application/json" --data-binary @beispiel/bericht.json http://127.0.0.1:4747/api/bericht
```

## Entwickeln

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m pytest
```

Backend: FastAPI (`app/main.py`), Board-Logik `app/tafel.py`, Speicher `app/speicher.py`.
Frontend ohne Build: `app/static/`.
