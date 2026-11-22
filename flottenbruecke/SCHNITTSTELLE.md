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
| `konten[]` | `{konto, stufe, fuenf, woche, alterMin, grund?}`; `grund` (optional, höchstens 4000 Zeichen, der Treiber kürzt) nur bei `gelb`/`rot`: warum der Treiber das Konto bremst, sonst fehlt das Feld; `konto` = `Konto <n>` aus `konten.json` (sonst Ordnername, nie der Pfad), `stufe` `gruen`/`gelb`/`rot`, `fuenf` und `woche` je `{verbraucht, reset}` (Prozent und ISO-Zeit) oder `null` |
| `ram`, `platte`, `obergrenze` | RAM-Messung und -Bremse, `freiGb` und Schwelle, `bremse.obergrenze` |
| `fragen[]` | die **offenen** `MenschFrage`n, vollständig (unten) |
| `ereignisse[]` | die letzten 30 Logbuch-Ereignisse `{zeit, epic, text}`: das Laufband |
| `prognose` | `{status, ab, bisher, treffer, geprueft, backlog, berechnet}`: `zu_wenig` unter `ab` Messungen, `ungenau` bei unter 60 % Treffern (ausgeblendet), sonst `ok`; `backlog` `{p50, p90}` in Sekunden ab `berechnet`, ohne Wartezeit auf den Menschen. Fehlt bei einem älteren Treiber |
| `entscheidungen[]` | `{epic, nr, frage, antwort, herkunft, grund, einflussreich, zeit, widerrufen, von}`: die Entscheidungen des Admirals und (#52) die Antworten des Menschen, `von` `mensch`, `admiral` oder `lauf` (der Admiral folgte der Empfehlung des Laufs). Der Treiber schickt **alle Entscheidungen jedes nicht gemergten Epics** und dazu die letzten 100, zusammen höchstens die neuesten 500 (Grenze der Brücke); Texte kürzt er auf 4000 Zeichen (`herkunft` 500), damit nie der ganze Bericht abgelehnt wird. Eine Antwort des Menschen wird beim Anwenden zur Entscheidung (`herkunft` `Mensch über die Brücke` oder `Mensch über die Flotte`, `einflussreich` `false`, `zeit` = Zeitpunkt der Antwort). Ein älterer Treiber ohne `von`: Die Brücke liest `mensch` aus einer `herkunft`, die mit „Mensch“ beginnt, sonst `admiral`; ein unbekanntes Wort ist kein `422`. „Erledigt heute“ zeigt die des Admirals von heute, die Detailansicht des Epics alle bis zum Merge (unten) |
| `sitzungen[]` | optional (Schiffsliste, #41): die Sitzungen aller Konten des Treibers aus `claude agents --json` je Konto (nur lesend, höchstens einmal je Minute): `{konto, projekt, name, status, kind, seit}`. `konto` wie in `konten[]`, `projekt` **nur der letzte Ordnername** des Arbeitsverzeichnisses (nie der Pfad; ein Wert mit `/` oder `\` wird mit `422` abgelehnt), `status` etwa `busy`/`idle`, `kind` etwa `interactive`, `seit` ISO aus `startedAt`. Kein `cwd`, keine `pid`, keine Sitzungs-ID; die Brücke verwirft unbekannte Felder. Fehlt das Feld (älterer Treiber) oder ist es leer, bleibt die Liste ohne Sitzungen |
| `einstellungen[]` | optional (#58): die wirksamen Einstellungen des Treibers, die der Mensch auf der Brücke ändern kann (unten). Fehlt das Feld (älterer Treiber), zeigt die Brücke keine |
| `triage` | optional (#116, Frachtraum): `{gelesen, laeuft, tickets[], entscheidungen[], fragen[], schnittplan}`, unten. Fehlt es (älterer Treiber), zeigt der Frachtraum das Projekt nicht |
| `freigegeben[]` | optional (#61): `{nr, titel}` der offenen Epics der Forge mit `epic_label` und `ready_label` (am Epic oder an einem Kind, wie ohne `--epics`), die **nicht** im Einsatz sind. Der Treiber liest sie nur mit Brücke, höchstens alle 5 min; die Brücke bietet für sie „Aufnehmen“ an. Fehlt das Feld (älterer Treiber), gilt `[]` |

Die Prozentwerte gehen nur an die Brücke im eigenen Netz. Das Logbuch im Repo nennt weiter nur
Stufen.

**Triage** (#116): `tickets[]` sind die offenen Sternzeit-Notizen der Forge (`needs-triage`, `needs-info`),
je `{nr, titel, labels[]}`; `fragen[]` die kritischen Fragen der Triage, auf die noch kein Berechtigter
geantwortet hat, je `{ticket, nr, titel, frage, optionen[] {buchstabe, text}, empfehlung, grund, herkunft,
marke, seit}`. Beides liest der Treiber aus der Forge (`gh issue list` je Label samt Kommentaren, zwei
Aufrufe): die Fragen aus dem letzten Kommentar mit `<!-- flotte:triage-frage -->` (Format
`triageKommentar`, gelesen von `offeneFragen` in `flotte/src/triage.ts`); `seit` ist dessen Zeit und mit
`ticket` und `nr` der Schlüssel, die Buchstaben vergibt der Treiber in der Reihenfolge der Optionen.
`gelesen` sagt wann. Gelesen wird nur mit Brücke: beim Start, höchstens alle 30 min (`TRIAGE_MS`) und
sofort nach einem Triage-Lauf, einer Antwort oder einem Widerruf über die Brücke, denn Sternzeit-Notizen
ändern sich selten und meist genau dann. `entscheidungen[]` sind die Entscheidungen der Triage-Läufe,
die dieser Treiber über die Brücke gestartet hat, neueste zuerst, höchstens 50, gespeichert im Zustand
(`triage`, überdauert einen Neustart): `{nr, titel, ergebnis, herkunft, grund, zeit, widerrufen}`,
`ergebnis` `klar` (Warp frei) oder `ueberfluessig` (geschlossen), nur was geschrieben und ohne Fehler
umgesetzt ist; (`nr`, `zeit`) ist der Schlüssel für den Widerruf. `laeuft` ist `true`, solange ein
Triage-Lauf des Treibers läuft. Die Brücke baut die Links aus `url` des Projekts (`<url>/issues/<nr>`).
Eine Entscheidung `klar`, deren Notiz der Schnittplan an eine Mission hängte, trägt beim Treiber dazu
`mission` (die Brücke verwirft das Feld); ihr Widerruf löst die Notiz aus dieser Mission.

**Schnittplan** (#148): `schnittplan` (optional, `null` vor dem ersten Triage-Lauf oder wenn der letzte
keinen Plan schnitt; fehlt es, älterer Treiber, zeigt der Frachtraum keinen) ist der Schnittplan des
letzten Triage-Laufs dieses Treibers, gespeichert im Zustand: `{zeit, fehler, missionen[], notizen[]}`.
`fehler`: der Plan war ungültig, nichts geschrieben. `missionen[]` (höchstens 20) je `{nr, url, titel,
begruendung, neu, kinder[] {nr, titel, grund}, freigegeben, fehler, widerrufen}`: `neu` die vom Lauf
angelegten Missionen (nur mit Nummer; `url` aus der Ausgabe von `flotte triage`), sonst eine offene
Mission, an die der Lauf Notizen hängte (`url` `null`, `begruendung` leer); `kinder` die in diesem Lauf
verknüpften Notizen mit dem Grund des Plans; `freigegeben` bei `neu`: die Mission trägt `ready_label`,
sonst: mindestens ein angehängtes Kind bekam Warp frei; `fehler` ein gescheiterter Schritt des Laufs oder
(`Widerruf: …`) des Widerrufs; `widerrufen` der Einwand nach `schnitt-widerruf`. `notizen[]` (höchstens
200) die vom Plan geschlossenen, je `{nr, titel, art, grund, verweis, fundstelle, fehler}`, `art`
`zusammengefuehrt` (`verweis` = die Notiz, die bleibt), `ueberfluessig` (`fundstelle`) oder `verworfen`.

**Lernvorschläge** (#117): Nennt der Adapter `lern_issue`, liest der Treiber dazu die Kommentare dieses
Issues (`gh issue view`, ein Aufruf) und meldet jeden noch offenen Vorschlag der Lernschleife (keine
Entscheidung der Triage, oder eine Frage, oder eine Antwort darunter) als Ticket `{nr: <lern_issue>,
titel: "Lernvorschlag <id>/<n>: <Titel>", labels: ["Lernschleife"]}`; der Frachtraum zeigt sie so ohne
eigenes Feld unter dem Thema `Lernschleife`. Ein klarer Vorschlag, dessen Missionsziel fehlt (unter
der Entscheidung steht kein Kommentar `→ #<neu>`), bleibt mit `— Missionsziel fehlt` am Titel stehen,
bis ein Mensch einen Kommentar mit der Kennung in der ersten Zeile schreibt. Ein Vorschlag mit dem
Kommentar `→ #<neu>` ist entschieden und erscheint nie wieder, auch nach einem späteren Kommentar mit
seiner Kennung. Scheitert das Lesen des `lern_issue`, meldet der Treiber die Sternzeit-Notizen ohne
Vorschläge. Eine Frage zu einem Vorschlag hat `ticket` = `lern_issue`,
denselben Titel und zusätzlich `lernvorschlag` (die Kennung); eine Entscheidung ebenso `lernvorschlag`,
bei `klar` ist `nr` das angelegte Missionsziel, bei `ueberfluessig` das `lern_issue`, und `zeit` ist je
Eintrag eigen (Millisekunden), damit (`nr`, `zeit`) Schlüssel bleibt. Die Brücke verwirft
`lernvorschlag` wie jedes unbekannte Feld; der Treiber hält es selbst. Sie markiert im Frachtraum alle
Vorschläge eines `lern_issue` mit „Frage“, sobald einer eine offene Frage hat (`frage` hängt an `nr`).

In `GET /api/tafel` steht `frachtraum[]`, ein Eintrag je Projekt mit `triage`, die mit offenen Fragen
zuerst: `{forge, kurz, url, aktiv, veraltet, gelesen, laeuft, zahl, handlung, fragen[], entscheidungen[],
themen[]}`. `handlung` ist ein noch nicht quittierter Triage-Lauf; jede Frage trägt dazu `id`, `issueUrl`,
`empfohlen` (die Buchstaben der Empfehlung, sonst die Option, deren Text der Empfehlung gleicht) und
`handlung` (die Antwort unterwegs), jede Entscheidung `id`, `issueUrl`, `widerrufbar` und `handlung`.
`schnittplan` (#148, sonst `null`) ist `{zeit, fehler, missionen[], notizen[]}` wie im Bericht; jede
Mission trägt dazu `id`, `forge`, `issueUrl`, `kinder[].issueUrl`, `zustand` (`widerrufen`, `fehler`,
`frei` oder `offen`, in dieser Rangfolge), `widerrufbar` (nicht widerrufen und neu oder mit Kindern) und
`handlung` (der Widerruf unterwegs), jede Notiz `issueUrl` und `verweisUrl`.
`themen[]` bündelt die Tickets nach Thema, `{thema, tickets[] {nr, titel, issueUrl, labels, themen, frage}}`:
Thema sind die Labels ohne `needs-triage`, `needs-info`, `ready-for-agent`, `status/*` und `epic`, sonst
„ohne Thema“; ein Ticket mit zwei Themen steht in beiden. Ein Thema mit offener Frage steht oben, „ohne
Thema“ unten, sonst nach Namen; darin Tickets mit Frage zuerst, dann nach Nummer.

**Einstellungen** (#58): je Einstellung `{name, titel, wert, herkunft, seit, standard, leer, min?, max?,
auswahl?, werte?, hinweis?}`, immer alle in dieser Reihenfolge (elf; ein älterer Treiber meldet die
ersten zehn ohne `merge`). `herkunft` ist `start` (Startparameter oder ein
vom Standard abweichender Startwert), `bruecke` (zuletzt über die Brücke geändert) oder `standard`;
`seit` ist bei `bruecke` der Zeitpunkt der Änderung, sonst der Beginn des Einsatzes. `standard` ist
der Wert ohne Startparameter und Brücke. `leer: true` heißt, `wert` darf `null` sein (zurück auf
automatisch). Zahlen sind ganze Zahlen zwischen `min` und `max` (die Brücke übernimmt die Grenzen von
hier, statt sie selbst zu kennen); Konten stehen als Kurzname wie in `konten[]` (`Konto <n>`, sonst
Ordnername, nie ein Pfad), `auswahl` nennt die Konten, die es auf dem Rechner des Treibers gibt.
Eine Wahl unter Wörtern (#112, `merge`) trägt `werte`, die Wörter, die der Treiber **jetzt** annimmt,
und `hinweis`, warum eines fehlt (sonst `null`); die Brücke lehnt ein anderes Wort mit `422` und dem
Hinweis ab.

| `name` | `titel` | Wert | Grenzen, Standard | Wirkung |
|---|---|---|---|---|
| `obergrenze` | Epics gleichzeitig | Zahl oder `null` | 1–4, `null` = aus der Wochen-Hochrechnung (4, 2 oder 1); Startparameter `--obergrenze` | ersetzt die Hochrechnung wie `--obergrenze`; eine gesenkte Grenze startet nur weniger |
| `paketeJeEpic` | Pakete je Epic gleichzeitig | Zahl | 1–3, Standard 3 | steht im Startauftrag an `/epic` („höchstens N Pakete gleichzeitig“), eine Änderung als Nachricht beim nächsten Fortsetzen jedes laufenden Epics; `/epic` senkt sein Fenster ab dem nächsten frei werdenden Platz, laufende Pakete laufen zu Ende |
| `konten` | Konten der Läufe | Liste, mindestens eines | aus `auswahl`; Standard = `--konten` | neue Epics nur noch auf diese Konten; ein Epic bleibt auf seinem Konto, auch für Fortsetzung und Nacharbeit; ein entferntes Konto startet nur nichts Neues |
| `admiral` | Admiral-Konto | Konto oder `null` | aus `auswahl`; `null` = das Konto des Epics; Startparameter `--admiral` | die nächsten Admiral-Aufrufe |
| `verbrauchGelb` | Verbrauch 5 h gelb über (%) | Zahl | 1–98, Standard 60, unter `verbrauchRot` | über dem Anteil im 5-Stunden-Fenster startet nichts Neues; die Hochrechnung behält ihre Schwellen (gelb ab 90 %, rot über 120 %) |
| `verbrauchRot` | Verbrauch 5 h rot über (%) | Zahl | 2–99, Standard 85, über `verbrauchGelb` | darüber halten auch Fortsetzungen an |
| `leerfahren` | Bis 100 % leerfahren | Liste | aus `auswahl`, Standard `[]` | diese Konten bremsen weder Hochrechnung noch Gelb, rot erst bei 100 %; ein Wert älter als 30 min bleibt rot |
| `ramWarn` | RAM-Schwelle (%) | Zahl oder `null` | 50–84 (unter der Halte-Schwelle von `ram.ps1`, Standard 85), `null` = Adapter, sonst 75; Startparameter `--ram-warn` | Warnschwelle für `ram.ps1` und die Rückkehr 5 Punkte darunter |
| `platteMinGb` | Plattenminimum (GB) | Zahl | 1–1000, Standard 20; Startparameter `--platte-min-gb` | darunter startet nichts Neues |
| `leerlaufMin` | Leerlauf (Minuten bis Nachfassen/Abbruch) | Zahl | 5–480, Standard 60; Startparameter `--leerlauf-min` | gilt für jeden Zug, der danach beginnt; ein laufender Zug behält seine Grenze. `leerlaufS` folgt |
| `merge` | Andocken | `automatisch` oder `mensch` | `werte`; Standard = Adapterschlüssel `merge` (`nach_gate` → `automatisch`, sonst `mensch`) | wie das Projekt andockt, ab dem nächsten Takt: `automatisch` = Merge-Schlange und `merge.ps1` nach grünem Gate, `mensch` = wie `merge: mensch` (PR bereit, ein Mensch mergt). Je Epic gilt die wirksame Stellung (Epic-Feld `merge`); ein PR, der nur wegen ihr wartet, kommt bei `automatisch` in die Schlange |

**Die Brücke verschärft nur** (#112): `automatisch` gibt es nur, wenn der Adapter `merge: nach_gate`
sagt. Sonst fehlt es in `werte`, `hinweis` sagt warum, und der Treiber lehnt es ab (Ereignis
`Einstellung Andocken über die Brücke abgelehnt: der Adapter sagt merge: mensch, …`); ein
gespeichertes `automatisch` fällt nach einem Neustart mit einem Ereignis weg. Die harte Grenze bleibt
`merge.ps1`: Es liest `merge` vom Standardzweig und mergt nur bei `nach_gate`.

Nicht einstellbar (bewusst): die Merge-Regel des Adapters (`merge` dort lockert die Brücke nie), Rechte,
Geheimnisse, Updates.

Gespeichert sind Änderungen der Brücke im Zustand des Treibers (`zustand.json`, `einstellungen`);
sie gelten nach einem Neustart weiter. Ein Startparameter, der ausdrücklich gesetzt ist, gewinnt beim
Start: Der Treiber nimmt dessen Wert, vergisst den der Brücke und meldet das als Ereignis
(`Einstellung … : Startparameter --… gilt (…) statt … von der Brücke`). Ein gespeichertes Konto, das
es nicht mehr gibt, fällt mit einem Ereignis weg.

**Epic:** `nr`, `stufe`, `pr`, `notiz`, `geparkt`, `schritt`, `schrittZeit`, `titel`, `konto`,
dazu

| Feld | Bedeutung |
|---|---|
| `prozess` | ein `claude -p` arbeitet gerade für das Epic: das Lebenszeichen pulst |
| `grund`, `haltZeit`, `log[]` | bei `blockiert`/`abgebrochen`: der Grund, seit wann, die letzten 12 Ereignisse des Epics als Zeilen `HH:MM Text` |
| `aufgegebenAm` | der Mensch hat das Epic über die Brücke aufgegeben |
| `prognose` | nur bei `wartend`: `{p50, p90}` in Sekunden, sonst `null` |
| `prio` | die wirksame Priorität: `prioritaet` der Brücke, sonst das Label `prio/hoch` (Adapter `prio_label`) am Epic oder einem Kind; `notiz` sagt, warum es trotzdem wartet |
| `imEinsatz` | optional (#61): das Epic gehört zum Einsatz dieses Treibers (`--epics`, eingesammelt oder aufgenommen). Ein Epic eines früheren Einsatzes kann im Zustand stehen, ohne gefahren zu werden: `false`. Fehlt es (älterer Treiber), gilt `true` |
| `pausiert` | optional (#61): ISO-Zeit, seit der der Mensch das Epic pausiert hat, sonst `null` |
| `prioritaet` | optional (#61): `hoch` oder `normal`, wie der Mensch sie auf der Brücke gesetzt hat; `null`: keine, es gilt das Label |
| `merge` | optional (#112): `{stellung, herkunft, grund}`, wie das Epic jetzt andockt. `stellung` `automatisch` oder `mensch`; `herkunft` `epic` (Schalter des Menschen auf der Brücke), `vorschlag` (Body des Epics oder Titel/Body eines Kindes nennt ein Merkmalswort eines Punkts von `BEIM_MENSCHEN`, `MERKMALE` in `flotte/src/treiber/admiral.ts`: dann `mensch`; gelesen beim Start, Nachsammeln und Aufnehmen, ein später geänderter Body wirkt erst beim nächsten Start) oder `projekt` (die Einstellung `merge`); `grund` der Grund des Vorschlags `<Punkt>: „<Fundwort>“ in #<nr>`, auch wenn der Schalter ihn überstimmt, sonst `null`. Ohne `nach_gate` im Adapter ist `stellung` immer `mensch`. Fehlt es (älterer Treiber), zeigt die Brücke keinen Schalter |
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
| `einreihen` | Epic `blockiert` oder `abgebrochen`, nicht aufgegeben | Zähler auf null; mit Sitzung zurück auf `laeuft` mit einer Fortsetzung, die den Grund der Blockade und die noch unbeantworteten Fragen des Laufs als offen nennt, sonst `wartend` |
| `aufgeben` | wie `einreihen` | Stufe `abgebrochen`, `aufgegebenAm`; Branch, PR und Issue bleiben |
| `widerruf` | `nr`, `seit` (= `zeit` der Entscheidung) und `text`; Epic nicht `gemergt`/`fertig`, noch kein Widerruf; eine Entscheidung des Admirals oder (#52) eine Antwort des Menschen | Kommentar am Issue, bei einflussreichen Entscheidungen auch ins Protokoll; der Lauf bekommt `widerruf: <Frage> → <Text>` im nächsten Zug, ein Epic in `pr` geht dafür zurück auf `laeuft`. Nach dem Merge nur der Kommentar und ein Ereignis, nichts an den Lauf; ein zweiter Widerruf derselben Entscheidung bleibt ein Ereignis |
| `einstellen` | `epic` `0`, `text` = `{"name", "wert"}` als JSON (unten), mit PIN | prüft die Grenzen, setzt den Wert ab diesem Takt, speichert ihn im Zustand, Ereignis und Flottenlogbuch; ein ungültiger Wert wird ein Ereignis |
| `aufnehmen` | `epic` steht in `freigegeben[]` des Berichts, mit PIN | prüft an der Forge: offen, `epic_label`, `ready_label` am Epic oder einem Kind, noch nicht im Einsatz; nimmt es in den Einsatz (Belegung wie jedes Epic), merkt es im Zustand (`aufgenommen`, gilt nach einem Neustart bis zum Merge), Ereignis und Flottenlogbuch |
| `pausieren` | Epic im Bericht, `imEinsatz`, nicht `gemergt`/`fertig`/aufgegeben, nicht `pausiert`, mit PIN | `pausiert` = jetzt, auch als Feld `pausiert` in der Haltedatei des Epics: ein wartendes Epic startet nicht; ein laufender Lauf erfährt die Pause vor seinem nächsten Paketstart über die RAM-Messung (`ram.ps1` meldet `hold` mit `reason: "paused"`), startet kein weiteres Paket, laufende Pakete laufen zu Ende, der Zug endet mit `FLOTTE-FRAGE ram`; der nächste Zug (Antwort des Admirals, Fortsetzung, Nacharbeit) bleibt zurückgehalten; Merge-Schlange und Merge laufen weiter. Ereignis und Flottenlogbuch |
| `fortsetzen` | Epic `pausiert`, sonst wie `pausieren` | hebt die Pause auf (auch in der Haltedatei); der zurückgehaltene Zug geht unverändert an den Lauf, ein wartendes Epic startet nach der Belegung. Ereignis und Flottenlogbuch |
| `prioritaet` | `text` `hoch` oder `normal` (sonst `422`), sonst wie `pausieren` ohne die Pause | setzt die Priorität des Epics; sie gilt vor dem Label `prio/hoch`: hoch geht unter den startbereiten bei freiem Platz zuerst, Reihenfolge-Kanten und Kollisionen bleiben vorrangig. Ereignis und Flottenlogbuch |
| `merge` | #112: `text` `automatisch`, `mensch` oder `null` (zurück zum Vorschlag), sonst `422`; das Epic trägt `merge` im Bericht (sonst `409`); `automatisch` nur, wenn `werte` der Einstellung `merge` es nennt (sonst `409` mit dem Hinweis); sonst wie `prioritaet` | setzt den Schalter des Epics (`merge` im Zustand, gilt nach einem Neustart bis zum Merge); er überstimmt Vorschlag und Projekt. Ein PR, der nur wegen seiner Stellung auf einen Menschen wartet, kommt bei `automatisch` in die Merge-Schlange; ein Epic in der Schlange, das auf `mensch` geht, wird als Kopf nicht gemergt (PR bereit); ein laufender Merge läuft zu Ende. `automatisch` unter `merge: mensch` lehnt auch der Treiber ab. Ereignis und Flottenlogbuch |
| `triage` | #116: `epic` `0`, `nr`, `seit`, `text` `null`, mit PIN; `forge` ein Projekt mit `triage` im Bericht (`404` unbekannt, `409` ohne `triage` oder bei `laeuft`) oder `alle`: eine Handlung je Projekt mit `triage` ohne laufenden Lauf (Antwort `{ok, id, ids}`) | führt `flotte triage` (`triagiere`) für sein Projekt nebenher aus, auf dem Admiral-Konto (rot: ein anderes mit Luft), einen zur Zeit. Ereignis und Flottenlogbuch `Triage-Lauf gestartet, Mensch über die Brücke` und `Triage-Lauf beendet: N Warp frei[ (A an Missionen angehängt)][, P Missionen angelegt], M geschlossen[, Ü überflüssig], K Fragen an den Menschen[, L ohne Ergebnis]` (Ü: überflüssige Lernvorschläge, #117; sie schließen nichts; A und P aus dem Schnittplan, #147) |
| `triage-antwort` | #116: `epic` = Ticket, `nr` und `seit` die Frage aus `triage.fragen` (sonst `404`), `text` das JSON `{"option", "text"}`: ein Buchstabe der Frage (sonst `422`) und/oder eigener Text, mindestens eines; mit PIN | ein Kommentar ans Ticket ohne Triage-Marken (der Treiber entfernt sie auch aus dem Freitext): `**Antwort des Menschen (Mensch über die Brücke)** — Sternzeit-Notiz #<nr>, Frage <n>: <Frage>`, `Antwort: <B) Optionstext — eigener Text>`, `Herkunft: Mensch über die Brücke`. Der `gh`-Account des Treibers zählt als berechtigt, der nächste Triage-Lauf nimmt die Antwort als Tatsache. #117: Bei einem Lernvorschlag steht der Kommentar am `lern_issue`, die erste Zeile endet mit `— Lernvorschlag <id>/<n>, Frage <n>`, die Frage folgt als `Frage: <Frage>` in der zweiten (als Antwort zählt die Kennung nur in der ersten Zeile). Sonst ändert sich nichts. Ereignis |
| `schnitt-widerruf` | #148: `epic` = Mission aus `triage.schnittplan.missionen` (sonst `404`), `text` der Einwand (`422` ohne), noch nicht widerrufen und neu oder mit Kindern (sonst `409`); mit PIN | zuerst der Kommentar an der Mission `**Widerruf des Menschen (Mensch über die Brücke)** — Mission #<nr> „<Titel>“ aus dem Schnittplan zurückgenommen` (bestehende Mission: `— Missionsziele aus dem Schnittplan zurückgenommen: #a, #b`) mit `Einwand`, was danach geschieht, und `Herkunft`; scheitert er, ändert sich nichts. Neue Mission: `ready_label` ab; im Einsatz, noch nie gestartet (`wartend`, kein Zug, kein Auftrag): aus dem Einsatz ausgetragen (auch aus `aufgenommen` und dem Zustand); schon gestartet: pausiert (wie `pausieren`) und Andocken auf `mensch` (wie `merge`, #112), ihr PR wird nur von einem Menschen gemergt. Je Kind (ohne die schon einzeln widerrufenen): Kommentar `… — Sternzeit-Notiz #<n> aus Mission #<nr> „<Titel>“ gelöst` mit `Einwand`, `Nicht wieder in Mission #<nr>: …` und `Herkunft`, ohne Triage-Marke; dann Sub-Issue gelöst (`DELETE /repos/{o}/{r}/issues/{mission}/sub_issue`), Zeile `- [ ] #<n>` aus der Liste der Mission, `ready_label` ab, `needs-triage` an; ihre Entscheidung `klar` gilt als widerrufen. Zuletzt eine neue Mission `gh issue close --reason "not planned"`. Gescheiterte Schritte: `fehler` der Mission (`Widerruf: …`), Ereignis und Flottenlogbuch; nichts wird wiederholt |
| `triage-widerruf` | #116: `epic` = Ticket, `seit` = `zeit` der Entscheidung aus `triage.entscheidungen` (sonst `404`), `text` der Einwand (`422` ohne), noch nicht widerrufen (`409`); mit PIN | zuerst der Kommentar `**Widerruf des Menschen (Mensch über die Brücke)** — Triage-Entscheidung „Warp frei“ (oder „geschlossen“) zu Sternzeit-Notiz #<nr> zurückgenommen` mit `Einwand`, `Vorher` und `Herkunft`; scheitert er, ändert sich nichts. Dann `klar`: hing die Notiz an einer Mission (#148; der Kommentar nennt dann das Lösen und `Nicht wieder in Mission #<nr>`), erst gelöst wie bei `schnitt-widerruf` (scheitert das, bleiben die Labels), dann `ready_label` ab, `needs-triage` an; `ueberfluessig`: wieder geöffnet. #117: Bei einem Lernvorschlag ist `klar` dasselbe am Missionsziel (`epic` = dessen Nummer); `ueberfluessig` ist nur der Kommentar `… Triage-Entscheidung „überflüssig“ zu Lernvorschlag <id>/<n> zurückgenommen` am `lern_issue`, der nächste Triage-Lauf entscheidet den Vorschlag neu. Ereignis und Flottenlogbuch |

`einreihen` und `aufgeben` schließen sich aus: Bis zum Abholen gilt die letzte. Danach antwortet die
Brücke `409`. Endet der Einsatz, weil alles blockiert ist, wirkt die Handlung beim nächsten Start.
Ebenso schließen sich `pausieren` und `fortsetzen` je Epic aus; von `prioritaet`, `merge` und
`aufnehmen` gilt je Epic die letzte bis zum Abholen; ebenso (#116) je Projekt von `triage`, je Frage von
`triage-antwort`, je Entscheidung von `triage-widerruf` und (#148) je Mission von `schnitt-widerruf`. Was beim Treiber nicht passt (ein Lauf läuft
schon, kein Konto mit Luft, Frage nicht mehr offen, unbekannte Option, Entscheidung unbekannt oder schon
widerrufen, Kommentar gescheitert), ändert nichts und wird ein Ereignis `Triage-Lauf …`, `Triage-Antwort …`,
`Widerruf einer Triage-Entscheidung über die Brücke abgelehnt: <Grund>` oder `Widerruf einer Mission des Schnittplans über die Brücke abgelehnt: <Grund>`; quittiert wird beides.

**Epics steuern** (#61): `aufnehmen`, `pausieren`, `fortsetzen`, `prioritaet` und (#112) `merge`
betreffen ein Epic (`epic` ≥ 1, sonst `422`), `nr` und `seit` sind `null`, `text` ist nur bei
`prioritaet` (`hoch` oder `normal`) und `merge` (`automatisch`, `mensch` oder `null`) gesetzt. Angenommen werden sie wie `widerruf` nur mit PIN; `404`, wenn die Brücke das
Epic nicht kennt (`aufnehmen`: `409`, wenn es nicht in `freigegeben[]` steht), `409`, wenn es nicht
passt (Spalte oben). Der Treiber prüft selbst noch einmal; was nicht passt (Epic unbekannt oder nicht
im Einsatz, nicht freigegeben, schon pausiert, nicht pausiert, unbekannte Priorität), ändert nichts und
wird ein Ereignis `<Handlung> über die Brücke abgelehnt: <Grund>` (`Aufnehmen`, `Pausieren`,
`Fortsetzen`, `Priorität`, `Andocken`); quittiert wird beides. Wirkung ab dem Takt, in dem der Treiber sie abholt;
nichts Laufendes wird abgebrochen. `aufnehmen` umgeht weder `ready_label` noch die Merge-Regel noch
ein Tor. Ereignis und Kommentar im Flottenlogbuch:
`Epic #<nr> in den Einsatz aufgenommen, Mensch über die Brücke`,
`Epic #<nr> pausiert, <Lage>; Mensch über die Brücke`, `Epic #<nr> fortgesetzt[, der zurückgehaltene
Zug geht an den Lauf]; Mensch über die Brücke`, `Priorität von #<nr> von <alt> → auf <neu>, Mensch
über die Brücke`, `Andocken von #<nr> von <alt> → auf <neu>, Mensch über die Brücke` (`null`: `auf den
Vorschlag (<Stellung>)` oder `auf die Einstellung des Projekts (<Stellung>)`). Beispiel beim Abholen:

```json
{
  "id": 9,
  "epic": 41,
  "art": "prioritaet",
  "nr": null,
  "seit": null,
  "text": "hoch",
  "zeit": "2026-11-20T14:44:00+00:00",
  "herkunft": "Mensch über die Brücke"
}
```

In `GET /api/tafel` trägt jede Zeile in `projekte[].epics[]` dazu `imEinsatz`, `pausiert`,
`prioritaet`, `merge` (#112, aus dem Bericht, sonst `null`) und die noch nicht quittierten Handlungen
`pause` (`pausieren`/`fortsetzen`), `vorrang` (`prioritaet`) und `andocken` (`merge`), je `{id, art, text, zeit, abgeholt, quittiert}` oder `null`; jedes Projekt
trägt `freigegeben[]` `{nr, titel, issueUrl, handlung}`. Die Karten der Brücke tragen `pausiert` und
`prio` (die Schiffsliste zeigt beides).

**`einstellen`** (#58) gehört zum Projekt, nicht zu einem Epic: `epic` ist `0`, `nr` und `seit` sind
`null`, `text` ist das JSON `{"name": <name>, "wert": <wert>}` mit einem `name` aus `einstellungen[]`
des Berichts und einem Wert in dessen Form (Zahl, Kurzname, Liste von Kurznamen oder `null`, wo
`leer`). Angenommen wird sie wie `widerruf` nur mit PIN (`POST /api/handlung` mit `X-Bruecke-Pin`,
Body `{forge, epic: 0, art: "einstellen", nr: null, seit: null, text}`). Beispiel beim Abholen:

```json
{
  "id": 5,
  "epic": 0,
  "art": "einstellen",
  "nr": null,
  "seit": null,
  "text": "{\"name\": \"obergrenze\", \"wert\": 2}",
  "zeit": "2026-11-20T14:40:00+00:00",
  "herkunft": "Mensch über die Brücke"
}
```

Der Treiber prüft Name und Grenzen selbst (die Brücke darf vorprüfen, muss aber nicht). Passt der
Wert, gilt er ab dem Takt, in dem der Treiber ihn abholt: Bremsen und Belegung dieses Takts rechnen
schon damit. Nichts Laufendes wird abgebrochen. Jede Änderung wird ein Ereignis und ein Kommentar im
Flottenlogbuch, `Einstellung <titel> von <alt> → auf <neu>, Mensch über die Brücke`
(`automatisch` für `null`, Listen mit Komma). Ein ungültiger Wert ändert nichts und wird ein
Ereignis `Einstellung <titel> über die Brücke abgelehnt: <Grund>`; quittiert wird beides.

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
