# Schnittstelle Treiber ↔ Brücke

Umgesetzt im Treiber in `flotte/src/treiber/bruecke.ts`, `holodeck.ts` und `treiber.ts` (#28,
#44). Der gemeinsame Vertrag sind [`beispiel/bericht.json`](beispiel/bericht.json),
[`beispiel/antworten.json`](beispiel/antworten.json),
[`beispiel/handlungen.json`](beispiel/handlungen.json) und
[`beispiel/holodeck.json`](beispiel/holodeck.json): pytest prüft die Brücke dagegen,
`bun test` (`flotte/test/bruecke.test.ts`, `holodeck.test.ts`) den Treiber.

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
5. `POST /api/holodeck`, nur wenn sich der Satz der Prototypen geändert hat (Abschnitt 5).

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
| `prognose` | `{status, ab, bisher, treffer, geprueft, backlog, berechnet}`: `zu_wenig` unter `ab` Messungen, `ungenau` bei unter 60 % Treffern (ausgeblendet), sonst `ok`; `backlog` `{p50, p90}` in Sekunden ab `berechnet`, ohne Wartezeit auf den Menschen. Fehlt bei einem älteren Treiber |
| `entscheidungen[]` | `{epic, nr, frage, antwort, herkunft, grund, einflussreich, zeit, widerrufen, von}`: die Entscheidungen des Admirals und (#52) die Antworten des Menschen, `von` `mensch`, `admiral` oder `lauf` (der Admiral folgte der Empfehlung des Laufs). Der Treiber schickt **alle Entscheidungen jedes nicht gemergten Epics** und dazu die letzten 100, zusammen höchstens die neuesten 500 (Grenze der Brücke); Texte kürzt er auf 4000 Zeichen (`herkunft` 500), damit nie der ganze Bericht abgelehnt wird. Eine Antwort des Menschen wird beim Anwenden zur Entscheidung (`herkunft` `Mensch über die Brücke` oder `Mensch über die Flotte`, `einflussreich` `false`, `zeit` = Zeitpunkt der Antwort). Ein älterer Treiber ohne `von`: Die Brücke liest `mensch` aus einer `herkunft`, die mit „Mensch“ beginnt, sonst `admiral`; ein unbekanntes Wort ist kein `422`. „Erledigt heute“ zeigt die des Admirals von heute, die Detailansicht des Epics alle bis zum Merge (unten) |
| `sitzungen[]` | optional (Schiffsliste, #41): die Sitzungen aller Konten des Treibers aus `claude agents --json` je Konto (nur lesend, höchstens einmal je Minute): `{konto, projekt, name, status, kind, seit}`. `konto` wie in `konten[]`, `projekt` **nur der letzte Ordnername** des Arbeitsverzeichnisses (nie der Pfad; ein Wert mit `/` oder `\` wird mit `422` abgelehnt), `status` etwa `busy`/`idle`, `kind` etwa `interactive`, `seit` ISO aus `startedAt`. Kein `cwd`, keine `pid`, keine Sitzungs-ID; die Brücke verwirft unbekannte Felder. Fehlt das Feld (älterer Treiber) oder ist es leer, bleibt die Liste ohne Sitzungen |

Die Prozentwerte gehen nur an die Brücke im eigenen Netz. Das Logbuch im Repo nennt weiter nur
Stufen.

**Epic:** `nr`, `stufe`, `pr`, `notiz`, `geparkt`, `schritt`, `schrittZeit`, `titel`, `konto`,
dazu

| Feld | Bedeutung |
|---|---|
| `prozess` | ein `claude -p` arbeitet gerade für das Epic: das Lebenszeichen pulst |
| `grund`, `haltZeit`, `log[]` | bei `blockiert`/`abgebrochen`: der Grund, seit wann, die letzten 12 Ereignisse des Epics als Zeilen `HH:MM Text` |
| `aufgegebenAm` | der Mensch hat das Epic über die Brücke aufgegeben |
| `prognose` | nur bei `wartend`: `{p50, p90}` in Sekunden, sonst `null` |
| `prio` | Label `prio/hoch` (Adapter `prio_label`) am Epic oder einem Kind; `notiz` sagt, warum es trotzdem wartet |
| `pakete[]` | `{name, nr, titel, stand, beginn, ende}` je Kind-Ticket, in jeder Stufe, auch `wartend`; `stand` `fertig` (geschlossen oder schon in den Epic-Branch gemergt, `ende` dann die Zeit dieses Merges), `laeuft` (`status/in-arbeit`), `geparkt` (wartet auf eine Antwort), `zurueckgelassen` (`status/haengt`), `blockiert` (`status/blockiert`), `offen`. Im spec-Modus leer. Dazu optional die Detailfelder (unten) |
| `neustarts` | optional (Detailansicht, #51): wie oft der Treiber für das Epic nach dem ersten Start einen Prozess gestartet oder fortgesetzt hat (jede Fortsetzung nach einer Antwort, jeder Neustart nach einem Fehlstart). Zählt über ein Neu-Einreihen durch den Menschen weiter (seit dem ersten Start, wie `runde`). Fehlt bei einem älteren Treiber und bei einem Epic ohne Start |
| `plaetze` | optional (#51): `{belegt, von?}`, nur bei `laeuft`/`nacharbeit`/`frage` und wenn der Treiber Agent-Aufrufe des Laufs sah. `belegt` = Pakete in Implementer, Review oder Nachbesserung (Merge belegt keinen Platz; 0, wenn gerade kein Prozess läuft), `von` = `window` des Projektadapters (Standard nach `epic/references/adapter.md`: 3 mit `test_isolation_env` oder `isolation: none-needed`, sonst 1; höchstens 3), fehlt, wenn unbekannt |
| `nach[]` | optional (Sternenkarte, #43): die Nummern der Epics dieses Repositorys, nach denen es kommt (Kopfzeile `> **Reihenfolge:**` und `## Blocked by` des Issues, wie die Belegung sie liest; nur Epics des Treibers, nie das Epic selbst). Fehlt es (älterer Treiber), gilt `[]` |

**Detailfelder je Paket (#51)**, alle optional, nur für Kind-Tickets (im spec-Modus nie) und nur, wenn der
Treiber im Protokoll des Laufs (stream-json von `claude -p`, das er schon liest) einen `Agent`-Aufruf eines
`epic-implementer-*` oder `epic-reviewer-*` sah, dessen `description` die Paketnummer nennt
(`Implementer #588 …`, `Reviewer #588 …`, `epic/SKILL.md`, Phase 6). Die Lauftafel und der Lauf bleiben
unverändert. Der Treiber merkt sich die Aufrufe mit ihren Rückkehrzeiten im Zustand (`agenten`, nur wenn er mit Brücke läuft) und
nimmt als Zeit den `timestamp` der Zeile (Zeilen von `assistant` und `user` haben einen), sonst den Moment, in dem er sie las.
Ein Agent im Hintergrund (so startet `/epic` Implementer und Reviewer) beantwortet seinen Aufruf sofort
mit einem `tool_result`, das mit „Async agent launched“ beginnt: Das ist sein Start, keine Rückkehr. Sein
Ende ist die spätere Zeile `{"type":"system","subtype":"task_notification","tool_use_id":<Aufruf>,"status":…}`
mit `status` `completed`, `failed`, `killed` oder `stopped`; sie hat **keinen** `timestamp`, als Rückkehrzeit
gilt also der Moment, in dem der Treiber sie las (bei einem nach einem Neustart übernommenen Lauf, dessen
Rückkehr der Zustand noch nicht kannte, ist das die Zeit des Nachlesens). Eine zweite Meldung zum selben
Aufruf zählt nicht. Ein `tool_result` ohne diesen Anfang ist das Ende eines Agenten im Vordergrund.

| Feld | Bedeutung |
|---|---|
| `phase` | `implementer` (erste Runde läuft), `review` (Reviewer läuft), `nachbesserung` (Implementer ab Runde 2 nach einem Review), `merge` (Reviewer zurück, noch nicht im Epic-Branch: Host prüft und mergt). Fehlt, sobald das Paket gemergt ist und solange das Epic nicht arbeitet (`pr`, Schlange) |
| `runde` | Zahl der Implementer-Runden des Pakets: der erste Aufruf und jeder erste nach einem Review (ein erneuter Aufruf ohne Review dazwischen, etwa nach einem Neustart des Laufs, bleibt dieselbe Runde) |
| `stufe`, `stufeStart` | Klasse des letzten Implementer-Aufrufs (`mechanisch`, `standard`, `urteil`, `urteil-hoch`) und die des ersten, nur wenn sie abweicht |
| `eskaliert` | die Stufe der letzten Runde liegt über der der vorigen (Standard → Urteil → Urteil hoch) |
| `erstAufruf`, `phaseSeit`, `lebenszeichen` | ISO: erster Aufruf (Dauer gesamt), Beginn der Phase, letzter Protokolleintrag zum Paket (Aufruf, Rückkehr oder Zeile eines Unteragenten) |

Die Brücke gibt sie in `GET /api/tafel` an `pakete[]` weiter (Brücke und Sternenkarte) und rechnet dort
`lang` dazu: `true`, wenn das Paket `laeuft` und seit `beginn` länger als das 1,5-Fache des Medians der
Dauern (`beginn` bis `ende`) der fertigen Pakete **aller Epics des Projekts** läuft, ab drei fertigen,
sonst `false`. Sie rechnet es selbst, weil sie jedes Epic des Projekts und ihre eigene Uhr kennt und es
so auch für Berichte älterer Treiber gilt. Ungültige Werte (`phase`, `stufe`, `runde` unter 1) lehnt die
Brücke mit `422` ab. Fehlt ein Feld, lässt die Seite es weg und das Layout bleibt wie vorher.

An die Detailansicht eines Epics (aufgeklappte Paketliste auf der Brücke, `abschnitte(x)` in `app.js`)
kommt ein weiterer Abschnitt als weiterer Eintrag dieser Liste unter die Paketliste.

**Entscheidungen bis zum Merge** (#52): In `GET /api/tafel` trägt jede Karte eines nicht gemergten
Epics (Lauf, Schlange, Bereit, Blockade) `entscheidungen[]`, neueste zuerst: jede Antwort des
Menschen und jede Entscheidung von Admiral oder Lauf mit `einflussreich`, von jedem Tag. Der Rest
bleibt im Flottenlogbuch und an den Issues. Felder: `{id, forge, epic, nr, frage, antwort, herkunft,
grund, einflussreich, zeit, seit, widerrufen, von, widerrufbar, handlung}`; `seit` ist die `zeit` des
Berichts (der Schlüssel für den Widerruf), `widerrufbar` `false` nach einem Widerruf, `handlung` ein
noch nicht quittierter Widerruf. Ein gemergtes Epic trägt keine. Die Seite zeigt sie in der
aufgeklappten Detailansicht mit Herkunft (Mensch, Admiral, Lauf), Zeit und „› Zurücknehmen“ (nur mit
PIN); die Leiste nennt „N Entscheidungen“ und erscheint auch bei einem Epic ohne Pakete. Die Karte
eines blockierten Epics hat keine Detailansicht: Dort bleibt für die Entscheidungen des Admirals von
heute „Erledigt heute“.

**Fertig-Erkennung im Epic-Branch:** Ein Betreff gilt für das Kind `<nr>` bei `Merge … agent/<nr>-…`,
`… (#<nr>)` und `Merge #<nr>: …`; eine Nummer sonst irgendwo im Text („Refs #409“, `#4090`) zählt nicht.

Der Treiber liest die Kinder jedes Epics, auch eines wartenden, höchstens alle 5 min je Epic
(`gh issue view`) und sofort, wenn sich Stufe oder Geparkte ändern. Bei jedem solchen Lesen schaut
er einmal je Epic in den Epic-Branch (`git log --first-parent` auf `epic/<nr>-…`, lokal vor
`origin/…`, ohne die Commits anderer Branches): Ein Kind mit `Merge … agent/<kind>-…`,
`(#<kind>)` oder `Merge #<kind>: …` im Betreff ist fertig, auch wenn sein Issue bis zum Merge des Epic-PRs offen bleibt. Die Brücke macht daraus Links
`<url>/issues/<nr>`: unter *Unterwegs* je Karte, in *Bereit* je Epic „N Tickets“ mit derselben
Leiste; bei leerer Liste fehlt die Leiste.

**Ebenen der Brücke:** offene Fragen und `blockiert`/`abgebrochen` → *Braucht dich*; `laeuft`,
`nacharbeit`, `frage` → *Unterwegs* als Lauf; `pr` → *Unterwegs* in der Schlange; `wartend` → die
Zeile *Bereit*, prio zuerst; `gemergt`, `fertig` (`gemergtAm` optional, sonst der Zeitpunkt, an dem
die Brücke die Stufe zuerst sah), aufgegebene Epics, Admiral-Entscheidungen, deine Antworten und
Handlungen von heute → *Erledigt heute* (eine Antwort des Menschen dort aus der Brücke selbst, nicht als
Entscheidung des Berichts).

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
| `widerruf` | `nr`, `seit` (= `zeit` der Entscheidung) und `text`; Epic nicht `gemergt`/`fertig`, noch kein Widerruf; eine Entscheidung des Admirals oder (#52) eine Antwort des Menschen | Kommentar am Issue, bei einflussreichen Entscheidungen auch ins Protokoll; der Lauf bekommt `widerruf: <Frage> → <Text>` im nächsten Zug, ein Epic in `pr` geht dafür zurück auf `laeuft`. Nach dem Merge nur der Kommentar und ein Ereignis, nichts an den Lauf; ein zweiter Widerruf derselben Entscheidung bleibt ein Ereignis |

`einreihen` und `aufgeben` schließen sich aus: Bis zum Abholen gilt die letzte. Danach antwortet die
Brücke `409`. Endet der Einsatz, weil alles blockiert ist, wirkt die Handlung beim nächsten Start.

## 4. Quittieren

`POST /api/antworten/{id}/quittung` und `POST /api/handlungen/{id}/quittung`, erst nachdem die
Antwort oder Handlung im geschriebenen Zustand steht. `404` bei unbekannter `id`; doppelt
quittieren schadet nicht. Kommt eine Antwort ein zweites Mal (die Quittung erreichte die Brücke
nicht), erkennt der Treiber sie am Fragenschlüssel, eine Handlung an `handlungenErledigt` im
Zustand: Er quittiert nur noch. Jede wirkt genau einmal.

## 5. Holodeck: `POST /api/holodeck`

Die Prototypen eines Projekts (#44). Die Brücke läuft im Container und sieht keine Projektordner:
Der Treiber liest sie und schickt sie, die Brücke liefert sie nur aus ihrem Speicher aus.

Body (Form: `beispiel/holodeck.json`, dort eine Liste mit einem Body je Projekt):
`{forge, dateien: [{name, titel, geaendert, inhalt}]}`. Antwort `{"ok": true, "dateien": <n>}`,
`401` ohne passenden Token, `422` bei ungültigen Feldern. Der Satz **ersetzt** den vorigen des
Projekts; eine gelöschte Datei verschwindet, ein leerer Satz leert das Projekt.

| Feld | Woher im Treiber | Prüfung der Brücke |
|---|---|---|
| `name` | Dateiname, **nie ein Pfad** | `^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.html$`, je Satz nur einmal |
| `titel` | Text von `<title>`, sonst der Dateiname | höchstens 300 Zeichen |
| `geaendert` | mtime der Datei, ISO | höchstens 40 Zeichen |
| `inhalt` | die Datei als UTF-8 | höchstens 2 MB |

Höchstens 50 Dateien je Satz. **Der Treiber** liest aus dem Ordner des Projektadapter-Schlüssels
`prototype_dir` (Standard `prototypen/`, relativ zur Repo-Wurzel) nur reguläre Dateien direkt im
Ordner mit der Endung `.html` und einem Namen nach obiger Regel: keine Unterordner, keine Symlinks
oder Junctions (auch nicht auf dem Weg), nichts, dessen aufgelöster Pfad außerhalb des Ordners
liegt, nichts über 2 MB, höchstens 50 (nach Namen sortiert). Führt `prototype_dir` aus dem
Repository (absolut oder mit `..`), liest er nichts. Was er auslässt, meldet er einmal als
Ereignis `Holodeck: …`, ohne Pfad. Fehlt der Ordner, schickt er einen leeren Satz.

Er schickt nur, wenn sich der Satz geändert hat (SHA-256 über Namen und Inhalte, im Prozess
gemerkt; ein Neustart schickt einmal), nach dem Bericht des Takts, mit einer Zeitgrenze von 10 s.
Nimmt die Brücke den Satz nicht an (aus, älter, Fehler), versucht er es im nächsten Takt wieder
und arbeitet sonst ungestört weiter.

**Auslieferung:** `GET /holodeck/<owner>/<name>/<datei>` löst Projekt und Dateinamen nur gegen
gespeicherte Einträge auf; jeder andere Name, `..`, kodierte oder doppelt kodierte Schrägstriche,
Backslash und ein fremdes Projekt geben `404`, nie eine Datei. Die Antwort trägt
`Content-Security-Policy: sandbox allow-scripts` (ohne `allow-same-origin`: opaker Ursprung, kein
Zugriff auf localStorage, Cookies und API der Brücke), `default-src 'none'`, Skripte, Stile,
Bilder, Schriften und Medien nur von `https:` oder eingebettet, `connect-src 'none'`,
`form-action 'none'`, `base-uri 'none'`, `frame-ancestors 'self'`, dazu
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-cache`. Die
Brücken-API sendet keine CORS-Köpfe; ein Prototyp kann ihre Antworten also nicht lesen.

In `GET /api/tafel` steht die Liste ohne Inhalt als `prototypen[]`:
`{forge, kurz, name, titel, geaendert, url}`, sortiert nach `forge` und `name`; `url` ist der
Auslieferungspfad oben.

In `GET /api/tafel` steht außerdem `sitzungen[]` (Schiffsliste, #41): `{konto, projekt, name, status,
kind, seit, forge}`. `forge` ist das Projekt, dessen Repository-Name (letzter Teil der `forge`) dem
`projekt` der Sitzung gleicht (ohne Groß/Klein), sonst `null` (die Liste zeigt „Sonstige“). Dieselbe
Sitzung aus mehreren Berichten steht einmal (der neuere gilt); Berichte stiller Projekte zählen nicht.

In `GET /api/tafel` trägt jedes Projekt in `projekte[]` zusätzlich `epics[]` (Sternenkarte, #43), die
flache Sicht seiner **offenen** Epics (ohne `gemergt`, `fertig` und die aufgegebenen), sortiert nach
Stufe (blockiert, Frage, läuft, PR, wartend), `prio` zuerst, Nummer: `{id, nr, titel, stufe, prio,
konto, issueUrl, pr, prUrl, warum, fragen, prognose, pakete[], nach[], folgen[]}`. `warum` ist bei
`blockiert` der ganze `grund`, sonst die `notiz`; `pakete[]` wie auf der Brücke samt `url`; `nach[]`
sind die Kanten `{nr, titel, stufe, offen, issueUrl}`, `offen` sagt, ob der Vorgänger selbst noch
offen ist (sonst erledigt oder dem Bericht unbekannt, `stufe` dann `null`); `folgen[]` die Nummern
der offenen Epics, die nach diesem kommen. Das Projekt trägt wie bisher `prognose`. Alles stammt aus
dem Bericht, die Brücke fragt keine Forge.

## Was die Seite selbst nutzt

`GET /api/tafel` (das Board in drei Ebenen, dazu `prototypen[]` und `sitzungen[]`), `GET /holodeck/…` (im
abgeschotteten Rahmen), `POST /api/pin` (PIN prüfen, Kopf `X-Bruecke-Pin`),
`POST /api/antwort` (`{forge, epic, nr, seit, option, text}`) und `POST /api/handlung`
(`{forge, epic, art, nr, seit, text}`), beide mit `X-Bruecke-Pin`. Fünf falsche PINs je Absender
sperren für fünf Minuten.
