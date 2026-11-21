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

## Bereiche und Navigation

Oben eine Zeile: Logo, die Befehlszeile (Strg+K, am Mac ⌘K), der Zähler „Braucht dich“ (auf jeder
Seite, rot pulsierend, solange etwas offen ist) und die Bereiche als Pillen. Auf dem Handy (bis
700 px) stehen die Pillen unten in Daumenreichweite, die Brücke trägt dort die Zahl.

- **Brücke** (`#bruecke`, Startseite) — das Board unten.
- **Holodeck** (`#holodeck`) — die Prototypen der Projekte, unten.
- **Sternenkarte** (`#sternenkarte`) — Projekte mit ihrem Backlog, unten.
- **Maschinenraum** (`#maschinenraum`), **Logbuch** (`#logbuch`) — siehe unten.

Jeder Bereich hat eine Adresse zum Merken, die Zurück-Taste geht zum vorigen; eine unbekannte
Adresse zeigt die Brücke. Die Befehlszeile sucht und springt nur: Bereiche, Projekte und Epics der
Tafel (Nummer oder Titel), mit Pfeiltasten, Enter und Esc. Ein Epic öffnet seine Ebene und markiert
die Karte kurz. Sie führt nichts aus.

Für Entwickler: Ein Bereich liegt in `app/static/bereiche/<bereich>.js` (und `.css`) und meldet sich
mit `huelle.bereich({ name, titel, zeichne(t, el), treffer(t) })` an der Hülle (`huelle.js`) an.
`zeichne` läuft bei jedem Laden der Tafel, solange der Bereich sichtbar ist, `treffer` liefert
Einträge für die Befehlszeile. `huelle.springe(bereich, ziel)` springt wie ein Treffer der Befehlszeile
zu einem Element, `huelle.beiTafel(f)` ruft `f(t)` nach jedem Laden der Tafel (so zeichnet sich die
Schiffsliste). Alle Skripte und Stile, die `index.html` nennt, bindet die Brücke mit
Inhalts-Hash ein.

## Sternenkarte

Der Überblick über die Projekte, nur lesend. Je Projekt (Forge-Repo des Treibers) ein Block mit dem
Kürzel, der Zahl offener Epics und der Prognose „Backlog leer etwa …“ (ab 5 gemessenen Epics, sonst
der Hinweis, wie auf der Brücke). Darunter jedes offene Epic als Zeile: Nummer (Link aufs Issue),
Titel, die Stufe (läuft, wartet, Frage, blockiert, PR), `prio` bei `prio/hoch`, warum es wartet oder
hält, die Reihenfolge („nach #38“ springt zur Zeile des Vorgängers, „danach #41“ zeigt die wartenden
Nachfolger; ein erledigter Vorgänger ist ein Link aufs Issue) und eine aufklappbare Liste seiner
Kind-Tickets mit Stand und Links. Ein Klick auf die Stufe führt zur Karte des Epics auf der Brücke.
Gemergte und aufgegebene Epics gehören nicht in den Backlog. Die Daten stehen im Bericht des Treibers
(`nach[]` je Epic ist neu, siehe `SCHNITTSTELLE.md`); die Brücke fragt keine Forge. Ein älterer Treiber
ohne `nach[]` zeigt die Epics ohne Kanten.

## Schiffsliste

Die Seitenleiste links auf jeder Seite (auf dem Handy eine Schublade von links, geöffnet über den
Knopf neben dem Logo; sie schließt mit Esc, mit Tippen daneben und nach einem Sprung). Sie zeigt je
Projekt alle Läufe (Epics mit Nummer, Titel, Konto) und die Sitzungen aller Konten, jeweils mit einem
Punkt nach Ebene. Eingeklappt (Knopf oben links in der Leiste, gemerkt je Gerät) bleibt eine schmale
Spalte, in der nur die Punkte stehen. Ein Klick auf einen Lauf springt zu seiner Karte auf der Brücke;
eine Sitzung klappt ihre Angaben auf (Konto, Ordner, Status, seit). Die Leiste liest nur und tut
nichts. Chips über der Liste filtern (Alle, Braucht dich, Freigabe, Läuft, Sitzungen, Ruht); ab 12
Einträgen sind die ruhenden eingeklappt („+ N ruhende“).

| Punkt | Bedeutung | Woher |
|---|---|---|
| blau | Freigabe | Epic in der Merge-Schlange (Stufe `pr`) |
| lila | Frage | offene Frage, `blockiert`, `abgebrochen` (die Ebene „Braucht dich“) |
| grün | läuft | `laeuft`, `nacharbeit`, `frage` mit Prozess; Sitzung `busy` |
| gelb | neuer Prototyp | am Projektkopf, wenn das Holodeck dort einen Prototyp als neu seit dem letzten Besuch dieses Geräts zählt |
| grau | ruht | `wartend`, heute gemergt; Sitzung `idle` |

