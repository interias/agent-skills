# Schnittstelle Treiber ↔ Brücke

Umgesetzt im Treiber in `flotte/src/treiber/bruecke.ts` und `treiber.ts` (#28). Der gemeinsame
Vertrag sind [`beispiel/bericht.json`](beispiel/bericht.json) und
[`beispiel/antworten.json`](beispiel/antworten.json): pytest prüft die Brücke dagegen,
`bun test` (`flotte/test/bruecke.test.ts`) den Treiber.

## Grundregeln

- **Nur der Treiber** spricht per HTTP mit der Brücke. Läufe und Admiral laufen weiter mit
  `--strict-mcp-config` und sehen sie nicht; kein MCP.
- **Basis-URL:** `flotte fahren --bruecke http://127.0.0.1:4747` oder Umgebung `FLOTTE_BRUECKE`.
  Ohne sie meldet der Treiber nichts.
- **Kurze Zeitgrenze** (3 s) je Aufruf. Fehler, Zeitüberschreitung oder ein Status ≠ 2xx sind kein
  Fehler des Treibers: ein Ereignis beim Wechsel (erreichbar ↔ nicht erreichbar), sonst still
  weiter. Ist die Brücke aus, bleiben `flotte antworten` und das Issue als Weg.
- **Token (optional):** Setzt die Brücke `BRUECKE_TOKEN`, schickt der Treiber den Wert aus
  `FLOTTE_BRUECKE_TOKEN` als Kopf `X-Bruecke-Token` bei allen drei Aufrufen.

## Ein Takt

1. `GET /api/antworten` — vor dem Lesen von `antworten.jsonl`.
2. … die übrige Schleife …
3. Zustand schreiben (`zustand.json`).
4. `POST /api/bericht`, danach `POST /api/antworten/{id}/quittung` für jede Antwort, die jetzt im
   geschriebenen Zustand steht.

**Zeitnah:** Jedes Ereignis des Treibers (neue Frage an den Menschen, Stufenwechsel, Merge) schickt
sofort einen Bericht, ohne Quittungen. Solange eine Frage offen ist, fragt der Treiber zwischen den
Takten alle 10 s nach Antworten und wacht auf, sobald eine da ist. Die Seite lädt alle 10 s und
sofort nach einer eigenen Antwort; Server-Sent Events lohnen den Aufwand nicht (Ereignisse aus den
Threads der Endpunkte in die Event-Loop reichen, Wiederverbinden), der Gewinn wären höchstens 10 s.

## 1. Bericht: `POST /api/bericht`

Der erste Bericht legt das Projekt an (Schlüssel `forge`). Antwort `{"ok": true, "neu": <bool>}`,
`422` bei ungültigen Feldern.

| Feld | Woher im Treiber |
|---|---|
| `forge`, `url` | `Einstellung.forge`, `https://github.com/<forge>` |
| `rechner` | `os.hostname()`; trennt RAM und Platte mehrerer Rechner |
| `stand`, `aktiv` | `FlottenZustand.stand`, `.aktiv` (der letzte Bericht eines Einsatzes hat `aktiv: false`) |
| `taktS` | `--takt-s`; nach drei Takten (mindestens 3 min) Stille gilt das Projekt als still |
| `epics[]` | `FlottenZustand.epics`: `nr`, `stufe`, `pr`, `notiz`, `geparkt`, `schritt`, `schrittZeit`; `titel` einmal per `gh issue view --json title`; `konto` als Kurzname; `pakete` vorerst leer |
| `schlange` | `FlottenZustand.schlange` |
| `konten[]` | `{konto, stufe}` je Konto mit Bewertung; `konto` = `Konto <n>` aus `konten.json` (sonst Ordnername, nie der Pfad), `stufe` nur `gruen`/`gelb`/`rot`, nie Prozent |
| `ram`, `platte`, `obergrenze` | RAM-Messung und -Bremse, `freiGb` und Schwelle, `bremse.obergrenze` |
| `fragen[]` | die **offenen** `MenschFrage`n, vollständig (unten) |

Spalten: `wartend` → Bereit; `laeuft`, `nacharbeit` → Läuft; `frage` oder eine offene Frage →
Frage an dich; `pr` → Merge-Schlange; `gemergt`, `fertig` → Gemergt (heute), nur heute
(`gemergtAm` optional, sonst der Zeitpunkt, an dem die Brücke die Stufe zuerst sah);
`blockiert`, `abgebrochen` → Blockiert.

**Frage:** `epic`, `nr`, `seit` sind zusammen der Schlüssel (Nummern beginnen in jedem
Fragenblock bei 1). Dazu `frage`, `lage`, `optionen[] {buchstabe, text}` (Großbuchstaben ab `A`,
beliebig viele), `mehrfach` (`— Auswahl: mehrere` im Block), `empfehlung`, `grund`,
`betrifft`, `wartet`, `ganzerLauf` und `roh`, der Wortlaut des Laufs. `MenschFrage` im Zustand
hält alle Felder, auch nach einem Neustart.

**Rückfall:** Lässt sich ein `FLOTTE-FRAGE`-Block nicht in Fragen zerlegen, legt der Treiber eine
Frage 1 mit leerem `frage` und dem ganzen Block als `roh` an; der Lauf wartet. Die Brücke zeigt
dann den Wortlaut mit Freitextfeld. Bei zerlegten Fragen steht der Wortlaut aufklappbar darunter.

## 2. Antworten abholen: `GET /api/antworten?forge=<owner/name>`

Liefert alle noch nicht quittierten Antworten (Form: `beispiel/antworten.json`). `option` ist der
Buchstabe einer Option, bei Mehrfachwahl die Buchstaben mit Komma (`A, C, I`), oder `null`; `text`
der Freitext oder `null`; mindestens eines ist gesetzt. Die Brücke nimmt bei Einzelwahl genau einen
Buchstaben an und nur Buchstaben, die die Frage hat.
Ab dem Abholen kann der Mensch die Antwort nicht mehr ändern.

Der Treiber gibt sie dem Lauf wie eine Antwort aus `flotte antworten`, als Zeile `<nr>. <Antwort>`:

| Brücke | an den Lauf |
|---|---|
| nur Option `B` | `B` |
| Mehrfachwahl | `A, C, I` |
| nur Freitext | `Antwort: <Text unverändert>` |
| beides | `B — Antwort: <Text unverändert>` |

Am Issue steht `**Antwort des Menschen (Mensch über die Brücke)**` mit `Herkunft: Mensch über die
Brücke`.

## 3. Quittieren: `POST /api/antworten/{id}/quittung`

Erst nachdem die Antwort im geschriebenen Zustand steht. `404` bei unbekannter `id`; doppelt
quittieren schadet nicht. Kommt eine Antwort ein zweites Mal (die Quittung erreichte die Brücke
nicht), erkennt der Treiber sie am Fragenschlüssel: Die Frage ist schon beantwortet, er quittiert
nur noch. Eine Antwort wirkt so genau einmal.

## Was die Seite selbst nutzt

`GET /api/tafel` (das Board), `POST /api/pin` (PIN prüfen, Kopf `X-Bruecke-Pin`) und
`POST /api/antwort` (`{forge, epic, nr, seit, option, text}` mit `X-Bruecke-Pin`). Fünf falsche
PINs je Absender sperren das Antworten für fünf Minuten.
