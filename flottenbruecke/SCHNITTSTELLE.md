# Schnittstelle Treiber ↔ Brücke

Für die Anbindung im Treiber (`flotte/src/treiber/`), zweiter Schritt von #28. Die Brücke ist
dafür fertig; der Treiber ändert sich erst nach dem laufenden Treiber-PR.

## Grundregeln

- **Basis-URL** aus einer Einstellung des Treibers, etwa `--bruecke http://127.0.0.1:4747`. Ohne
  sie meldet der Treiber nichts.
- **Kurze Zeitgrenze** (2–3 s) für jeden Aufruf. Fehler, Zeitüberschreitung oder ein Status ≠ 2xx
  sind kein Fehler des Treibers: höchstens ein Ereignis beim ersten Ausfall und beim
  Wiederkommen, sonst still weiter. Die Aufrufe laufen nebenher wie die Pings, nie im Takt
  blockierend.
- **Token (optional):** Setzt die Brücke `BRUECKE_TOKEN`, schickt der Treiber ihn als Kopf
  `X-Bruecke-Token` bei allen drei Aufrufen. Ohne Token sind sie im LAN offen wie das Ansehen.

## 1. Bericht: `POST /api/bericht`

Einmal je Takt, am Ende von `speichern()`. JSON, Beispiel: [`beispiel/bericht.json`](beispiel/bericht.json).
Der erste Bericht legt das Projekt an (Schlüssel `forge`). Antwort `{"ok": true, "neu": <bool>}`;
`422` bei ungültigen Feldern.

| Feld | Pflicht | Woher im Treiber |
|---|---|---|
| `forge` | ja | `Einstellung.forge` (`owner/name`) |
| `url` | nein | Web-Adresse des Repositorys, für Links auf Issue und PR (`https://github.com/<forge>`) |
| `rechner` | nein | `os.hostname()`; trennt RAM und Platte mehrerer Rechner |
| `stand` | ja | `FlottenZustand.stand` |
| `aktiv` | nein | `FlottenZustand.aktiv` |
| `taktS` | nein | `Einstellung.taktMs / 1000`; nach 3 Takten (mindestens 3 min) Stille gilt das Projekt als still |
| `epics[]` | ja | `FlottenZustand.epics`, je Epic siehe unten |
| `schlange` | nein | `FlottenZustand.schlange` (Reihenfolge = Plätze in der Merge-Schlange) |
| `konten[]` | nein | `bremse.konten`: `{konto, stufe}`; `konto` = Ordnername (`basename`), **nie der Pfad**; `stufe` nur `gruen`/`gelb`/`rot`, **nie Prozent**, `grund` nicht senden |
| `ram` | nein | `{stufe: this.ram.level, halt: ramBremse.halt, prozent: this.ram.percent_used}` |
| `platte` | nein | `{freiGb: w.freiGb(repo), genug: platteGenug}` |
| `obergrenze` | nein | `bremse.obergrenze` |
| `fragen[]` | nein | `FlottenZustand.fragen`, siehe unten |

**Epic** (`FlottenEpic`):

| Feld | Woher |
|---|---|
| `nr`, `stufe`, `pr`, `notiz`, `geparkt`, `schritt`, `schrittZeit` | gleichnamig aus `FlottenEpic` |
| `konto` | `basename(ep.konto)` oder `null` |
| `titel` | **neu:** Titel des Issues, einmal beim Einsammeln holen (`gh issue view --json title`) |
| `pakete[]` | **neu, optional:** `{name, stand}` mit `stand` ∈ `offen`, `laeuft`, `fertig`, `geparkt`, `blockiert`; Quelle offen (Lauftafel des Laufs, `FrageBlock.tafel`). Ohne Pakete zeigt die Karte keine Segmentleiste. |
| `gemergtAm` | **neu, optional:** Zeit des Merges. Fehlt sie, nimmt die Brücke den Zeitpunkt, an dem sie die Stufe `gemergt`/`fertig` zuerst sah. |

Spalten: `wartend` → Bereit; `laeuft`, `nacharbeit` → Läuft; `frage` oder eine offene Frage →
Frage an dich; `pr` → Merge-Schlange; `gemergt`, `fertig` → Gemergt (heute), nur heute;
`blockiert`, `abgebrochen` → Blockiert.

**Frage** (`MenschFrage`):

| Feld | Woher |
|---|---|
| `epic`, `nr`, `frage`, `empfehlung`, `wartet`, `ganzerLauf`, `beantwortet` | gleichnamig aus `MenschFrage` |
| `seit` | `MenschFrage.seit`, **Pflicht**: zusammen mit `epic` und `nr` der Schlüssel der Frage (Nummern beginnen in jedem Fragenblock bei 1) |
| `lage`, `optionen[] {buchstabe, text}`, `grund` | **neu:** aus der `Frage` des `FrageBlock` und der Admiral-Antwort; heute stehen sie nur im Issue-Kommentar. `MenschFrage` muss sie mitspeichern. |

Die Brücke markiert die Option als Empfehlung, deren Buchstabe am Anfang von `empfehlung` steht.

## 2. Antworten abholen: `GET /api/antworten?forge=<owner/name>`

In jedem Takt, vor `antwortenLesen()`. Liefert alle noch nicht quittierten Antworten:

```json
[{ "id": 7, "epic": 39, "nr": 1, "seit": "2026-11-20T14:12:30Z", "text": "A — config/ ist richtig",
   "zeit": "2026-11-20T14:33:02+00:00", "herkunft": "Mensch über die Brücke" }]
```

Ab dem Abholen kann der Mensch die Antwort auf der Seite nicht mehr ändern. Der Treiber behandelt
jede Antwort wie `flotte antworten <repo> <epic> <nr> "<text>"`: am einfachsten hängt er sie als
Zeile an `antworten.jsonl` an, dann gilt der vorhandene Weg. Der Kommentar am Issue nennt die
Herkunft: `**Antwort des Menschen (Mensch über die Brücke)**`. Passt eine Antwort zu keiner
offenen Frage mehr (schon per CLI beantwortet), quittiert der Treiber sie trotzdem.

## 3. Quittieren: `POST /api/antworten/{id}/quittung`

Nachdem die Antwort im Zustand steht (`antworten.jsonl` geschrieben). Antwort `{"ok": true}`,
`404` bei unbekannter `id`; doppelt quittieren schadet nicht. Fällt die Brücke zwischen Abholen
und Quittieren aus, kommt die Antwort beim nächsten Abholen wieder: Der Treiber erkennt sie an
`id` (gemerkte quittierte IDs im Zustand) und hängt sie nicht doppelt an.

## Was die Seite selbst nutzt

`GET /api/tafel` (das Board), `POST /api/pin` (PIN prüfen, Kopf `X-Bruecke-Pin`) und
`POST /api/antwort` (`{forge, epic, nr, seit, text}` mit `X-Bruecke-Pin`). Fünf falsche PINs je
Absender sperren das Antworten für fünf Minuten.