Die Zuordnung steht als Tabelle `ZUORDNUNG` in `app/static/schiffsliste.js`. Kein Punkt blinkt: Rot
und Bewegung gehören allein zu „Braucht dich“.

Die **Sitzungen** liest der Treiber, nicht die Brücke (sie läuft im Container ohne Zugriff auf die
Konten): je Konto `claude agents --json` mit dessen `CLAUDE_CONFIG_DIR`, höchstens einmal je Minute,
nur lesend. In den Bericht gehen Konto, der letzte Ordnername des Arbeitsverzeichnisses (nie der
Pfad), Name, Status, Art und Beginn; ein Projekt erkennt die Brücke am Repository-Namen, alles andere
steht unter „Sonstige“. Fehlt das Kommando oder schlägt es fehl, bleibt die Liste ohne Sitzungen.

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
   sie warten, und ab fünf gemessenen Epics mit „voraussichtlich 3–5 h“. Je Epic dort „N Tickets“
   mit derselben Segmentleiste; antippen klappt die Tickets mit Links auf (im spec-Modus keine).
3. **Erledigt heute** (eingeklappt) — oben die Prognose „Backlog leer etwa …“ mit Trefferquote
   (Rechnung in `flotte/README.md`, „Prognose“), dann Gemergtes, Entscheidungen des Admirals mit „Zurücknehmen“,
   deine Antworten und Handlungen. Ein neuer Merge leuchtet einmal grün auf.

**Detailansicht eines Epics** (#51): Unter der Segmentleiste eines Laufs stehen **Plätze 3/3** (Pakete
in Implementer, Review oder Nachbesserung gegen das Fenster des Projektadapters) und die Zahl der
**Neustarts** des Laufs; die Laufzeit ist der Knopf „läuft seit …“. In der aufgeklappten Paketliste
hat jedes Paket, zu dem der Treiber Agent-Aufrufe im Protokoll des Laufs sah, eine zweite Zeile:
Phase (Implementer, Review, Nachbesserung, Merge) mit Dauer in der Phase, Dauer gesamt, Runde, Stufe
(eine Eskalation als „Standard → Urteil“) und die Uhrzeit des Lebenszeichens. „länger als üblich“
(ruhig, kein Rot) erscheint, wenn ein laufendes Paket länger als das 1,5-Fache des Medians der
fertigen Pakete des Projekts läuft, ab drei fertigen; die Brücke rechnet es selbst. Fehlt ein Feld
(älterer Treiber, spec-Modus, Paket ohne Aufruf), bleibt es weg. Felder: `SCHNITTSTELLE.md`.

Im Kopf je Konto ein Tank mit dem Rest im 5-h- und im Wochenfenster samt Reset-Zeit, RAM und
Platte je Rechner. Der Takt im Ellbogen füllt sich bis zum nächsten Bericht und wird rot, wenn er
ausbleibt. Unten läuft das Logbuch als Laufband; antippen hält es an und klappt die Liste auf.
Karten, die die Ebene wechseln, wandern dorthin. `prefers-reduced-motion` schaltet alle Bewegung
ab. Auf dem Handy (bis 700 px) ist nur „Braucht dich“ offen, die Knöpfe sind daumengroß.

Die Seite lädt alle 10 s neu und ändert nur Karten, die sich geändert haben; eine Karte, an der du
gerade antwortest, bleibt stehen.

## Holodeck

Je Projekt ein fester Ordner mit Prototypen: `prototypen/` in der Repo-Wurzel, anders mit dem
Adapterschlüssel `prototype_dir` in `.claude/epic.md`. Jede HTML-Datei direkt darin (keine
Unterordner, höchstens 50, je höchstens 2 MB) erscheint als Kachel mit Titel (`<title>`), Projekt,
Datum und Vorschau, gruppiert und filterbar nach Projekt; die Befehlszeile findet sie auch. Antippen
öffnet den Prototyp in einem Rahmen, wahlweise als **Schreibtisch** (volle Breite) oder **Telefon**
(390 px breit). **Rückmeldung kopieren** legt `Rückmeldung zu Prototyp <owner/name>/<datei>: ` in
die Zwischenablage, für den Chat. Nur ansehen: Die Brücke ändert keine Datei.

