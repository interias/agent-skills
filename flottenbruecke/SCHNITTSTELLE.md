# Schnittstelle Treiber ↔ Brücke

Umgesetzt im Treiber in `flotte/src/treiber/bruecke.ts` und `treiber.ts` (#28). Der gemeinsame
Vertrag sind [`beispiel/bericht.json`](beispiel/bericht.json),
[`beispiel/antworten.json`](beispiel/antworten.json) und
[`beispiel/handlungen.json`](beispiel/handlungen.json): pytest prüft die Brücke dagegen,
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
  `FLOTTE_BRUECKE_TOKEN` als Kopf `X-Bruecke-Token` bei allen Aufrufen.
- **Alt und neu passen zusammen:** Alle Felder, die v2 dazugebracht hat, sind im Bericht
  freiwillig. Ein älterer Treiber meldet weiter, ihm fehlen auf der Brücke nur Lebenszeichen,
  Laufband, Tanks und Handlungen. Die Brücke v2 legt ihre neue Tabelle auf einem alten Volume an,
  ohne etwas zu löschen.

## Ein Takt

1. `GET /api/antworten` und `GET /api/handlungen` — vor dem Lesen von `antworten.jsonl`.
2. … die übrige Schleife, Handlungen wirken hier …
3. Zustand schreiben (`zustand.json`).
4. `POST /api/bericht`, danach die Quittung für jede Antwort und Handlung, die jetzt im
   geschriebenen Zustand steht.

**Zeitnah:** Jedes Ereignis des Treibers (neue Frage an den Menschen, Stufenwechsel, Merge) schickt
sofort einen Bericht, ohne Quittungen. Solange eine Frage offen ist, fragt der Treiber zwischen den
Takten alle 10 s nach Antworten und wacht auf, sobald eine da ist. Die Seite lädt alle 10 s und
sofort nach einer eigenen Antwort oder Handlung.

## 1. Bericht: `POST /api/bericht`

Der erste Bericht legt das Projekt an (Schlüssel `forge`). Antwort `{"ok": true, "neu": <bool>}`,
`422` bei ungültigen Feldern.

| Feld | Woher im Treiber |
|---|---|
| `forge`, `url` | `Einstellung.forge`, `https://github.com/<forge>` |
| `rechner` | `os.hostname()`; trennt RAM und Platte mehrerer Rechner |
| `stand`, `aktiv` | `FlottenZustand.stand`, `.aktiv` (der letzte Bericht eines Einsatzes hat `aktiv: false`) |
| `taktS` | `--takt-s`; der Takt im Ellbogen läuft über, nach drei Takten (mindestens 3 min) Stille gilt das Projekt als still |
| `leerlaufS` | die Leerlauf-Grenze eines Laufs; die Leiste des Lebenszeichens läuft bis dahin |
| `epics[]` | `FlottenZustand.epics`, Felder unten |
| `schlange` | `FlottenZustand.schlange` |
| `konten[]` | `{konto, stufe, fuenf, woche, alterMin}`; `konto` = `Konto <n>` aus `konten.json` (sonst Ordnername, nie der Pfad), `stufe` `gruen`/`gelb`/`rot`, `fuenf` und `woche` je `{verbraucht, reset}` (Prozent und ISO-Zeit) oder `null` |
| `ram`, `platte`, `obergrenze` | RAM-Messung und -Bremse, `freiGb` und Schwelle, `bremse.obergrenze` |
| `fragen[]` | die **offenen** `MenschFrage`n, vollständig (unten) |
| `ereignisse[]` | die letzten 30 Logbuch-Ereignisse `{zeit, epic, text}`: das Laufband |
| `entscheidungen[]` | die letzten 100 Entscheidungen des Admirals `{epic, nr, frage, antwort, herkunft, grund, einflussreich, zeit, widerrufen}`: „Erledigt heute“ mit Zurücknehmen |

Die Prozentwerte gehen nur an die Brücke im eigenen Netz. Das Logbuch im Repo nennt weiter nur
Stufen.

**Epic:** `nr`, `stufe`, `pr`, `notiz`, `geparkt`, `schritt`, `schrittZeit`, `titel`, `konto`,
dazu

| Feld | Bedeutung |
|---|---|
| `prozess` | ein `claude -p` arbeitet gerade für das Epic: das Lebenszeichen pulst |
| `grund`, `haltZeit`, `log[]` | bei `blockiert`/`abgebrochen`: der Grund, seit wann, die letzten 12 Ereignisse des Epics als Zeilen `HH:MM Text` |
| `aufgegebenAm` | der Mensch hat das Epic über die Brücke aufgegeben |
| `prio` | Label `prio/hoch` (Adapter `prio_label`) am Epic oder einem Kind; `notiz` sagt, warum es trotzdem wartet |
| `pakete[]` | `{name, nr, titel, stand}` je Kind-Ticket; `stand` `fertig` (geschlossen), `laeuft` (`status/in-arbeit`), `geparkt` (wartet auf eine Antwort), `zurueckgelassen` (`status/haengt`), `blockiert` (`status/blockiert`), `offen`. Im spec-Modus leer |

Der Treiber liest die Kinder höchstens alle 5 min je Epic (`gh issue view`) und sofort, wenn sich
Stufe oder Geparkte ändern. Die Brücke macht daraus Links `<url>/issues/<nr>`.

**Ebenen der Brücke:** offene Fragen und `blockiert`/`abgebrochen` → *Braucht dich*; `laeuft`,
`nacharbeit`, `frage` → *Unterwegs* als Lauf; `pr` → *Unterwegs* in der Schlange; `wartend` → die
Zeile *Bereit*, prio zuerst; `gemergt`, `fertig` (`gemergtAm` optional, sonst der Zeitpunkt, an dem
die Brücke die Stufe zuerst sah), aufgegebene Epics, Admiral-Entscheidungen, deine Antworten und
Handlungen von heute → *Erledigt heute*.

**Frage:** `epic`, `nr`, `seit` sind zusammen der Schlüssel (Nummern beginnen in jedem
Fragenblock bei 1). Dazu `frage`, `lage`, `optionen[] {buchstabe, text}` (Großbuchstaben ab `A`,
beliebig viele; die Folge steht nach dem ersten Komma), `mehrfach` (`— Auswahl: mehrere` im Block),
`empfehlung`, `grund` (warum sie beim Menschen liegt), `herkunft`, `marke` (kurz, etwa „nach außen
sichtbar“), `umkehrbar` (`true`: bis zum Merge umkehrbar, `false`: bleibt, `null`: unbekannt),
`betrifft`, `geparkt[]` (die Pakete, die warten), `wartet`, `ganzerLauf` und `roh`, der Wortlaut
des Laufs. `marke` und `umkehrbar` setzt der Admiral (freiwillige Felder seines Schemas).

Sortiert wird nach den Kosten des Wartens: Was den ganzen Lauf oder das ganze Epic hält, steht
oben, dann die längste Wartezeit.

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

## 3. Handlungen abholen: `GET /api/handlungen?forge=<owner/name>`

Liefert alle noch nicht quittierten Handlungen (Form: `beispiel/handlungen.json`):
`{id, epic, art, nr, seit, text, zeit, herkunft}`.

| `art` | wann die Brücke sie annimmt | was der Treiber tut |
|---|---|---|
| `einreihen` | Epic `blockiert` oder `abgebrochen`, nicht aufgegeben | Zähler auf null; mit Sitzung zurück auf `laeuft` mit einer Fortsetzung, die den Grund der Blockade nennt, sonst `wartend` |
| `aufgeben` | wie `einreihen` | Stufe `abgebrochen`, `aufgegebenAm`; Branch, PR und Issue bleiben |
| `widerruf` | `nr`, `seit` (= `zeit` der Entscheidung) und `text`; Epic nicht `gemergt`/`fertig`, noch kein Widerruf | Kommentar am Issue, bei einflussreichen Entscheidungen auch ins Protokoll; der Lauf bekommt `widerruf: <Frage> → <Text>` im nächsten Zug, ein Epic in `pr` geht dafür zurück auf `laeuft` |

`einreihen` und `aufgeben` schließen sich aus: Bis zum Abholen gilt die letzte. Danach antwortet die
Brücke `409`. Endet der Einsatz, weil alles blockiert ist, wirkt die Handlung beim nächsten Start.

## 4. Quittieren

`POST /api/antworten/{id}/quittung` und `POST /api/handlungen/{id}/quittung`, erst nachdem die
Antwort oder Handlung im geschriebenen Zustand steht. `404` bei unbekannter `id`; doppelt
quittieren schadet nicht. Kommt eine Antwort ein zweites Mal (die Quittung erreichte die Brücke
nicht), erkennt der Treiber sie am Fragenschlüssel, eine Handlung an `handlungenErledigt` im
Zustand: Er quittiert nur noch. Jede wirkt genau einmal.

## Was die Seite selbst nutzt

`GET /api/tafel` (das Board in drei Ebenen), `POST /api/pin` (PIN prüfen, Kopf `X-Bruecke-Pin`),
`POST /api/antwort` (`{forge, epic, nr, seit, option, text}`) und `POST /api/handlung`
(`{forge, epic, art, nr, seit, text}`), beide mit `X-Bruecke-Pin`. Fünf falsche PINs je Absender
sperren für fünf Minuten.
