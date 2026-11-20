# Flottenbrücke

Ein kleiner, dauerhaft laufender Dienst (#28): Er zeigt alle Einsätze des Flotten-Treibers
(`flotte`) über Repositorys und Konten hinweg, nimmt die Antworten des Menschen auf Fragen der
Läufe entgegen und reicht zwei Handlungen bei Blockaden an den Treiber (neu einreihen, aufgeben).
Nur im LAN, kein Tunnel. Die Brücke startet, stoppt und mergt nichts selbst.

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
| `BRUECKE_PIN` | leer | PIN fürs Antworten und für Handlungen; leer schaltet beides ab |
| `BRUECKE_TOKEN` | leer | optional: Treiber muss ihn als `X-Bruecke-Token` schicken |
| `BRUECKE_TZ` | `Europe/Berlin` | Zeitzone für „Gemergt (heute)“ |

Unter Windows muss die Firewall den Port im privaten Netz zulassen, damit das Handy ihn erreicht.

## Board

Drei Ebenen, sortiert danach, was du tun musst:

1. **Braucht dich** — offene Fragen und blockierte Epics, oben das, dessen Warten am meisten kostet
   (hält den ganzen Lauf oder das ganze Epic, dann die längste Wartezeit). Ist etwas offen, pulst
   der Kopf langsam rot, der Tab-Titel trägt die Zahl und das Icon einen roten Punkt; bei null ist
   die Ebene grau und still.
2. **Unterwegs** — Läufe und Merge-Schlange als Karten. Je Lauf ein Lebenszeichen: Puls, „letzter
   Schritt vor N min“ und eine Leiste bis zur Leerlauf-Grenze (gelb ab der Hälfte, rot kurz davor,
   dann stoppt der Puls). Je Epic eine Segmentleiste der Kind-Tickets mit „3 von 5 fertig“;
   antippen zeigt `#nr Titel · Stand`, jede Zeile verlinkt aufs Issue (im spec-Modus nur der
   Paketname). Darunter eine Zeile **Bereit**, Epics mit `prio/hoch` zuerst, mit dem Grund, wenn
   sie warten, und ab fünf gemessenen Epics mit „voraussichtlich 3–5 h“.
3. **Erledigt heute** (eingeklappt) — oben die Prognose „Backlog leer etwa …“ mit Trefferquote
   (Rechnung in `flotte/README.md`, „Prognose“), dann Gemergtes, Entscheidungen des Admirals mit „Zurücknehmen“,
   deine Antworten und Handlungen. Ein neuer Merge leuchtet einmal grün auf.

Im Kopf je Konto ein Tank mit dem Rest im 5-h- und im Wochenfenster samt Reset-Zeit, RAM und
Platte je Rechner. Der Takt im Ellbogen füllt sich bis zum nächsten Bericht und wird rot, wenn er
ausbleibt. Unten läuft das Logbuch als Laufband; antippen hält es an und klappt die Liste auf.
Karten, die die Ebene wechseln, wandern dorthin. `prefers-reduced-motion` schaltet alle Bewegung
ab. Auf dem Handy (bis 700 px) ist nur „Braucht dich“ offen, die Knöpfe sind daumengroß.

Die Seite lädt alle 10 s neu und ändert nur Karten, die sich geändert haben; eine Karte, an der du
gerade antwortest, bleibt stehen.

## Antworten

Eine Fragekarte zeigt die Frage als Überschrift, die Lage kurz, „wartet seit N min · hält X von Y
Paketen“, eine Marke (`umkehrbar bis Merge` oder warum es bleibt) und den Grund, warum die Frage
bei dir liegt. Je Option steht die Folge darunter. Ein Tipp auf „A nehmen · Empfehlung“ sendet die
Empfehlung; Optionen und Freitext gehen immer, der Freitext erreicht den Lauf unverändert. Ließ
sich ein Block nicht in Fragen zerlegen, steht sein Wortlaut selbst auf der Karte. Beim ersten
Senden fragt die Seite die PIN ab und merkt sie sich auf dem Gerät.

Bis der Treiber die Antwort abholt, lässt sie sich ändern; danach steht „Angekommen, Lauf setzt
fort“. Der Treiber behandelt sie wie `flotte antworten`, kommentiert am Issue mit der Herkunft
„Mensch über die Brücke“ und quittiert sie.

## Handlungen

Eine Blockadekarte zeigt Grund, Lage und auf Wunsch das Log des Epics. Dazu zwei Handlungen mit
PIN, die der Treiber im nächsten Takt abholt und ausführt:

- **Neu einreihen** — Zähler zurück; der Lauf setzt fort und erfährt den Grund der Blockade.
- **Aufgeben** — nach einer Rückfrage: Das Epic wird `abgebrochen` und nicht mehr gestartet.
  Branch, Pull Request und Issue bleiben.

**Zurücknehmen** in „Erledigt heute“ widerruft eine Entscheidung des Admirals bis zum Merge: Du
schreibst die neue Entscheidung, der Treiber kommentiert sie am Issue und gibt sie dem Lauf.

Ansehen ist im LAN frei, Antworten und Handlungen nur mit PIN. Fünf falsche PINs sperren für fünf
Minuten (je Absenderadresse; hinter Docker Desktop teilen sich oft alle Geräte eine).

## Aktualisieren

`git pull`, dann `docker compose up -d --build` im Ordner. Das Volume bleibt; v2 legt auf einem
v1-Volume nur die Tabelle `handlungen` an und nimmt weiter Berichte eines älteren Treibers an.

## Treiber

Der Treiber meldet sich mit `flotte fahren … --bruecke http://127.0.0.1:4747` (oder Umgebung
`FLOTTE_BRUECKE`). Die HTTP-Schnittstelle (Bericht, Abholen von Antworten und Handlungen, Quittieren) steht in
[`SCHNITTSTELLE.md`](SCHNITTSTELLE.md), der gemeinsame Vertrag in
[`beispiel/bericht.json`](beispiel/bericht.json), [`beispiel/antworten.json`](beispiel/antworten.json) und [`beispiel/handlungen.json`](beispiel/handlungen.json).
Zum Ausprobieren ohne Treiber:

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