Die Vorschau ist der Prototyp selbst, verkleinert in einem Rahmen ganz ohne Skripte
(`sandbox=""`, `loading="lazy"`): kein Bilderdienst, kein Bildschirmfoto-Schritt; ein Prototyp, der
erst per Skript zeichnet, bleibt in der Vorschau leer und läuft erst in der Ansicht.

**Sicherheitsmodell:** Der Treiber liest nur Dateien direkt im freigegebenen Ordner (keine
Verknüpfungen, kein Weg hinaus) und schickt nur Dateinamen und Inhalte, keine Pfade; die Brücke
liefert nur, was sie gespeichert hat, und kennt kein Dateisystem der Projekte. Jeder Prototyp läuft
in einem opaken Ursprung (`Content-Security-Policy: sandbox allow-scripts` und
`<iframe sandbox="allow-scripts">`, beide ohne `allow-same-origin`): Er sieht weder die PIN im
localStorage noch Cookies und kann die Brücken-API weder lesen noch, ohne PIN, etwas auslösen;
Verbindungen und Formulare sind gesperrt, Schriften und Skripte von `https:` laden.

**Neu seit dem letzten Besuch:** ein gelber Punkt (blinkt nicht). Der localStorage-Schlüssel
`flottenbruecke.holodeck.besucht` hält die ISO-Zeit, zu der dieses Gerät das Holodeck zuletzt
geöffnet hat. Ein Prototyp aus `/api/tafel` → `prototypen[]` ist neu, wenn `geaendert` später ist
oder der Schlüssel fehlt. Beim Betreten setzt das Holodeck die neue Zeit; die Punkte dieses Besuchs
bleiben, bis du den Bereich verlässt. Die Schiffsliste liest denselben Schlüssel nach derselben
Regel.

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

## Maschinenraum und Logbuch

- **Maschinenraum** (`#maschinenraum`): je Konto zwei Tanks (5 h und Woche, „… % übrig“, Reset-Zeit,
  mit Wochentag ab 20 h), Alter des Werts und Bremsstufe; je Rechner RAM, Platte, Obergrenze (Läufe
  gleichzeitig) und der Takt der Treiber, die dort melden. Alles stammt aus dem Bericht. Was er nicht
  trägt, steht als „… meldet der Treiber nicht“: heute die **Anmeldung** je Konto und der **Grund** einer
  Bremse (der Bericht kennt nur die Stufe `gruen`/`gelb`/`rot`). Kommen `anmeldung` und `grund` je Konto
  in die Tafel, zeigt die Seite sie.
- **Logbuch** (`#logbuch`): Ereignisse der Treiber, Entscheidungen des Admirals und Handlungen des
  Menschen in einer Liste, neueste oben, filterbar nach Epic und Art (Ereignis, Admiral, Mensch). Die
  Tafel hält 40 Ereignisse und von den Entscheidungen nur die von heute; ältere gibt es hier nicht. Das
  Feld „Logbuch“ im Fuß und „Alle im Logbuch“ unter dem Laufband führen hierher.

## Aktualisieren

`git pull`, dann `docker compose up -d --build` im Ordner. Das Volume bleibt; v2 legt auf einem
v1-Volume nur die Tabelle `handlungen` an und nimmt weiter Berichte eines älteren Treibers an, v3
ebenso die Tabelle `prototypen`.

## Treiber

Der Treiber meldet sich mit `flotte fahren … --bruecke http://127.0.0.1:4747` (oder Umgebung
`FLOTTE_BRUECKE`). Die HTTP-Schnittstelle (Bericht, Abholen von Antworten und Handlungen, Quittieren, Prototypen) steht in
[`SCHNITTSTELLE.md`](SCHNITTSTELLE.md), der gemeinsame Vertrag in
[`beispiel/bericht.json`](beispiel/bericht.json), [`beispiel/antworten.json`](beispiel/antworten.json), [`beispiel/handlungen.json`](beispiel/handlungen.json) und [`beispiel/holodeck.json`](beispiel/holodeck.json).
Zum Ausprobieren ohne Treiber:

```
curl -X POST -H "Content-Type: application/json" --data-binary @beispiel/bericht.json http://127.0.0.1:4747/api/bericht
python -c "import json,urllib.request as u;[u.urlopen(u.Request('http://127.0.0.1:4747/api/holodeck',json.dumps(b).encode(),{'Content-Type':'application/json'})) for b in json.load(open('beispiel/holodeck.json',encoding='utf-8'))]"
```

`beispiel/holodeck.json` ist eine Liste mit einem Body je Projekt; die Zeile schickt jeden.

## Entwickeln

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m pytest
```

Backend: FastAPI (`app/main.py`), Board-Logik `app/tafel.py`, Speicher `app/speicher.py`.
Frontend ohne Build: `app/static/`.
