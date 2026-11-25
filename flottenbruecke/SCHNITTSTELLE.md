# Schnittstelle Treiber ↔ Brücke

Umgesetzt im Treiber in `flotte/src/treiber/bruecke.ts`, `holodeck.ts` und `treiber.ts` (#28,
#44). Der gemeinsame Vertrag sind [`beispiel/bericht.json`](beispiel/bericht.json),
[`beispiel/antworten.json`](beispiel/antworten.json),
[`beispiel/handlungen.json`](beispiel/handlungen.json) und
[`beispiel/holodeck.json`](beispiel/holodeck.json): pytest prüft die Brücke dagegen,
`bun test` (`flotte/test/bruecke.test.ts`, `holodeck.test.ts`) den Treiber. Für den Chat
(Abschnitt 8) ist es [`beispiel/chat.json`](beispiel/chat.json).

## Grundregeln

- **Nur der Treiber** spricht per HTTP mit der Brücke, für den Chat dazu `flotte chat`
  (Abschnitt 8). Läufe und Admiral laufen weiter mit `--strict-mcp-config` und sehen sie nicht;
  kein MCP.
- **Basis-URL:** `flotte fahren --bruecke http://127.0.0.1:4747` oder Umgebung `FLOTTE_BRUECKE`.
  Ohne sie meldet der Treiber nichts. Läuft die Brücke mit Zertifikat (#37), gilt
  `https://127.0.0.1:4747` mit `NODE_EXTRA_CA_CERTS` auf das Stammzertifikat von mkcert (`INSTALL.md`).
- **Kurze Zeitgrenze** (3 s) je Aufruf. Fehler, Zeitüberschreitung oder ein Status ≠ 2xx sind kein
  Fehler des Treibers: ein Ereignis beim Wechsel (erreichbar ↔ nicht erreichbar), sonst still
  weiter. Ist die Brücke aus, bleiben `flotte antworten` und das Issue als Weg.
- **Nur über den LAN-Eingang:** Über den Fernzugriff (Tailscale, #48, agent-skills/ADR-0006, ADR-0007) antwortet die
  Brücke auf Bericht, Abholen, Quittieren und Holodeck mit `403`, ebenso auf die Werft (Abschnitt 6) und den Chat-Dienst (Abschnitt 8);
  Treiber, Werft und Chat-Dienst melden sich wie bisher am Rechner.
- **Token (optional):** Setzt die Brücke `BRUECKE_TOKEN`, schickt der Treiber den Wert aus
  `FLOTTE_BRUECKE_TOKEN` als Kopf `X-Bruecke-Token` bei allen Aufrufen.
- **Kein `Origin` (#46):** Eine schreibende Anfrage (auch Abholen) mit einem `Origin`, der nicht die
  Brücke selbst ist, bekommt `403`. Treiber, Werft und Chat-Dienst schicken keinen `Origin`.
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
6. `POST /api/verlauf` je Mission, nur wenn sich ihr Verlauf geändert hat (Abschnitt 5a).

**Zeitnah:** Jedes Ereignis des Treibers (neue Frage an den Menschen, Stufenwechsel, Andocken) schickt
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
| `andockpruefungen[]` | optional: die letzten 20 Andockprüfungen des Treibers im Projekt, älteste zuerst, je `{zeit, epic, pr, dauerS, gruen, kontexte[]}` wie `andockpruefung` einer Mission (unten). Die Brücke zeigt sie im Maschinenraum unter „Letzte Andockprüfungen“, neueste zuerst. Fehlt es (älterer Treiber), fehlt der Abschnitt |
| `konten[]` | `{konto, stufe, fuenf, woche, vorsprung, alterMin, grund?}`; `vorsprung` (ganze Punkte −100…100 oder `null` ohne Wochenwert): übriger Anteil des Wochenlimits minus übriger Anteil der Woche bis zum Reset, danach ordnet der Treiber die Konten (`flotte/references/bremsen.md`, „Kontowahl“); `grund` (optional, höchstens 4000 Zeichen, der Treiber kürzt) nur bei `gelb`/`rot`: warum der Treiber das Konto bremst, sonst fehlt das Feld; `konto` = `Konto <n>` aus `konten.json` (sonst Ordnername, nie der Pfad), `stufe` `gruen`/`gelb`/`rot`, `fuenf` und `woche` je `{verbraucht, reset}` (Prozent und ISO-Zeit) oder `null` |
| `kontenListe[]` | optional (#95): die Konten aus `~/.claude/flotte/konten.json` des Rechners, `{nr, name, farbe, aktiv, anmeldung}`; `nr` 1–999, `name` höchstens 60 Zeichen, `farbe` `#rrggbb`, `anmeldung` `angemeldet`/`nicht angemeldet`/`ordner fehlt`/`unklar` oder `null`. Der Treiber prüft ohne Aufruf: `.credentials.json` da (der Inhalt wird nie gelesen) und kein Lauf des Kontos seitdem an der Anmeldung gescheitert; den Haiku-Aufruf macht nur `flotte konten pruefen`. Nie ein Pfad, nie ein Zugang. Fehlt das Feld (älterer Treiber), nimmt die Brücke keine Konto-Handlung an |
| `forgeStatus` | optional (#125): die Forge des Projekts am Rechner des Treibers, `{art, forge, angemeldet, konto, rechte, treiber}`; `art` `github`/`gitea`, `konto` der Kontoname (höchstens 100 Zeichen) oder `null`, `rechte` `ok`/`fehlt` (Schreibrecht auf das Repository) oder `null`, `treiber` ob der Treiber die Forge fahren kann (seit #127 GitHub und Gitea). GitHub aus `gh auth status` und `gh api repos/<forge>`, Gitea mit dem Zugang von `flotte auftrag` gegen `/user` und das Repository; alle 15 Minuten, nach einem Verknüpfen eine halbe Stunde lang jede Minute. Nie ein Token; unbekannte Felder verwirft die Brücke. `null` oder fehlend: älterer Treiber oder noch nicht geprüft |
| `projektHandlungen` | optional (#126): `true`, wenn der Treiber `projekt_hinzufuegen` und `projekt_entfernen` abholt; fehlt es (älterer Treiber), nimmt die Brücke beide nicht an |
| `klonAngebot` | optional: `{gitea, eltern}`, wenn der Treiber `projekt_hinzufuegen` mit Link klont; `gitea` die https-Herkünfte (`https://host[:port]`) der Gitea-Forges seiner Projekte (aus `api` der Adapter von eigenem Repository und Startskripten), die neben github.com als Quelle erlaubt sind; `eltern` der Ordner, in den ein neuer Klon vorgeschlagen wird (der häufigste Elternordner der Projekte, sonst `~/git`; der Heimordner steht als `~`, nie mit Benutzernamen, ein Ordner mit `~` gilt auch in `projekt_hinzufuegen`). `null` oder fehlend: der Treiber klont nicht |
| `adapterLuecken[]` | optional: die Schlüssel des Adapters, deren Wert noch wie in der Vorlage in `<…>` steht. Solange es welche gibt, startet der Treiber in diesem Projekt keine Mission (wartende tragen die Notiz `wartet auf den Adapter (noch auszufüllen: …)`); der Maschinenraum zeigt an der Projektkarte „Dein Schritt: Adapter ausfüllen (in einem eigenen Chat)“ |
| `ram`, `platte`, `obergrenze` | RAM-Messung und -Bremse, `freiGb` und Schwelle, `bremse.obergrenze` |
| `fragen[]` | die **offenen** `MenschFrage`n, vollständig (unten) |
| `ereignisse[]` | die letzten 30 Logbuch-Ereignisse `{zeit, epic, text}`: das Laufband |
| `prognose` | `{status, ab, bisher, treffer, geprueft, backlog, berechnet}`: `zu_wenig` unter `ab` Messungen, `ungenau` bei unter 60 % Treffern (ausgeblendet), sonst `ok`; `backlog` `{p50, p90}` in Sekunden ab `berechnet`, ohne Wartezeit auf den Menschen. Fehlt bei einem älteren Treiber |
| `entscheidungen[]` | `{epic, nr, frage, antwort, herkunft, grund, einflussreich, zeit, widerrufen, von}`: die Entscheidungen des Admirals und (#52) die Antworten des Menschen, `von` `mensch`, `admiral` oder `lauf` (der Admiral folgte der Empfehlung des Laufs). Der Treiber schickt **alle Entscheidungen jeder nicht angedockten Mission** und dazu die letzten 100, zusammen höchstens die neuesten 500 (Grenze der Brücke); Texte kürzt er auf 4000 Zeichen (`herkunft` 500), damit nie der ganze Bericht abgelehnt wird. Eine Antwort des Menschen wird beim Anwenden zur Entscheidung (`herkunft` `Mensch über die Brücke` oder `Mensch über die Flotte`, `einflussreich` `false`, `zeit` = Zeitpunkt der Antwort). Ein älterer Treiber ohne `von`: Die Brücke liest `mensch` aus einer `herkunft`, die mit „Mensch“ beginnt, sonst `admiral`; ein unbekanntes Wort ist kein `422`. „Erledigt heute“ zeigt die des Admirals von heute, die Detailansicht der Mission alle bis zum Andocken (unten) |
| `sitzungen[]` | optional (Schiffsliste, #41): die Sitzungen aller Konten des Treibers aus `claude agents --json` je Konto (nur lesend, höchstens einmal je Minute): `{konto, projekt, name, status, kind, seit}`. `konto` wie in `konten[]`, `projekt` **nur der letzte Ordnername** des Arbeitsverzeichnisses (nie der Pfad; ein Wert mit `/` oder `\` wird mit `422` abgelehnt), `status` etwa `busy`/`idle`, `kind` etwa `interactive`, `seit` ISO aus `startedAt`. Kein `cwd`, keine `pid`, keine Sitzungs-ID; die Brücke verwirft unbekannte Felder. Fehlt das Feld (älterer Treiber) oder ist es leer, bleibt die Liste ohne Sitzungen |
| `einstellungen[]` | optional (#58): die wirksamen Einstellungen des Treibers, die der Mensch auf der Brücke ändern kann (unten). Fehlt das Feld (älterer Treiber), zeigt die Brücke keine |
| `triage` | optional (#116, Frachtraum): `{gelesen, laeuft, tickets[], entscheidungen[], fragen[], schnittplan, abschluss}`, unten. Fehlt es (älterer Treiber), zeigt der Frachtraum das Projekt nicht |
| `version` | optional (#154): `{commit, datum, installiert, gestartet, neu, geprueft, einspielen}`, unten. Fehlt es (älterer Treiber), zeigt der Maschinenraum „meldet keinen Stand“ und bietet kein Einspielen |
| `freigegeben[]` | optional (#61): `{nr, titel}` der offenen Missionen der Forge mit `epic_label` und `ready_label` (an der Mission oder an einem Missionsziel, wie ohne `--epics`), die **nicht** im Einsatz sind. Der Treiber liest sie nur mit Brücke, höchstens alle 5 min; die Brücke bietet für sie „Aufnehmen“ an. Fehlt das Feld (älterer Treiber), gilt `[]` |

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
Triage-Lauf des Treibers läuft. Dazu optional (#148, Kurzinfo im Kopf des Projekts): `seit` (Start des
laufenden Laufs), `fortschritt` `{n, m}` (Notiz n von m, nur wenn der Treiber es kennt; sonst weglassen,
die Brücke zeigt dann keinen Zähler) und `beendet` `{zeit, epics, fragen, gescheitert?, fehler?}` (Ende des letzten Laufs, die
Missionen seines Schnittplans, die Fragen des Laufs; `gescheitert` ein Lauf, der abbrach, `fehler` dessen Grund
oder der Fehler eines ungültigen Schnittplans; der Treiber hält es nur im Speicher). Die Brücke baut die Links aus `url` des Projekts (`<url>/issues/<nr>`).
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
sonst: mindestens ein angehängtes Missionsziel bekam Warp frei; `fehler` ein gescheiterter Schritt des Laufs oder
(`Widerruf: …`) des Widerrufs; `widerrufen` der Einwand nach `schnitt-widerruf`. `notizen[]` (höchstens
200) die vom Plan geschlossenen, je `{nr, titel, art, grund, verweis, fundstelle, fehler}`, `art`
`zusammengefuehrt` (`verweis` = die Notiz, die bleibt), `ueberfluessig` (`fundstelle`) oder `verworfen`.

**Abschluss** (#147): `abschluss` (optional, `null` vor dem ersten Triage-Lauf; fehlt es, älterer Treiber,
zeigt der Frachtraum nichts) sagt, wie der letzte Triage-Lauf dieses Treibers endete, gespeichert im
Zustand: `{zeit, zustand, geprueft, sauber, abweichungen[], grund}`. `zustand` `beendet` (jede Notiz der
Eingabe in einem erlaubten Endzustand), `unvollstaendig` (die Abschlussprüfung nach dem Schreiben fand
Notizen ohne erlaubten Endzustand) oder `abgebrochen` (`grund`: `Treiber angehalten`, `Treiber mit Ctrl+C
beendet` oder `Neustart des Treibers`, wenn der Lauf beim Start noch als laufend galt). `abweichungen[]`
(höchstens 200) je `{nr, titel, zustand, grund}`: `zustand` was die Forge zeigt (`offen, needs-triage`,
`geschlossen`, …), `grund` welcher Endzustand fehlt. Die Endzustände: README von flotte, „Triage“. #170:
`abweichungen[]` nennt auch jedes andere offene Ticket mit `ready_label`, das an keiner offenen Mission hängt.

**Lernvorschläge** (#117): Ist die Einstellung `lernschleife` `an` (Tag O, braucht `lern_issue`), liest der Treiber dazu die Kommentare dieses
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
bei `klar` ist `nr` die angelegte Sternzeit-Notiz (#170: sie geht in den Schnittplan desselben Laufs), bei `ueberfluessig` das `lern_issue`, und `zeit` ist je
Eintrag eigen (Millisekunden), damit (`nr`, `zeit`) Schlüssel bleibt. Die Brücke verwirft
`lernvorschlag` wie jedes unbekannte Feld; der Treiber hält es selbst. Sie markiert im Frachtraum alle
Vorschläge eines `lern_issue` mit „Frage“, sobald einer eine offene Frage hat (`frage` hängt an `nr`).

In `GET /api/tafel` steht `frachtraum[]`, ein Eintrag je Projekt mit `triage`, die mit offenen Fragen
zuerst: `{forge, kurz, url, aktiv, veraltet, gelesen, laeuft, zahl, handlung, fragen[], entscheidungen[],
themen[]}`. `handlung` ist ein noch nicht quittierter Triage-Lauf; `kurzinfo` (#148) ist `null` oder
`{zustand, seit, …}`: `unterwegs` (Handlung angenommen, kein laufender Lauf gemeldet; `abgeholt`, `seit` =
Zeit der Handlung), `laeuft` (`laeuft` im Bericht; `seit` aus dem Bericht, sonst die Handlung;
`fortschritt` `{n, m}` oder `null`; `still`: der Treiber ist veraltet, die Anzeige warnt statt „bitte warten“) oder `beendet` (`beendet` im Bericht, höchstens 15 Minuten alt, 2 Minuten Uhrversatz erlaubt, kein
neuer Lauf; `seit` = Ende, `epics`, `fragen` = die jetzt offenen Fragen der Tafel, `gescheitert`, `fehler`; #147: endete derselbe Lauf `unvollstaendig` oder `abgebrochen` und ist nicht gescheitert, dazu `abschluss` `{zustand, unsauber, grund}`, die Anzeige sagt dann „unvollständig … N Notizen nicht sauber abgearbeitet“ bzw. „abgebrochen“ statt „beendet“, die Liste steht darunter), in dieser Rangfolge `laeuft`, `unterwegs`, `beendet`; jede Frage trägt dazu `id`, `issueUrl`,
`empfohlen` (die Buchstaben der Empfehlung, sonst die Option, deren Text der Empfehlung gleicht) und
`handlung` (die Antwort unterwegs), jede Entscheidung `id`, `issueUrl`, `widerrufbar` und `handlung`.
`schnittplan` (#148, sonst `null`) ist `{zeit, fehler, missionen[], notizen[]}` wie im Bericht; jede
Mission trägt dazu `id`, `forge`, `issueUrl`, `kinder[].issueUrl`, `zustand` (`widerrufen`, `fehler`,
`frei` oder `offen`, in dieser Rangfolge), `widerrufbar` (nicht widerrufen und neu oder mit Missionszielen) und
`handlung` (der Widerruf unterwegs), jede Notiz `issueUrl` und `verweisUrl`.
`abschluss` (#147, sonst `null`) wie im Bericht, jede Abweichung dazu mit `issueUrl`; der Frachtraum zeigt
`unvollstaendig` als „N Notizen nicht sauber abgearbeitet“ mit der Liste, `abgebrochen` mit dem Grund.
`themen[]` bündelt die Tickets nach Thema, `{thema, tickets[] {nr, titel, issueUrl, labels, themen, frage}}`:
Thema sind die Labels ohne `needs-triage`, `needs-info`, `ready-for-agent`, `status/*` und `epic`, sonst
„ohne Thema“; ein Ticket mit zwei Themen steht in beiden. Ein Thema mit offener Frage steht oben, „ohne
Thema“ unten, sonst nach Namen; darin Tickets mit Frage zuerst, dann nach Nummer.

**Einstellungen** (#58): je Einstellung `{name, titel, wert, herkunft, seit, standard, leer, min?, max?,
auswahl?, werte?, hinweis?}`, immer alle in dieser Reihenfolge (siebzehn; ein älterer Treiber meldet die
ersten zehn ohne `merge` oder elf bis sechzehn ohne die späteren). `herkunft` ist `start` (Startparameter oder ein
vom Standard abweichender Startwert), `bruecke` (zuletzt über die Brücke geändert) oder `standard`;
`seit` ist bei `bruecke` der Zeitpunkt der Änderung, sonst der Beginn des Einsatzes. `standard` ist
der Wert ohne Startparameter und Brücke. `leer: true` heißt, `wert` darf `null` sein (zurück auf
automatisch). Zahlen sind ganze Zahlen zwischen `min` und `max` (die Brücke übernimmt die Grenzen von
hier, statt sie selbst zu kennen); Konten stehen als Kurzname wie in `konten[]` (`Konto <n>`, sonst
Ordnername, nie ein Pfad), `auswahl` nennt die Konten, die es auf dem Rechner des Treibers gibt.
Eine Wahl unter Wörtern (#112, `merge`; #37, `meldung`; #193, `einsammeln`; Tag O, `lernschleife`) trägt `werte`, die Wörter, die der Treiber **jetzt** annimmt,
und `hinweis`, warum eines fehlt (sonst `null`); die Brücke lehnt ein anderes Wort mit `422` und dem
Hinweis ab.

| `name` | `titel` | Wert | Grenzen, Standard | Wirkung |
|---|---|---|---|---|
| `obergrenze` | Missionen gleichzeitig | Zahl oder `null` | 1–4, `null` = aus der Wochen-Hochrechnung (4, 2 oder 1); Startparameter `--obergrenze` | ersetzt die Hochrechnung wie `--obergrenze`; eine gesenkte Grenze startet nur weniger |
| `paketeJeEpic` | Pakete je Mission gleichzeitig | Zahl | 1–3, Standard 3 | steht im Startauftrag an `/mission` („höchstens N Pakete gleichzeitig“), eine Änderung als Nachricht beim nächsten Fortsetzen jeder laufenden Mission; `/mission` senkt sein Fenster ab dem nächsten frei werdenden Platz, laufende Pakete laufen zu Ende |
| `konten` | Konten der Läufe | Liste, mindestens eines | aus `auswahl`; Standard = `--konten` | neue Missionen nur noch auf diese Konten; eine Mission bleibt auf ihrem Konto, auch für Fortsetzung und Nacharbeit; ein entferntes Konto startet nur nichts Neues |
| `admiral` | Admiral-Konto | Konto oder `null` | aus `auswahl`; `null` = das Konto der Mission; Startparameter `--admiral` | die nächsten Admiral-Aufrufe |
| `verbrauchGelb` | Verbrauch Hauptenergie gelb über (%) | Zahl | 1–98, Standard 60, unter `verbrauchRot` | über dem Anteil im 5-Stunden-Fenster startet nichts Neues; die Hochrechnung behält ihre Schwellen (gelb ab 90 %, rot über 120 %) |
| `verbrauchRot` | Verbrauch Hauptenergie rot über (%) | Zahl | 2–99, Standard 85, über `verbrauchGelb` | darüber halten auch Fortsetzungen an |
| `leerfahren` | Bis 100 % leerfahren | Liste | aus `auswahl`, Standard `[]` | diese Konten bremsen weder Hochrechnung noch Gelb, rot erst bei 100 %; ein Wert älter als 30 min bleibt rot |
| `ramWarn` | RAM-Schwelle (%) | Zahl oder `null` | 50–84 (unter der Halte-Schwelle von `ram.ps1`, Standard 85), `null` = Adapter, sonst 75; Startparameter `--ram-warn` | Warnschwelle für `ram.ps1` und die Rückkehr 5 Punkte darunter |
| `platteMinGb` | Plattenminimum (GB) | Zahl | 1–1000, Standard 20; Startparameter `--platte-min-gb` | darunter startet nichts Neues |
| `leerlaufMin` | Leerlauf (Minuten bis Nachfassen/Abbruch) | Zahl | 5–480, Standard 60; Startparameter `--leerlauf-min` | gilt für jeden Zug, der danach beginnt; ein laufender Zug behält seine Grenze. `leerlaufS` folgt |
| `merge` | Andocken | `automatisch` oder `mensch` | `werte`; Standard = Adapterschlüssel `merge` (`nach_gate` → `automatisch`, sonst `mensch`) | wie das Projekt andockt, ab dem nächsten Takt: `automatisch` = Andock-Schlange und `merge.ps1` nach grüner Andockprüfung, `mensch` = wie `merge: mensch` (PR bereit, ein Mensch dockt an). Je Mission gilt die wirksame Stellung (Missions-Feld `merge`); ein PR, der nur wegen ihr wartet, kommt bei `automatisch` in die Schlange |
| `triageModell` | Modell der Triage | `opus`, `fable` oder `sonnet` | `werte`; Standard `opus` | das Modell des nächsten Triage-Laufs (mit Schnittplan); ein laufender behält seines |
| `admiralModell` | Modell des Admirals | `opus`, `fable` oder `sonnet` | `werte`; Standard `fable`; Startparameter `--admiral-modell` | das Modell des nächsten Frageblocks des Admirals |
| `triageLesenMax` | Dateizugriffe der Triage je Aufruf | Zahl | 0–100, Standard 15 | #167: so viele Dateien darf das Modell eines Triage-Aufrufs selbst lesen (`--max-turns` danach); die üblichen Fakten legt das Programm vor. Ab dem nächsten Aufruf |
| `meldung` | Windows-Meldung bei „Braucht dich“ | `an` oder `aus` | `werte`; Standard `aus`; Startparameter `--meldung` | #37: bei `an` zeigt der Rechner des Treibers je neuer offener Frage und je neu blockierter oder abgebrochener Mission eine Windows-Meldung (Windows PowerShell, ohne Modul), mehrere aus demselben Takt als eine mit der Zahl. Inhalt nur Projektkürzel, Missionsnummer, Art (Frage/Blockade) und Titel (höchstens 60 Zeichen). Gemeldete Ereignisse stehen in `zustand.json` (`gemeldet`), auch bei `aus`: Nach einem Neustart oder beim Einschalten klingelt nichts Altes |
| `einsammeln` | Missionen automatisch einsammeln | `an` oder `aus` | `werte`; Standard `an` (ein Start ohne `--epics`); Startparameter `--dauerhaft` (`an`) und `--epics` (ohne `--dauerhaft`: `aus`), beide gelten als ausdrücklich gesetzt | #193: bei `an` sammelt der Treiber jede offene Mission mit `ready_label` an sich oder an einem Missionsziel ein wie ohne `--epics`; eingeschaltet über die Brücke im nächsten Takt (nicht erst nach dem Abstand des Einsammelns), und solange der Wert von der Brücke kommt, endet der Treiber nicht von selbst, sondern wartet wie mit `--dauerhaft`. Bei `aus` kommt keine neue Mission dazu; laufende, wartende, mit `--epics` genannte und aufgenommene laufen weiter, nichts hält an. Freigegebene, nicht eingesammelte stehen weiter in `freigegeben[]` |
| `lernschleife` | Lernschleife | `an` oder `aus` | `werte`; Standard `aus` (ab Werk, auch für ein neues Projekt); Startparameter `--lernschleife`; `an` fehlt in `werte`, solange der Adapter kein `lern_issue` nennt (`hinweis` sagt das), ein Startparameter `an` gilt dann nicht (Ereignis) | Tag O: bei `an` nach jedem Andocken die Lernschleife (`flotte lernen`, ein Kommentar an `lern_issue`), die Lern-Triage im Triage-Lauf und die offenen Lernvorschläge in `triage.tickets`; bei `aus` nichts davon, `lern_issue` wird nicht gelesen. Umschalten liest den Frachtraum sofort neu. Übergang: Ein Treiber, dessen `zustand.json` schon vor dem Schalter bestand und dessen Adapter `lern_issue` nennt, übernimmt einmalig `an` (`herkunft` `start`, Ereignis `Lernschleife bleibt an: der Adapter nennt lern_issue #<n> (…)`) und behält es über Neustarts |

**Die Brücke verschärft nur** (#112): `automatisch` gibt es nur, wenn der Adapter `merge: nach_gate`
sagt. Sonst fehlt es in `werte`, `hinweis` sagt warum, und der Treiber lehnt es ab (Ereignis
`Einstellung Andocken über die Brücke abgelehnt: der Adapter sagt merge: mensch, …`); ein
gespeichertes `automatisch` fällt nach einem Neustart mit einem Ereignis weg. Die harte Grenze bleibt
`merge.ps1`: Es liest `merge` vom Standardzweig und dockt nur bei `nach_gate` an.

Nicht einstellbar (bewusst): die Andock-Regel des Adapters (`merge` dort lockert die Brücke nie), Rechte,
Geheimnisse. Ein Update ist die Handlung `einspielen` (#154), keine Einstellung.

**Version** (#154): `commit` und `datum` des installierten Skill-Satzes (aus `stand.json`, das `install.ps1`
in jeden Skill-Ordner schreibt; ohne die Datei beide `null`), `installiert` wann, `gestartet` der Start des
Treibers (ISO), `neu` `null` oder `{commit, datum, titel}`: der neuere Commit auf `main` von `origin` der
Quelle (`git fetch` beim Start und höchstens alle 15 Minuten, `geprueft` wann zuletzt; `titel` ist der Titel
des Pull Requests aus der Commit-Nachricht: Andock-Commit von GitHub und Gitea, sonst der Betreff), `einspielen`
`null` oder `{seit, wartetAuf[]}`: der Treiber hält zum Einspielen an und wartet noch auf das Andocken dieser
Missionen. Commits sind 7–40 Hex-Zeichen. In `GET /api/tafel` trägt jedes Projekt `version` (sonst `null`) und
`einspielen` (die Handlung unterwegs, `{id, art, text, zeit, abgeholt, quittiert}` oder `null`); oben steht
`bruecke` `{commit, datum}` des Images (Build-Argumente `BRUECKE_COMMIT`, `BRUECKE_DATUM`, sonst `null`).

Gespeichert sind Änderungen der Brücke im Zustand des Treibers (`zustand.json`, `einstellungen`);
sie gelten nach einem Neustart weiter. Ein Startparameter, der ausdrücklich gesetzt ist, gewinnt beim
Start: Der Treiber nimmt dessen Wert, vergisst den der Brücke und meldet das als Ereignis
(`Einstellung … : Startparameter --… gilt (…) statt … von der Brücke`). Ein gespeichertes Konto, das
es nicht mehr gibt, fällt mit einem Ereignis weg.

**Mission:** `nr`, `stufe`, `pr`, `notiz`, `geparkt`, `schritt`, `schrittZeit`, `titel`, `konto`,
dazu

| Feld | Bedeutung |
|---|---|
| `prozess` | ein `claude -p` arbeitet gerade für die Mission: das Lebenszeichen pulst |
| `grund`, `haltZeit`, `log[]` | bei `blockiert`/`abgebrochen`: der Grund, seit wann, die letzten 12 Ereignisse der Mission als Zeilen `HH:MM Text` |
| `aufgegebenAm` | der Mensch hat die Mission über die Brücke aufgegeben |
| `prognose` | nur bei `wartend`: `{p50, p90}` in Sekunden, sonst `null` |
| `prio` | die wirksame Priorität: `prioritaet` der Brücke, sonst das Label `prio/hoch` (Adapter `prio_label`) an der Mission oder einem Missionsziel; `notiz` sagt, warum sie trotzdem wartet |
| `imEinsatz` | optional (#61): die Mission gehört zum Einsatz dieses Treibers (`--epics`, eingesammelt oder aufgenommen). Eine Mission eines früheren Einsatzes kann im Zustand stehen, ohne gefahren zu werden: `false`. Fehlt es (älterer Treiber), gilt `true` |
| `pausiert` | optional (#61): ISO-Zeit, seit der der Mensch die Mission pausiert hat, sonst `null` |
| `prioritaet` | optional (#61): `hoch` oder `normal`, wie der Mensch sie auf der Brücke gesetzt hat; `null`: keine, es gilt das Label |
| `merge` | optional (#112): `{stellung, herkunft, grund}`, wie die Mission jetzt andockt. `stellung` `automatisch` oder `mensch`; `herkunft` `epic` (Schalter des Menschen auf der Brücke), `vorschlag` (Body der Mission oder Titel/Body eines Missionsziels nennt ein Merkmalswort eines Punkts von `BEIM_MENSCHEN`, `MERKMALE` in `flotte/src/treiber/admiral.ts`: dann `mensch`; gelesen beim Start, Nachsammeln und Aufnehmen, ein später geänderter Body wirkt erst beim nächsten Start) oder `projekt` (die Einstellung `merge`); `grund` der Grund des Vorschlags `<Punkt>: „<Fundwort>“ in #<nr>`, auch wenn der Schalter ihn überstimmt, sonst `null`. Ohne `nach_gate` im Adapter ist `stellung` immer `mensch`. Fehlt es (älterer Treiber), zeigt die Brücke keinen Schalter |
| `pakete[]` | `{name, nr, titel, stand, beginn, ende}` je Missionsziel-Ticket, in jeder Stufe, auch `wartend`; `stand` `fertig` (geschlossen oder schon in den Missions-Branch angedockt, `ende` dann die Zeit dieses Andockens), `laeuft` (`status/in-arbeit`), `geparkt` (wartet auf eine Antwort), `zurueckgelassen` (`status/haengt`), `blockiert` (`status/blockiert`), `offen`. Im spec-Modus (ohne Missionsziel-Tickets, #151) die Pakete des Laufs: je Paket `<spec>-p<k>`, das ein `Agent`-Aufruf des Laufs nennt (`Implementer #45-p2 …`) oder dessen Branch `agent/<spec>-p<k>-…` in den Missions-Branch angedockt ist, mit `name` `P<k>`, `nr` `null`, `titel` = der Rest der `description` hinter dem Paket; `stand` `fertig` (angedockt, `ende` die Zeit des Andockens), `geparkt` (in `geparkt` als `P<k>` oder `<spec>-p<k>`), sonst `laeuft`; `beginn` der erste Aufruf. Ohne einen solchen Aufruf leer; ein geschnittenes, noch nicht gestartetes Paket fehlt deshalb (#172). Dazu optional die Detailfelder (unten) |
| `neustarts` | optional (Detailansicht, #51): wie oft der Treiber für die Mission nach dem ersten Start einen Prozess gestartet oder fortgesetzt hat (jede Fortsetzung nach einer Antwort, jeder Neustart nach einem Fehlstart). Zählt über ein Neu-Einreihen durch den Menschen weiter (seit dem ersten Start, wie `runde`). Fehlt bei einem älteren Treiber und bei einer Mission ohne Start |
| `plaetze` | optional (#51): `{belegt, von?}`, nur bei `laeuft`/`nacharbeit`/`frage` und wenn der Treiber Agent-Aufrufe des Laufs sah. `belegt` = Pakete in Ingenieur, Erster Offizier oder Nachbesserung (Andocken belegt keinen Platz; 0, wenn gerade kein Prozess läuft), `von` = `window` des Projektadapters (Standard nach `mission/references/adapter.md`: 3 mit `test_isolation_env` oder `isolation: none-needed`, sonst 1; höchstens 3), fehlt, wenn unbekannt |
| `gateLauf` | optional (#151), nur solange eine Andockprüfung läuft: `{n, seit}`. Die des Treibers (`gateSeit` gesetzt): `n` = seine wievielte Andockprüfung für diese Mission. Sonst bei `laeuft`/`nacharbeit`/`frage` mit Prozess die des Laufs: ein `Bash`- oder `PowerShell`-Aufruf, dessen Befehl `gate_command` des Adapters enthält (wie der Nachweis der Andockprüfung), noch ohne Rückkehr; `n` = der wievielte solche Aufruf, `seit` = sein Start (ISO, `null`, wenn unbekannt). Ein Befehl im Hintergrund (`Command running in background …`) läuft bis zu seiner `task_notification`; startet der Treiber den Prozess neu oder setzt ihn fort, gilt eine offene Andockprüfung des Laufs als beendet. Nicht gezählt wird eine, die ein Subagent aufruft, und ein Aufruf, der aus den gemerkten Aufrufen (höchstens 600 je Mission) herausgefallen ist: `n` ist dann zu klein |
| `andockpruefung` | die letzte Andockprüfung, die der Treiber für die Mission fuhr, sonst `null`: `zeit` (Ende, ISO), `epic`, `pr`, `dauerS` (gemessen vom Treiber), `gruen` (Block grün und Exit 0), `kontexte[]` aus dem Andockblock je `{name, ergebnis, dauerS, cache}`. `ergebnis` `gruen`, `rot` oder das Wort des Blocks klein (`übersprungen`); `dauerS` aus `m:ss`, `h:mm:ss` oder `<n> s` (Tausenderpunkt wie bei PowerShell `N0`), `null`, wenn die Zeile keine lesbare Dauer hat; `cache` `true`, wenn die Zeile auf `gate_cached` des Adapters passt, `null` ohne den Schlüssel. Die Brücke rechnet je Messung `ausCache` von `mitCache` (gelaufene Kontexte, grün oder rot, mit Cache-Angabe; beide `null` ohne Angabe) und zeigt sie in der Detailansicht der Karte. Fehlt es (älterer Treiber), fehlt der Abschnitt. Zu lange Werte kürzt die Brücke (`name` 100, `ergebnis` 40, `kontexte` 40, bei `andockpruefungen[]` die neuesten 50); eine Messung, die dann noch nicht passt, lässt sie weg, statt den Bericht abzulehnen |
| `nach[]` | optional (Sternenkarte, #43): die Nummern der Missionen dieses Repositorys, nach denen sie kommt (Kopfzeile `> **Reihenfolge:**` und `## Blocked by` des Issues, wie die Belegung sie liest; nur Missionen des Treibers, nie die Mission selbst). Fehlt es (älterer Treiber), gilt `[]` |
| `lage` | optional, der Treiber setzt es immer: die eine Zeile der Karte unter *Unterwegs* und einer Blockade. `{etikett, satz, seit, deinSchritt, gate}`; `etikett` `arbeitet`, `prueft`, `wartet_auf_dich`, `wartet`, `gestoppt` oder `fertig`; `satz` (≤ 500 Zeichen) sagt fertig formuliert, was geschieht und warum; `seit` ISO oder `null`; `deinSchritt` `{text (≤ 300), ziel}` oder `null`, `ziel` `frage` (erste offene Frage der Mission in *Braucht dich*), `pr` (`prUrl`), `einreihen` (die Blockade mit „Neu einreihen“) oder `issue`; `gate` `{kontexte[] (≤ 40, je {name (≤ 100), stand: fertig\|laeuft}), von, seit}` oder `null`. Die Brücke zeichnet nur; `schritt` steht dann in der Detailansicht („Letzter Schritt“), die Kopfzeile zählt „wartet auf dich“ nach dem Etikett. Fehlt es (älterer Treiber), bleiben die Karten wie zuvor |

**Detailfelder je Paket (#51)**, alle optional, für Missionsziel-Tickets und spec-Pakete (#151, Paket `#<spec>-p<k>` in der `description`) und nur, wenn der
Treiber im Protokoll des Laufs (stream-json von `claude -p`, das er schon liest) einen `Agent`-Aufruf eines
`ingenieur-*` oder `erster-offizier-*` sah, dessen `description` die Paketnummer nennt
(`Implementer #588 …`, `Reviewer #588 …`, `mission/SKILL.md`, Phase 6). Die Lauftafel und der Lauf bleiben
unverändert. Der Treiber merkt sich die Aufrufe mit ihren Rückkehrzeiten im Zustand (`agenten`, nur wenn er mit Brücke läuft) und
nimmt als Zeit den `timestamp` der Zeile (Zeilen von `assistant` und `user` haben einen), sonst den Moment, in dem er sie las.
Ein Agent im Hintergrund (so startet `/mission` Ingenieur und Erster Offizier) beantwortet seinen Aufruf sofort
mit einem `tool_result`, das mit „Async agent launched“ beginnt: Das ist sein Start, keine Rückkehr. Sein
Ende ist die spätere Zeile `{"type":"system","subtype":"task_notification","tool_use_id":<Aufruf>,"status":…}`
mit `status` `completed`, `failed`, `killed` oder `stopped`; sie hat **keinen** `timestamp`, als Rückkehrzeit
gilt also der Moment, in dem der Treiber sie las (bei einem nach einem Neustart übernommenen Lauf, dessen
Rückkehr der Zustand noch nicht kannte, ist das die Zeit des Nachlesens). Eine zweite Meldung zum selben
Aufruf zählt nicht. Ein `tool_result` ohne diesen Anfang ist das Ende eines Agenten im Vordergrund.

| Feld | Bedeutung |
|---|---|
| `phase` | `implementer` (erste Runde läuft), `review` (Erster Offizier läuft), `nachbesserung` (Ingenieur ab Runde 2 nach einem Review), `merge` (Erster Offizier zurück, noch nicht im Missions-Branch: Host prüft und dockt an), `abgebrochen` (Erster Offizier endete mit `failed`, `killed` oder `stopped`, ohne Urteil: nichts anzudocken, belegt keinen Platz). Fehlt, sobald das Paket angedockt ist und solange die Mission nicht arbeitet (`pr`, Schlange) |
| `runde` | Zahl der Ingenieur-Runden des Pakets: der erste Aufruf und jeder erste nach einem Review (ein erneuter Aufruf ohne Review dazwischen, etwa nach einem Neustart des Laufs, bleibt dieselbe Runde) |
| `stufe`, `stufeStart` | Klasse des letzten Ingenieur-Aufrufs (`mechanisch`, `standard`, `urteil`, `urteil-hoch`) und die des ersten, nur wenn sie abweicht |
| `eskaliert` | die Stufe der letzten Runde liegt über der der vorigen (Standard → Urteil → Urteil hoch) |
| `erstAufruf`, `phaseSeit`, `lebenszeichen` | ISO: erster Aufruf (Dauer gesamt), Beginn der Phase, letzter Protokolleintrag zum Paket (Aufruf, Rückkehr oder Zeile eines Unteragenten) |

Die Brücke gibt sie in `GET /api/tafel` an `pakete[]` weiter (Brücke und Sternenkarte) und rechnet dort
`lang` dazu: `true`, wenn das Paket `laeuft` und seit `beginn` länger als das 1,5-Fache des Medians der
Dauern (`beginn` bis `ende`) der fertigen Pakete **aller Missionen des Projekts** läuft, ab drei fertigen,
sonst `false`. Sie rechnet es selbst, weil sie jede Mission des Projekts und ihre eigene Uhr kennt und es
so auch für Berichte älterer Treiber gilt. Ungültige Werte (`phase`, `stufe`, `runde` unter 1) lehnt die
Brücke mit `422` ab. Fehlt ein Feld, lässt die Seite es weg und das Layout bleibt wie vorher.

An die Detailansicht einer Mission (aufgeklappte Paketliste auf der Brücke, `abschnitte(x)` in `app.js`)
kommt ein weiterer Abschnitt als weiterer Eintrag dieser Liste unter die Paketliste.

**Entscheidungen bis zum Andocken** (#52): In `GET /api/tafel` trägt jede Karte eines nicht angedockten
Missionen (Lauf, Schlange, Bereit, Blockade) `entscheidungen[]`, neueste zuerst: jede Antwort des
Menschen und jede Entscheidung von Admiral oder Lauf mit `einflussreich`, von jedem Tag. Der Rest
bleibt im Flottenlogbuch und an den Issues. Felder: `{id, forge, epic, nr, frage, antwort, herkunft,
grund, einflussreich, zeit, seit, widerrufen, von, widerrufbar, handlung}`; `seit` ist die `zeit` des
Berichts (der Schlüssel für den Widerruf), `widerrufbar` `false` nach einem Widerruf, `handlung` ein
noch nicht quittierter Widerruf. Eine angedockte Mission trägt keine. Die Seite zeigt sie in der
aufgeklappten Detailansicht mit Herkunft (Mensch, Admiral, Lauf), Zeit und „› Zurücknehmen“ (nur mit
PIN); die Leiste nennt „N Entscheidungen“ und erscheint auch bei einer Mission ohne Pakete. Die Karte
einer blockierten Mission hat keine Detailansicht: Dort bleibt für die Entscheidungen des Admirals von
heute „Erledigt heute“.

**Fertig-Erkennung im Missions-Branch:** Ein Betreff gilt für das Missionsziel `<nr>` bei `Merge … agent/<nr>-…`,
`… (#<nr>)` und `Merge #<nr>: …`; eine Nummer sonst irgendwo im Text („Refs #409“, `#4090`) zählt nicht.

Der Treiber liest die Missionsziele jeder Mission, auch einer wartenden, höchstens alle 5 min je Mission
(`gh issue view`) und sofort, wenn sich Stufe oder Geparkte ändern. Bei jedem solchen Lesen schaut
er einmal je Mission in den Missions-Branch (`git log --first-parent` auf `epic/<nr>-…`, lokal vor
`origin/…`, ohne die Commits anderer Branches): Ein Missionsziel mit `Merge … agent/<kind>-…`,
`(#<kind>)` oder `Merge #<kind>: …` im Betreff ist fertig, auch wenn sein Issue bis zum Andocken des Missions-PRs offen bleibt. Die Brücke macht daraus Links
`<url>/issues/<nr>`: unter *Unterwegs* je Karte, in *Bereit* je Mission „N Tickets“ mit derselben
Leiste; bei leerer Liste fehlt die Leiste.

**Ebenen der Brücke:** offene Fragen und `blockiert`/`abgebrochen` → *Braucht dich*; `laeuft`,
`nacharbeit`, `frage` → *Unterwegs* als Lauf; `pr` → *Unterwegs* in der Schlange; `wartend` → die
Zeile *Bereit*, prio zuerst; `gemergt`, `fertig` (`gemergtAm` optional, sonst der Zeitpunkt, an dem
die Brücke die Stufe zuerst sah), aufgegebene Missionen, Admiral-Entscheidungen, deine Antworten und
Handlungen von heute → *Erledigt heute* (eine Antwort des Menschen dort aus der Brücke selbst, nicht als
Entscheidung des Berichts).

**Frage:** `epic`, `nr`, `seit` sind zusammen der Schlüssel (Nummern beginnen in jedem
Fragenblock bei 1). Dazu `frage`, `lage`, `optionen[] {buchstabe, text}` (Großbuchstaben ab `A`,
beliebig viele; die Folge steht nach dem ersten Komma), `mehrfach` (`— Auswahl: mehrere` im Block),
`empfehlung`, `grund` (warum sie beim Menschen liegt), `herkunft`, `marke` (kurz, etwa „nach außen
sichtbar“), `umkehrbar` (`true`: bis zum Andocken umkehrbar, `false`: bleibt, `null`: unbekannt),
`betrifft`, `geparkt[]` (die Pakete, die warten), `wartet`, `ganzerLauf` und `roh`, der Wortlaut
des Laufs. `marke` und `umkehrbar` setzt der Admiral (freiwillige Felder seines Schemas).

Sortiert wird nach den Kosten des Wartens: Was den ganzen Lauf oder die ganze Mission hält, steht
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
`{id, epic, art, nr, seit, text, zeit, herkunft, geraet}`. `geraet` (#46) ist der Name des gekoppelten
Geräts, das die Handlung schickte (`null` bei älteren); der Treiber hängt ihn mit `zeit` an jede Zeile, die die
Handlung ins Flottenlogbuch schreibt, und schreibt eine eigene, wenn sie keine schreibt. Unter Not-Aus liefern
alle vier Abholwege (Antworten, Handlungen, Werft, Chat) eine leere Liste, ohne etwas als abgeholt zu markieren.

| `art` | wann die Brücke sie annimmt | was der Treiber tut |
|---|---|---|
| `einreihen` | Mission `blockiert` oder `abgebrochen`, nicht aufgegeben | Zähler auf null; mit Sitzung zurück auf `laeuft` mit einer Fortsetzung, die den Grund der Blockade und die noch unbeantworteten Fragen des Laufs als offen nennt, sonst `wartend` |
| `aufgeben` | wie `einreihen` | Stufe `abgebrochen`, `aufgegebenAm`; Branch, PR und Issue bleiben |
| `widerruf` | `nr`, `seit` (= `zeit` der Entscheidung) und `text`; Mission nicht `gemergt`/`fertig`, noch kein Widerruf; eine Entscheidung des Admirals oder (#52) eine Antwort des Menschen | Kommentar am Issue, bei einflussreichen Entscheidungen auch ins Protokoll; der Lauf bekommt `widerruf: <Frage> → <Text>` im nächsten Zug, eine Mission in `pr` geht dafür zurück auf `laeuft`. Nach dem Andocken nur der Kommentar und ein Ereignis, nichts an den Lauf; ein zweiter Widerruf derselben Entscheidung bleibt ein Ereignis |
| `einstellen` | `epic` `0`, `text` = `{"name", "wert"}` als JSON (unten), Gerät mit Recht Handeln | prüft die Grenzen, setzt den Wert ab diesem Takt, speichert ihn im Zustand, Ereignis und Flottenlogbuch; ein ungültiger Wert wird ein Ereignis |
| `aufnehmen` | `epic` steht in `freigegeben[]` des Berichts, Gerät mit Recht Handeln | prüft an der Forge: offen, `epic_label`, `ready_label` an der Mission oder einem Missionsziel, noch nicht im Einsatz; nimmt sie in den Einsatz (Belegung wie jede Mission), merkt sie im Zustand (`aufgenommen`, gilt nach einem Neustart bis zum Andocken), Ereignis und Flottenlogbuch |
| `pausieren` | Mission im Bericht, `imEinsatz`, nicht `gemergt`/`fertig`/aufgegeben, nicht `pausiert`, Gerät mit Recht Handeln | `pausiert` = jetzt, auch als Feld `pausiert` in der Haltedatei der Mission: eine wartende Mission startet nicht; ein laufender Lauf erfährt die Pause vor seinem nächsten Paketstart über die RAM-Messung (`ram.ps1` meldet `hold` mit `reason: "paused"`), startet kein weiteres Paket, laufende Pakete laufen zu Ende, der Zug endet mit `FLOTTE-FRAGE ram`; der nächste Zug (Antwort des Admirals, Fortsetzung, Nacharbeit) bleibt zurückgehalten; Andock-Schlange und Andocken laufen weiter. Ereignis und Flottenlogbuch |
| `fortsetzen` | Mission `pausiert`, sonst wie `pausieren` | hebt die Pause auf (auch in der Haltedatei); der zurückgehaltene Zug geht unverändert an den Lauf, eine wartende Mission startet nach der Belegung. Ereignis und Flottenlogbuch |
| `prioritaet` | `text` `hoch` oder `normal` (sonst `422`), sonst wie `pausieren` ohne die Pause | setzt die Priorität der Mission; sie gilt vor dem Label `prio/hoch`: hoch geht unter den startbereiten bei freiem Platz zuerst, Reihenfolge-Kanten und Kollisionen bleiben vorrangig. Ereignis und Flottenlogbuch |
| `merge` | #112: `text` `automatisch`, `mensch` oder `null` (zurück zum Vorschlag), sonst `422`; die Mission trägt `merge` im Bericht (sonst `409`); `automatisch` nur, wenn `werte` der Einstellung `merge` es nennt (sonst `409` mit dem Hinweis); sonst wie `prioritaet` | setzt den Schalter der Mission (`merge` im Zustand, gilt nach einem Neustart bis zum Andocken); er überstimmt Vorschlag und Projekt. Ein PR, der nur wegen seiner Stellung auf einen Menschen wartet, kommt bei `automatisch` in die Andock-Schlange; eine Mission in der Schlange, die auf `mensch` geht, wird als Kopf nicht angedockt (PR bereit); ein laufendes Andocken läuft zu Ende. `automatisch` unter `merge: mensch` lehnt auch der Treiber ab. Ereignis und Flottenlogbuch |
| `triage` | #116: `epic` `0`, `nr`, `seit`, Gerät mit Recht Handeln; `forge` ein Projekt mit `triage` im Bericht (`404` unbekannt, `409` ohne `triage` oder bei `laeuft`) oder `alle`: eine Handlung je Projekt mit `triage` ohne laufenden Lauf (Antwort `{ok, id, ids}`). `text`: `null` für alle offenen Notizen, sonst `{"nummern": [61, 63]}` (1–500 ganze Zahlen über 0, gespeichert sortiert und je einmal); bei `alle` `{"nummern": {"owner/name": [...]}}`: ein nicht genanntes Projekt nimmt alle, eines mit `[]` bekommt keine Handlung; eine andere Form `422` | führt `flotte triage` (`triagiere`) für sein Projekt nebenher aus, auf dem Admiral-Konto (rot: ein anderes mit Luft), einen zur Zeit; mit `nummern` nur über diese Notizen (Lern-Triage nur, wenn `lern_issue` gewählt ist; die Abschlussprüfung zählt nur die gewählten), die übrigen bleiben unberührt. Eine Nummer, die beim Start keine offene Notiz ist, wird übergangen: `Triage-Lauf gestartet über N von M Notizen, Mensch über die Brücke[; übergangen, keine offene Notiz: #a, …]`; bleibt keine übrig, `Triage-Lauf über die Brücke abgelehnt: keine der gewählten Notizen ist offen (#a, …)`. Ohne Wahl Ereignis und Flottenlogbuch `Triage-Lauf gestartet, Mensch über die Brücke` und `Triage-Lauf beendet: N Warp frei[ (A an Missionen angehängt)][, P Missionen angelegt], M geschlossen[, Ü überflüssig], K Fragen an den Menschen[, L ohne Ergebnis]` (Ü: überflüssige Lernvorschläge, #117; sie schließen nichts; A und P aus dem Schnittplan, #147). Findet die Abschlussprüfung Notizen ohne erlaubten Endzustand (#147), heißt die Zeile `Triage-Lauf unvollständig: …` mit `; X Notizen nicht sauber abgearbeitet: #a (<grund>), …`; ein angehaltener Lauf `Triage-Lauf abgebrochen: Treiber angehalten; bis dahin …` (die Zahlen wie oben; seine Entscheidungen und sein Schnittplan bis dahin stehen im Bericht), bei Ctrl+C oder einem beim Neustart noch laufenden Lauf `Triage-Lauf abgebrochen: <grund>` |
| `triage-antwort` | #116: `epic` = Ticket, `nr` und `seit` die Frage aus `triage.fragen` (sonst `404`), `text` das JSON `{"option", "text"}`: ein Buchstabe der Frage (sonst `422`) und/oder eigener Text, mindestens eines; Gerät mit Recht Handeln | ein Kommentar ans Ticket ohne Triage-Marken (der Treiber entfernt sie auch aus dem Freitext): `**Antwort des Menschen (Mensch über die Brücke)** — Sternzeit-Notiz #<nr>, Frage <n>: <Frage>`, `Antwort: <B) Optionstext — eigener Text>`, `Herkunft: Mensch über die Brücke`. Der `gh`-Account des Treibers zählt als berechtigt, der nächste Triage-Lauf nimmt die Antwort als Tatsache. #117: Bei einem Lernvorschlag steht der Kommentar am `lern_issue`, die erste Zeile endet mit `— Lernvorschlag <id>/<n>, Frage <n>`, die Frage folgt als `Frage: <Frage>` in der zweiten (als Antwort zählt die Kennung nur in der ersten Zeile). Sonst ändert sich nichts. Ereignis |
| `schnitt-widerruf` | #148: `epic` = Mission aus `triage.schnittplan.missionen` (sonst `404`), `text` der Einwand (`422` ohne), noch nicht widerrufen und neu oder mit Missionszielen (sonst `409`); Gerät mit Recht Handeln | zuerst der Kommentar an der Mission `**Widerruf des Menschen (Mensch über die Brücke)** — Mission #<nr> „<Titel>“ aus dem Schnittplan zurückgenommen` (bestehende Mission: `— Missionsziele aus dem Schnittplan zurückgenommen: #a, #b`) mit `Einwand`, was danach geschieht, und `Herkunft`; scheitert er, ändert sich nichts. Neue Mission: `ready_label` ab; im Einsatz, noch nie gestartet (`wartend`, kein Zug, kein Auftrag): aus dem Einsatz ausgetragen (auch aus `aufgenommen` und dem Zustand); schon gestartet: pausiert (wie `pausieren`) und Andocken auf `mensch` (wie `merge`, #112), ihr PR wird nur von einem Menschen angedockt. Je Missionsziel (ohne die schon einzeln widerrufenen): Kommentar `… — Sternzeit-Notiz #<n> aus Mission #<nr> „<Titel>“ gelöst` mit `Einwand`, `Nicht wieder in Mission #<nr>: …` und `Herkunft`, ohne Triage-Marke; dann Sub-Issue gelöst (`DELETE /repos/{o}/{r}/issues/{mission}/sub_issue`), Zeile `- [ ] #<n>` aus der Liste der Mission, `ready_label` ab, `needs-triage` an; ihre Entscheidung `klar` gilt als widerrufen. Zuletzt eine neue Mission `gh issue close --reason "not planned"`. Gescheiterte Schritte: `fehler` der Mission (`Widerruf: …`), Ereignis und Flottenlogbuch; nichts wird wiederholt |
| `einspielen` | #154: `epic` `0`, `nr`, `seit` `null`, Gerät mit Recht Handeln; `text` setzt die Brücke selbst auf `{"bruecke": <commit ihres Images oder null>}`; `forge` ein Projekt mit `version` im Bericht (`404` unbekannt, `409` ohne `version` oder wenn `version.einspielen` schon steht) oder `alle`: eine Handlung je solchem Projekt (Antwort `{ok, id, ids}`) | ohne `stand.json` ein Ereignis `Einspielen über die Brücke abgelehnt: …`. Sonst hält er an wie `flotte anhalten` (nichts Neues, ein offenes Andocken läuft zu Ende, `version.einspielen.wartetAuf` nennt es; Läufe arbeiten weiter), Ereignis und Flottenlogbuch `Einspielen und Neustart angefordert: …`. Danach in der Quelle: sauber und auf `main`, `git pull --ff-only origin main`, `install.ps1`, `docker compose up -d --build` in `flottenbruecke/` nur, wenn sich der Ordner seit `bruecke` geändert hat (mit `BRUECKE_COMMIT`/`BRUECKE_DATUM`), dann derselbe Aufruf neu. Der neue Treiber übernimmt die Läufe und schreibt `Neuer Stand eingespielt: <alt> → <neu> (<datum>), Brücke neu gebaut` (oder `unverändert`) bzw. `Einspielen gescheitert: <grund>` ins Logbuch |
| `konto_anlegen`, `konto_deaktivieren`, `konto_aktivieren`, `konto_anmelden` | #95: Gerät mit Recht Handeln; `konto_anlegen`: `epic` `0`, `text` ein Name (höchstens 60 Zeichen) oder `null`; die anderen: `epic` die Nummer eines Kontos aus `kontenListe[]` (sonst `404`), `text` `null`; ohne `kontenListe` im Bericht `409`. `deaktivieren` und `aktivieren` schließen sich je Konto aus | wie `flotte konten`: `anlegen` trägt das nächste Konto in `konten.json` ein und legt nur seinen Ordner `~/.claude-arbeitspferd-<n>` an (nie einen vorhandenen); `deaktivieren` löscht nichts, das Konto bekommt keine neue Mission, laufende laufen dort zu Ende; `anmelden` öffnet am Rechner ein Terminal mit `claude` auf dem Konto, die Anmeldung (`/login`) macht der Mensch dort. Kein Login-Link, Code oder Token geht durch die Brücke. Ereignis und Flottenlogbuch; was nicht passt, wird ein Ereignis `Konto-Handlung <art> über die Brücke abgelehnt: <Grund>` |
| `forge_verknuepfen` | #125: `epic` `0`, `nr`, `seit`, `text` `null`, Gerät mit Recht Handeln; der Bericht trägt `forgeStatus` (sonst `409`) | öffnet am Rechner ein Terminal: bei GitHub `gh auth login --hostname github.com`, bei Gitea eine verdeckte Abfrage von Benutzer und Token, die in den Git-Credential-Speicher des Rechners geht. Kein Token durch die Brücke. Danach prüft der Treiber die Forge eine halbe Stunde lang jede Minute. Ereignis und Flottenlogbuch |
| `projekt_hinzufuegen` | #126: `epic` `0`, `nr`, `seit` `null`, Gerät mit Recht Handeln; `text` `{"ordner": <absoluter Pfad am Rechner, 1–260 Zeichen; umschließende Anführungszeichen schneidet die Brücke ab>, "url": <Link zum Repository, höchstens 300 Zeichen>, "autostart": <bool, Standard false>}`, mindestens `ordner` oder `url` (`422` sonst). `url` nur `https://<host>/<owner>/<name>[.git]` auf github.com oder einer Gitea-Herkunft aus `klonAngebot.gitea`: kein `http://`, `file://`, `ssh://` oder `git@…`, keine Benutzerangaben, keine Parameter, keine Adresse dieses Rechners oder des eigenen Netzes (`422` mit dem Grund); ohne `klonAngebot` im Bericht `409`; `forge` ein **bekanntes** Projekt, dessen Treiber `projektHandlungen` meldet (`404` unbekannt, `409` älterer Treiber): Für den neuen Ordner läuft noch kein Treiber, ein laufender eines anderen Projekts holt es ab | wie `flotte projekt hinzufuegen <ordner> [--autostart] --bruecke <seine Brücke>`: Der Ordner muss da und die Wurzel eines Git-Repositorys sein, sonst Ereignis `Projekt hinzufügen über die Brücke abgelehnt: <grund>` und nichts geschrieben. Geschrieben werden nur der Adapter `.claude/epic.md` aus der Vorlage (`mission/references/adapter.md`, „Vorlage“), wenn er fehlt (nie über einen vorhandenen; ein `.claude/prd.md` gilt als vorhanden, gemeldet als „unter altem Namen, umbenennen“), und das Startskript `~/.claude/flotte/start/<name>.ps1` (nie über ein vorhandenes; zeigt ein vorhandenes per `Set-Location` auf einen anderen Ordner, wird abgelehnt, bevor etwas geschrieben ist); mit `autostart` die geplante Aufgabe `Flotte <name>` beim Anmelden, nur wenn sie fehlt; scheitert sie, bleiben die Dateien und das Ereignis sagt `Autostart fehlgeschlagen: <grund>`. Die Forge wird nur gelesen. Ereignis `Projekt <name>: Adapter angelegt, noch auszufüllen: <schlüssel>; Startskript <name>.ps1 angelegt[; Autostart angelegt]; Forge: …`; ins Flottenlogbuch nur Ordnername und was angelegt wurde, nie ein Pfad und nichts zur Forge. Mit `url` prüft der Treiber den Link noch einmal; fehlt `ordner`, nimmt er `<klonAngebot.eltern>/<name>`. Fehlt der Ordner, klont er im Hintergrund mit Git- und gh-Anmeldung des Rechners (nur https, kein Anmeldefenster; zuerst in einen versteckten Nachbarordner, am Ende umbenannt, ein abgebrochener Klon wird wieder entfernt, sonst nichts) und meldet den Start als Ereignis; gibt es den Ordner, klont er nicht und lehnt ab, wenn `origin` nicht auf dasselbe Repository zeigt. Der neue Adapter bekommt `forge` und `api` aus dem Link. Danach prüft er Schreibrecht und Issues, legt fehlende Labels der Flotte an (`ready_label`, `ready-for-human`, `skip_labels`, `epic_label`, `status/*`; ohne Schreibrecht nur gemeldet) und nennt, was zum Einrichten gefunden wurde (`package.json`, `pyproject.toml`, `.env.example` …) — ausgeführt wird davon nichts. Ereignis `Projekt <name>: geklont aus <owner/name>; …; Schreibrecht da; Labels angelegt: …; Einrichten: gefunden …; nichts davon ausgeführt` |
| `projekt_entfernen` | #126: `epic` `0`, `nr`, `seit`, `text` `null`, Gerät mit Recht Handeln; `forge` ein bekanntes Projekt, dessen Treiber `projektHandlungen` meldet (`404`/`409`), noch nicht entfernt (`409`) | Die Brücke nimmt das Projekt sofort aus `projekte[]` und merkt sich `version.gestartet` des Treibers; nichts wird gelöscht (keine Zeile der Datenbank, kein Startskript, kein Adapter, kein Zustand). Der Treiber hält an wie `flotte anhalten` (nichts Neues, ein offenes Andocken läuft zu Ende, Läufe arbeiten weiter), Ereignis und Flottenlogbuch `Projekt wird entfernt: …`. Meldet sich später ein Treiber dieses Projekts mit anderem `gestartet` (ein neuer Start), steht es wieder in der Liste; ein `projekt_entfernen`, das der alte nie abgeholt hat, quittiert die Brücke dann selbst. Eine geplante Aufgabe „Flotte <name>“ (Autostart) bleibt und startet den Treiber bei jeder Anmeldung wieder, damit kehrt das Projekt zurück; abschalten in der Aufgabenplanung (Aufgabe „Flotte <name>“ deaktivieren oder löschen). |
| `triage-widerruf` | #116: `epic` = Ticket, `seit` = `zeit` der Entscheidung aus `triage.entscheidungen` (sonst `404`), `text` der Einwand (`422` ohne), noch nicht widerrufen (`409`); Gerät mit Recht Handeln | zuerst der Kommentar `**Widerruf des Menschen (Mensch über die Brücke)** — Triage-Entscheidung „Warp frei“ (oder „geschlossen“) zu Sternzeit-Notiz #<nr> zurückgenommen` mit `Einwand`, `Vorher` und `Herkunft`; scheitert er, ändert sich nichts. Dann `klar`: hing die Notiz an einer Mission (#148; der Kommentar nennt dann das Lösen und `Nicht wieder in Mission #<nr>`), erst gelöst wie bei `schnitt-widerruf` (scheitert das, bleiben die Labels), dann `ready_label` ab, `needs-triage` an; `ueberfluessig`: wieder geöffnet. #117: Bei einem Lernvorschlag ist `klar` dasselbe an seiner Sternzeit-Notiz (#170; `epic` = deren Nummer); `ueberfluessig` ist nur der Kommentar `… Triage-Entscheidung „überflüssig“ zu Lernvorschlag <id>/<n> zurückgenommen` am `lern_issue`, der nächste Triage-Lauf entscheidet den Vorschlag neu. Ereignis und Flottenlogbuch |

`einreihen` und `aufgeben` schließen sich aus: Bis zum Abholen gilt die letzte. Danach antwortet die
Brücke `409`. Endet der Einsatz, weil alles blockiert ist, wirkt die Handlung beim nächsten Start.
Ebenso schließen sich `pausieren` und `fortsetzen` je Mission aus; von `prioritaet`, `merge` und
`aufnehmen` gilt je Mission die letzte bis zum Abholen; ebenso (#116) je Projekt von `triage`, je Frage von
`triage-antwort`, je Entscheidung von `triage-widerruf` und (#148) je Mission von `schnitt-widerruf`. Was beim Treiber nicht passt (ein Lauf läuft
schon, kein Konto mit Luft, Frage nicht mehr offen, unbekannte Option, Entscheidung unbekannt oder schon
widerrufen, Kommentar gescheitert), ändert nichts und wird ein Ereignis `Triage-Lauf …`, `Triage-Antwort …`,
`Widerruf einer Triage-Entscheidung über die Brücke abgelehnt: <Grund>` oder `Widerruf einer Mission des Schnittplans über die Brücke abgelehnt: <Grund>`; quittiert wird beides.

**Missionen steuern** (#61): `aufnehmen`, `pausieren`, `fortsetzen`, `prioritaet` und (#112) `merge`
betreffen eine Mission (`epic` ≥ 1, sonst `422`), `nr` und `seit` sind `null`, `text` ist nur bei
`prioritaet` (`hoch` oder `normal`) und `merge` (`automatisch`, `mensch` oder `null`) gesetzt. Angenommen werden sie wie `widerruf` nur von einem Gerät mit Recht Handeln; `404`, wenn die Brücke die
Mission nicht kennt (`aufnehmen`: `409`, wenn sie nicht in `freigegeben[]` steht), `409`, wenn sie nicht
passt (Spalte oben). Der Treiber prüft selbst noch einmal; was nicht passt (Mission unbekannt oder nicht
im Einsatz, nicht freigegeben, schon pausiert, nicht pausiert, unbekannte Priorität), ändert nichts und
wird ein Ereignis `<Handlung> über die Brücke abgelehnt: <Grund>` (`Aufnehmen`, `Pausieren`,
`Fortsetzen`, `Priorität`, `Andocken`); quittiert wird beides. Wirkung ab dem Takt, in dem der Treiber sie abholt;
nichts Laufendes wird abgebrochen. `aufnehmen` umgeht weder `ready_label` noch die Andock-Regel noch
ein Tor. Ereignis und Kommentar im Flottenlogbuch:
`Mission #<nr> in den Einsatz aufgenommen, Mensch über die Brücke`,
`Mission #<nr> pausiert, <Lage>; Mensch über die Brücke`,
`Mission #<nr> fortgesetzt[, der zurückgehaltene Zug geht an den Lauf]; Mensch über die Brücke`, `Priorität von #<nr> von <alt> → auf <neu>, Mensch
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
trägt `freigegeben[]` `{nr, titel, issueUrl, handlung}` und (#193, Automatik je Projekt im Maschinenraum) `sammeln`
`{laufend, wartend, freigegeben}`: Missionen des Berichts im Einsatz (`imEinsatz`, fehlt: ja) in `laeuft`, `frage` oder `nacharbeit`, in `wartend`, und die
Länge von `freigegeben[]` (fehlende Felder zählen 0). Die Karten der Brücke tragen `pausiert` und
`prio` (die Schiffsliste zeigt beides).

**`einstellen`** (#58) gehört zum Projekt, nicht zu einer Mission: `epic` ist `0`, `nr` und `seit` sind
`null`, `text` ist das JSON `{"name": <name>, "wert": <wert>}` mit einem `name` aus `einstellungen[]`
des Berichts und einem Wert in dessen Form (Zahl, Kurzname, Liste von Kurznamen oder `null`, wo
`leer`). Angenommen wird sie wie `widerruf` nur von einem Gerät mit Recht Handeln (`POST /api/handlung`,
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
flache Sicht seiner **offenen** Missionen (ohne `gemergt`, `fertig` und die aufgegebenen), sortiert nach
Stufe (blockiert, Frage, läuft, PR, wartend), `prio` zuerst, Nummer: `{id, nr, titel, stufe, prio,
konto, issueUrl, pr, prUrl, warum, fragen, prognose, pakete[], nach[], folgen[]}`. `warum` ist bei
`blockiert` der ganze `grund`, sonst die `notiz`; `pakete[]` wie auf der Brücke samt `url`; `nach[]`
sind die Kanten `{nr, titel, stufe, offen, issueUrl}`, `offen` sagt, ob der Vorgänger selbst noch
offen ist (sonst erledigt oder dem Bericht unbekannt, `stufe` dann `null`); `folgen[]` die Nummern
der offenen Missionen, die nach dieser kommen. Das Projekt trägt wie bisher `prognose`. Alles stammt aus
dem Bericht, die Brücke fragt keine Forge.

## 5a. Verlauf der Läufe: `POST /api/verlauf`, `GET /api/verlauf` (Tag J)

Was eine Mission gerade tut, zum Mitlesen auf der Brücke. Der Treiber liest die Protokolle der Läufe
(`laeufe/<nr>-*.jsonl`, stream-json) fortlaufend und verdichtet sie; die Brücke liest keine Datei vom
Rechner. Der Bericht bleibt, wie er ist: der Verlauf geht eigens und nur, wenn er sich änderte.

**Treiber → Brücke:** `POST /api/verlauf` mit Token, Body (Form: `beispiel/verlauf.json`, dort eine
Liste mit einem Body): `{forge, epic, stand, eintraege: [...]}`. Antwort `{"ok": true, "eintraege": <n>}`,
`401` ohne passenden Token, `422` bei ungültigen Feldern, über den Fernweg `403`. Die Liste **ersetzt**
die vorige der Mission; eine Mission, deren Verlauf sieben Tage nicht kam, verschwindet.

| Feld | Bedeutung | Prüfung der Brücke |
|---|---|---|
| `id` | Kennung: Werkzeugaufruf, Textblock, `frage:<nr>:<seit>`, `ent:<nr>:<zeit>` | ≤ 200 Zeichen |
| `art` | `text` (was der Lauf sagt), `werkzeug`, `gruppe` (Subagent), `frage`, `entscheidung` | eine davon |
| `zeit`, `bis` | Beginn und Ende (ISO); ohne `bis` läuft es noch, die Seite zählt selbst | ≤ 40 Zeichen |
| `text` | Text des Laufs, Ziel des Werkzeugs (Datei relativ zum Worktree, Beschreibung des Befehls), Titel der Gruppe, Frage bzw. `Frage n → Antwort · Frage` | ≤ 2000 Zeichen |
| `gruppe` | `id` der Gruppe, zu der der Eintrag gehört | ≤ 200 |
| `wz` | Art in Klartext: `Lesen`, `Bearbeiten`, `Schreiben`, `Suchen`, `Tests`, `Befehl`, `Andockprüfung`, `Pull Request`, `Commit`, `Ticket`, `Git`, `Skill`, `Warten`, `Recherche`, `Nachricht`, `Anhalten`, `Bericht` | ≤ 40 |
| `roh` | der Befehl selbst, maskiert, nur als einklappbares Detail | ≤ 2000 |
| `stand` | `laeuft`, `fertig`, `fehler`, `abgebrochen`; bei `frage` heißt `laeuft` offen, `fertig` beantwortet | eine davon |
| `rolle`, `paket` | Gruppe: `Ingenieur`, `Erster Offizier`, `Prüfer`, `Kundschafter` oder `Subagent`; Paket `#480` bzw. `#45-p2` | ≤ 40 |
| `von` | Entscheidung: `Mensch`, `Admiral`, `Lauf` | ≤ 100 |

Höchstens 400 Einträge je Body; der Treiber schickt die letzten 300 und dazu die Köpfe der Gruppen,
deren Arbeit darin steht. **Nie eine Werkzeugausgabe.** Vor dem Senden maskiert der Treiber Geheimnisse
(`sk-…`, `ghp_…`, `github_pat_…`, `glpat-…`, `xox…-`, `AKIA…`, JWT, `Authorization`/`Bearer`,
Zugangsdaten in URLs, der Wert jedes Namens wie `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*_KEY`, `*-PIN`
in Zuweisung, Kopfzeile oder Option) zu `***` und kürzt lokale Pfade: unter einem Worktree der Mission
oder dem Repository relativ, sonst unter dem Benutzerordner `~`. Fragen und Entscheidungen der Mission
kommen aus seinem Zustand. Er schickt für Missionen, die laufen oder einen PR haben, und für beendete
bis zwei Stunden nach ihrem letzten Lauf, nach dem Bericht des Takts, mit 10 s Zeitgrenze; gemerkt wird
ein SHA-1 über die Einträge, ein Neustart liest die Protokolle neu (die neuesten bis 32 MB) und schickt einmal.

**Seite → Brücke:** `GET /api/verlauf?forge=<owner/name>&epic=<nr>` → `{forge, epic, stand, empfangen,
eintraege}`, `404` ohne Verlauf. Nur ein gekoppeltes Gerät (auch über den Fernweg) oder der Rechner
selbst liest; sonst `401` mit `X-Bruecke-Grund: geraet`. Es gibt keinen Weg zurück zum Lauf, und keine
Push-Nachricht trägt Verlaufstext.

**Schritt im Bericht:** `schritt` der Mission und der Satz der `lage` bei „Arbeitet“ nutzen dieselbe
Übersetzung: „Paket #481: Ingenieur fährt Tests: …“, „Orchestrierung liest mission/SKILL.md“. Eigene
Zeilen des Treibers („still seit …“, „Zugende …“) gehen maskiert und mit kurzen Pfaden.

## 6. Werft: `POST /api/werft`, `GET /api/werft/handlungen`

Die Werft (`flotte werft`, #88, agent-skills/ADR-0005) ist ein eigener Dienst je Rechner, umgesetzt
in `flotte/src/befehle/werft.ts`, getestet gegen eine Attrappe in `flotte/test/werft.test.ts`. Wie
der Treiber **ruft nur sie**: Die Brücke befiehlt nichts, sie hält Stand, Einstellungen und
Handlungen. Basis-URL, Token und Zeitgrenze wie in den Grundregeln (`--bruecke`, `FLOTTE_BRUECKE`,
`FLOTTE_BRUECKE_TOKEN`, 3 s); ist die Brücke aus, zieht die Werft weiter nach. Die Gegenseite der
Brücke (#90) steht unten unter „Auf der Brücke“; der gemeinsame Vertrag sind
[`beispiel/werft.json`](beispiel/werft.json) (Bericht) und
[`beispiel/werft-handlungen.json`](beispiel/werft-handlungen.json) (Abholen): pytest
(`tests/test_werft.py`) prüft die Brücke, `bun test` (`flotte/test/werft.test.ts`) die Werft dagegen.

**Takt** (alle 15 s): `GET /api/werft/handlungen?rechner=<os.hostname()>`, dann die fälligen
Repositorys, dann `POST /api/werft`; nur wenn die Brücke den Bericht angenommen hat,
`POST /api/werft/handlungen/{id}/quittung` je Handlung, die gewirkt hat oder abgelehnt wurde. Ein
`nachziehen`, das nicht wirken konnte (Fetch, Adapter oder Diff gescheitert, `fehler` im Bericht),
bleibt unquittiert und wirkt im nächsten Takt.

**Bericht** `POST /api/werft`, Antwort `{"ok": true}`; der Bericht eines Rechners ersetzt seinen
vorigen.

| Feld | Bedeutung |
|---|---|
| `rechner` | `os.hostname()`; je Rechner eine Werft |
| `zeit` | ISO-Zeit des Takts |
| `repos[]` | je Repository mit `deploy`: `{forge, branch, stand, geprueft, abfrageS, abfrageGesetzt, an, migrationTest, fehler, stacks[]}`. `forge` ist `owner/name` von `origin` auf GitHub, sonst der Ordnername (nie ein Pfad), und mit `rechner` der Schlüssel des Repositorys; `branch` der `main_branch`; `stand` der zuletzt abgearbeitete Commit von `origin/<branch>` (`null` vor dem ersten Blick); `geprueft` ISO; `abfrageS` der wirksame Abstand, `abfrageGesetzt` der über die Brücke gesetzte (`null`: `deploy.abfrage_s`); `an` und `migrationTest` die wirksamen Einstellungen (unten); `fehler` Text, wenn das Repository nicht geprüft werden konnte (Fetch, Adapter, Diff), sonst `null` |
| `repos[].stacks[]` | `{name, status, commit, zeit, protokoll, migration, arbeit, an}`, in der Reihenfolge des Adapters. `status` `gruen`, `rot` oder `null` (noch nie von der Werft gezogen); `commit` der Stand, bei dem der Stack zuletzt gezogen wurde; `protokoll` bei `rot` das Ende der Ausgabe (höchstens 4000 Zeichen), sonst `null`; `migration` `{test, arbeit, sicherung}`: welche Befehle von #89 der Adapter nennt; `arbeit` die Arbeitsmigration (unten) oder `null`; `an` `false`, wenn der Mensch den Stack abgeschaltet hat |
| `repos[].stacks[].arbeit` | `{zustand, commit, sicherung, pruefsumme, zeit}` oder `null` (kein `migration_arbeit` oder noch nie nachgezogen). `zustand`: `wartet` (Sicherung geprüft, wartet auf `migration_freigeben`; nur hier zeigt die Brücke den Knopf), `gesperrt` (keine geprüfte Sicherung: scheiterte die Sicherung beim Nachziehen, steht der Stack `rot` mit Protokoll; sperrt eine abgelehnte Freigabe, weil Sicherungsdatei oder Befehl sich geändert haben, bleibt der Stack, wie er war, und der Grund steht in `meldungen[]`; `nachziehen` nimmt eine neue), `laeuft` (freigegeben und gestartet; bleibt nach einem Absturz stehen und wird nie wiederholt), `migriert`, `rot` (Exit ≠ 0, Protokoll am Stack). `commit` der nachgezogene Commit, `sicherung` der Dateiname der Sicherung (nie ein Pfad) oder `null`, `pruefsumme` ihr SHA-256 (hex) oder `null`, `zeit` ISO des letzten Wechsels |
| `meldungen[]` | was dieser Takt getan oder abgelehnt hat, als Text (Laufband) |

**Handlungen** `GET /api/werft/handlungen?rechner=<name>` liefert die noch nicht quittierten
Handlungen des Rechners: `{id, forge, stack, art, text, zeit, herkunft}`.

| `art` | Felder | was die Werft tut |
|---|---|---|
| `nachziehen` | `stack` ein Stack aus `stacks[]` | holt `origin/<branch>` sofort und zieht den Stack beim aktuellen Stand nach, auch wenn er `rot` steht; grün hebt den Halt auf. Ein unbekannter Stack wird eine Meldung `Nachziehen über die Brücke abgelehnt` |
| `einstellen` | `text` = `{"name", "wert"}`, Namen unten | setzt den Wert ab diesem Takt, gespeichert im Stand (`werft.json`), überdauert einen Neustart; Meldung `Einstellung <Titel> von <alt> → auf <neu>, Mensch über die Brücke`. Ein anderer Name, Wert oder Stack wird eine Meldung `Einstellung über die Brücke abgelehnt` |
| `migration_freigeben` | `stack` ein Stack aus `stacks[]`, `text` = `{"commit": <sha>, "sicherung": <Dateiname>, "pruefsumme": <sha256>}`, abgeschrieben aus `arbeit` des Berichts | die PIN prüft die Brücke vor dem Anlegen. Die Werft fährt `migration_arbeit` nur, wenn `arbeit.zustand` `wartet` ist, alle drei Felder genau passen, die Sicherungsdatei noch dieselbe Prüfsumme hat und der Adapter noch denselben Befehl nennt wie bei der Sicherung (gefahren wird dieser gespeicherte Befehl; Prüfsumme oder Befehl geändert → `gesperrt`); sonst eine Meldung `Freigabe der Migration über die Brücke abgelehnt: <Grund>` und nichts läuft. Wirkt höchstens einmal, auch nach Neustart; eine Freigabe einer älteren Sicherung oder eines älteren Commits wirkt nie |

**Einstellungen** (#90), je Repository, Standard in Klammern:

| `name` | `stack` | `wert` | Wirkung |
|---|---|---|---|
| `abfrage_s` | `null` | Sekunden > 0 oder `null` (`deploy.abfrage_s`) | wie oft das Repository fällig ist |
| `an` | `null` | `true`/`false` (`true`) | Werft für das Repository: aus holt sie nichts, zieht nichts nach (auch kein `nachziehen` der Brücke: Meldung `Nachziehen über die Brücke abgelehnt: die Werft ist für <forge> aus`, quittiert) und fährt keine Migration; der Stand bleibt stehen, wieder an zieht sie nach, was seitdem kam |
| `an` | ein Stack aus `stacks[]` | `true`/`false` (`true`) | dieser Stack wird nicht nachgezogen, auch nicht auf `nachziehen` (abgelehnt, quittiert), keine Test- und keine Arbeitsmigration; was ihn in der Zeit berührt, merkt sich die Werft (`nachholen`); wieder an, zieht sie ihn im nächsten fälligen Takt beim dann aktuellen Stand nach |
| `migration_test` | `null` | `true`/`false` (`true`) | `migration_test` läuft nach einem grünen `nachziehen` von selbst; aus: nur `nachziehen` |

**Aus schließt das Tor nicht auf** (#90): Eine Freigabe für eine abgeschaltete Werft oder einen
abgeschalteten Stack lehnt die Werft ab (`Freigabe der Migration über die Brücke abgelehnt: die Werft
ist für <forge> aus` bzw. `der Stack <name> ist aus`) und quittiert sie; die Migration bleibt
`wartet` (nichts wird gesperrt), nach dem Einschalten braucht sie eine neue Freigabe. Eine Freigabe,
die bis zum Einschalten liegen bliebe, würde später unbemerkt wirken; deshalb keine.

Eine Handlung für ein Repository, das auf diesem Rechner keine Werft führt, wird abgelehnt und
quittiert. Eine `art`, die die Werft nicht kennt (bei einer älteren Werft), bleibt unquittiert
liegen. Kommt eine Handlung ein zweites Mal (die Quittung ging verloren),
erkennt die Werft sie an `handlungenErledigt` im Stand und quittiert nur. Jede wirkt genau einmal.

**Auf der Brücke** (#90): `POST /api/werft`, `GET /api/werft/handlungen?rechner=` und
`POST /api/werft/handlungen/{id}/quittung` brauchen wie der Treiber den Token (`401`), sonst `422`
bei ungültigen Feldern (ein Stack-Status außerhalb `gruen`/`rot`/`null`, eine Sicherung oder `forge`
mit Pfad); `meldungen` und `fehler` kürzt sie auf 4000 Zeichen statt abzulehnen. Fehlen die Felder
von #90 (ältere Werft), gelten sie als an. Die Brücke hebt die letzten 40 `meldungen` je Rechner auf
und zeigt sie im Laufband und Logbuch (`ereignisse[]` mit `kurz` `Werft`, `forge` aus dem Präfix
`<forge>:`, `zeit` des Berichts). Den Werft-Handlungen dient eine eigene Tabelle; `GET /api/handlungen`
des Treibers liefert sie nie.

Die Seite legt Handlungen an: `POST /api/werft/handlung`, Body
`{rechner, forge, stack, art, text}`, Antwort `{ok, id}`; Gerät mit Recht Handeln nötig (Abschnitt „Geräte“), ohne Recht `403`, ohne
gesetzte PIN `403`. Geprüft gegen den letzten Bericht dieses Rechners:
Repository oder Stack unbekannt `404`; `nachziehen` und `migration_freigeben` bei Werft oder Stack aus
`409`; `migration_freigeben` nur bei `arbeit.zustand` `wartet` und nur mit genau `commit`,
`sicherung`, `pruefsumme` von `arbeit` im Bericht (`409` sonst: die Freigabe gilt dem, was der Mensch
sah); `einstellen` wie in der Tabelle, `abfrage_s` ganze Sekunden von 15 bis 86400 oder `null`,
sonst `422`. Bis zum Abholen gilt je Ziel die letzte (Ziel: Stack und `art`, bei `einstellen` Stack
und `name`); danach `409`.

In `GET /api/tafel` steht `werft[]`, ein Eintrag je Repository und Rechner, sortiert nach `forge`:
`{id, rechner, empfangen, veraltet, kurz, forge, branch, stand, geprueft, abfrageS, abfrageGesetzt,
an, migrationTest, fehler, stacks[], einstellungen[]}`. `veraltet` nach 180 s ohne Bericht. Jeder
Stack trägt dazu `nachziehen` und `freigabe` (die noch nicht quittierte Handlung `{id, art, text, zeit,
abgeholt, quittiert}` oder `null`). `einstellungen[]` hat die Form der Treiber-Einstellungen
(`an` mit `werte` `an`/`aus`, `stacks` als Liste der eingeschalteten mit `auswahl`, `abfrage_s` mit
`leer`, `min`, `max` und `adapter`, `migration_test` mit `werte` `ja`/`nein`), `offen` ist die Änderung
unterwegs zur Werft.
Eine quittierte Werft-Handlung steht ab dann in `erledigt[]` (heute) wie eine des Treibers:
`{art: "handlung", werft: true, forge, repo, rechner, stack, epic: null, nr: null, zeit, handlung, text}`,
bei `einstellen` dazu `titel` (`Werft`, `Werft · Stack <name>`, `Werft · Abfrageabstand (s)`,
`Werft · Test-Migrationen selbst`) und `wert` in Worten (`an`/`aus`, `ja`/`nein`, Sekunden oder `null`).

## 7. Web-Push (#37, optional)

Aus, solange `BRUECKE_VAPID_SCHLUESSEL` leer ist: Dann versucht die Brücke keinen Versand und spricht
mit keinem Push-Dienst, `push` in `GET /api/tafel` ist `null`, `POST /api/push` antwortet `409`.

- **Auslöser:** jeder `POST /api/bericht`. Die Brücke bildet aus dem Bericht die Ebene „Braucht dich“
  (offene Fragen, blockierte und abgebrochene Missionen, die nicht aufgegeben sind) und vergleicht sie mit
  den schon gemeldeten Ereignissen des Projekts (SQLite, Tabelle `gemeldet`, auch ohne VAPID-Schlüssel
  geführt). Neu ist eine Frage mit neuem `(epic, nr, seit)` und eine Mission, die mit neuer `stufe` oder
  neuem `haltZeit` hält. Die neuen eines Berichts gehen als **ein** Push an jedes Abo, nach der
  Antwort an den Treiber; ein Neustart der Brücke meldet nichts erneut.
- **Inhalt** (verschlüsselt, `aes128gcm`, TTL 24 h): `{"titel", "text"}`. Ein Ereignis:
  `Braucht dich: <kürzel> #<nr>` und `Frage · <Titel>` oder `Blockade · <Titel>`; mehrere:
  `Braucht dich: <n> neue Meldungen` und je Ereignis eine Zeile `<kürzel> #<nr> <Art> · <Titel>`.
  Kürzel ist der Repository-Name ohne Besitzer, der Titel höchstens 60 Zeichen. Nie Fragetext, Lage,
  Grund, Log, Pfade oder Transkript.
- **`POST /api/push`**: das Abo des Geräts, wie `PushSubscription.toJSON()` es
  liefert, `{endpoint, keys: {p256dh, auth}}`; `endpoint` nur `https://` bei einem bekannten Push-Dienst
  (Host `fcm.googleapis.com` oder endend auf `.push.services.mozilla.com`, `.notify.windows.com`,
  `.push.apple.com`), ohne Benutzerangaben, Port keiner oder 443, sonst `422`: Die Brücke schickt an
  jedes Abo, also an kein Ziel im LAN. `200 {ok}`, ohne gekoppeltes Gerät
  oder ohne Recht `401`/`403` wie bei den Antworten (Abschnitt „Geräte“), ohne VAPID-Schlüssel `409`.
- **`POST /api/push/abmelden`**: `{endpoint}`; `200 {ok, geloescht}`. Meldet der
  Push-Dienst ein Abo mit `404` oder `410` als abgelaufen, löscht die Brücke es selbst; jeder andere
  Fehler lässt es stehen (Log-Zeile ohne Inhalt).
- **`GET /sw.js`**: der Service Worker (zeigt den Push, ein Tipp öffnet die Brücke). Das Manifest
  `/static/manifest.webmanifest` trägt `id` und `scope` `/`.

## 8. Bereitschaftsraum (Chat)

Der Chat der Brücke (agent-skills/ADR-0004). Die Brücke speichert nur Nachrichten, Antworten und
Stand, nie Anmeldedaten. Ein Dienst je Rechner, `flotte chat --repos <ordner> [--bruecke <url>]
[--takt-s 10]` (umgesetzt in `flotte/src/befehle/chat.ts`), holt die Nachrichten, führt je Chat
eine fortgesetzte `claude -p`-Sitzung auf dem Konto und Modell des Chats aus und legt auf Knopfdruck
des Menschen über den Auftragsschreiber an. Basis-URL, Zeitgrenze und `X-Bruecke-Token` wie in den
Grundregeln; `401` ohne passenden Token. Jede Antwort der Brücke ist JSON (die beiden `POST` etwa
`{"ok": true}`); einen `2xx` ohne JSON-Körper wertet der Dienst als nicht angenommen. Der Dienst
schickt nie einen Pfad, ein Konto-Verzeichnis oder Anmeldedaten, nur Texte und Kurznamen. Der
gemeinsame Vertrag ist [`beispiel/chat.json`](beispiel/chat.json) (je eine Nachricht beider Arten,
eine Quittung, je eine Antwort beider Arten); `bun test` prüft den Dienst dagegen
(`flotte/test/chat.test.ts`).

**Bindung an einen Rechner.** Konto-Kurznamen und `claude`-Sitzungen gelten nur auf ihrem Rechner.
Ein Chat gehört dem Rechner, dessen Antwort zuerst eine `sitzung` brachte; vorher darf jeder Rechner
seine Nachrichten übernehmen (ein Rechner ohne das Repository antwortet mit `fehler` und
`sitzung: null` und belegt den Chat damit nicht). Die Brücke merkt sich dazu den `rechner` der
Quittung, auf die die erste Antwort mit `sitzung` folgte.

**`GET /api/chat/nachrichten?rechner=<name>&konten=<k1,k2,…>`** — die Nachrichten ohne Antwort,
älteste zuerst, die dieser Rechner übernehmen darf: aus Chats ohne Rechner, deren `konto` unter
den `konten` dieses Rechners steht, und aus Chats, die an diesen Rechner gebunden sind; Nachrichten eines an einen anderen Rechner gebundenen Chats nie.
`rechner` ist der Rechnername des Dienstes, `konten` die Kurznamen der Konten, die es auf ihm gibt
(nur Ziffern, durch Komma getrennt, nie Pfade). Die Brücke merkt sich beides je Rechner und bietet
daraus die Kontowahl je Chat an. Antwort:
`[{id, chat, forge, art, konto, modell, text, entwurf, starten, sitzung, zeit}]`.

| Feld | Bedeutet | Form |
|---|---|---|
| `id` | die Nachricht | Ganzzahl |
| `chat` | das Gespräch; alle Nachrichten eines Chats teilen Konto, Repository und Sitzung | Ganzzahl |
| `forge` | Repository des Chats | `owner/name`, beide Teile `^[A-Za-z0-9][A-Za-z0-9_.-]*$` |
| `art` | `text`: der Mensch schreibt oder antwortet auf eine Fragekarte; `anlegen`: er drückt „anlegen“ oder „anlegen und starten“ am Entwurf | `text` \| `anlegen` |
| `konto` | Kurzname des Kontos, das der Mensch gewählt hat | `1`, `2`, `3` … (nur Ziffern, nie ein Pfad) |
| `modell` | gewähltes Modell oder `null` (dann `claude-opus-5-5`) | `^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,80}$` |
| `text` | die Nachricht des Menschen (die Wahl einer Karte als Text, etwa `Q1 A`) | bei `text` nicht leer, bei `anlegen` `null` |
| `entwurf` | der Entwurf, der angelegt werden soll (der letzte `entwurf` einer Antwort des Chats) | bei `anlegen` nicht leer, sonst `null` |
| `starten` | „anlegen und starten“ (`ready_label`, Warp frei) statt „anlegen“ (`needs-triage`) | Wahrheitswert, bei `text` `false` |
| `sitzung` | `sitzung` der letzten Antwort des Chats, `null` vor der ersten | `^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$` |
| `zeit` | Eingang, ISO | |

Was nicht passt, lässt der Dienst liegen.

**Anlegen ist eine Freigabe.** Eine Nachricht `art: anlegen` legt Issues an und mit `starten` gibt
sie der Flotte frei; der Dienst prüft dahinter nichts mehr. Die Brücke nimmt sie deshalb nur von
einem Gerät mit Recht Handeln an (wie `POST /api/handlung`), und ihr `entwurf` ist immer wörtlich der
`entwurf` der letzten Antwort dieses Chats, den der Mensch gesehen hat, nie eine Eingabe des
Formulars. Ohne PIN oder ohne einen solchen Entwurf entsteht keine Nachricht `anlegen`.

**`POST /api/chat/nachrichten/{id}/quittung`**, Body `{rechner}` — der Dienst übernimmt die
Nachricht, bevor er etwas startet. `200` übernommen (auch wiederholt vom selben Rechner); `409`,
wenn der Chat an einen anderen Rechner gebunden ist, ein anderer Rechner die Nachricht schon hat
oder im Chat schon eine andere Nachricht quittiert und unbeantwortet ist (je Chat höchstens eine);
`404` unbekannt. Danach liefert `GET` sie nur noch diesem Rechner, bis sie eine Antwort hat; so holt
ein neu gestarteter Dienst sie wieder.

**`POST /api/chat/nachrichten/{id}/antwort`**, Body
`{text, sitzung, fehler, karten, entwurf}`, bei `art: anlegen` dazu `missionen` — schließt die
Nachricht ab. `200` gespeichert, `404` unbekannt; eine zweite Antwort auf dieselbe Nachricht ändert
nichts und gibt ebenfalls `200`.

| Feld | Bedeutet | Form |
|---|---|---|
| `text` | Nachricht an den Menschen (Markdown) oder `null`; bei `anlegen` die Liste des Angelegten mit den Hinweisen des Auftragsschreibers | Text \| `null` |
| `sitzung` | die Sitzung des Chats; die Brücke merkt sie sich für die nächste Nachricht und bindet den Chat beim ersten Wert an den quittierenden Rechner | wie oben \| `null` |
| `fehler` | `null` oder ein Satz für den Menschen: Verbrauchsbremse rot (`Verbrauchsbremse rot auf Konto 2 (…): kein Aufruf. Später noch einmal senden.`), unbekanntes Konto, fehlendes Repository, gescheiterter Aufruf, eine Antwort ohne die verlangte Form (dann steht ihr Text unverändert in `text`), `Anlegen gescheitert: …` | Text \| `null` |
| `karten` | Fragekarten der Runde: je Karte `frage` (Titel, Sachverhalt, Einzel- oder Mehrfachwahl, Empfehlung) und `optionen` als Knöpfe; Freitext ist immer erlaubt (Antwort als `art: text`) | `[{frage, optionen: [Text]}]`, sonst `[]` |
| `entwurf` | der Entwurf im Format des Auftragsschreibers, sobald er steht; die Brücke zeigt ihn mit „anlegen“ und „anlegen und starten“ | Text \| `null` |
| `missionen` | nur bei `art: anlegen`: die angelegten Issues, Mission vor ihren Missionszielen; `[]`, wenn das Anlegen scheiterte | `[{nummer, url, titel}]` |

Mindestens `text` oder `fehler` ist gesetzt.

**Stand des Chats** (`offen`, `gestoppt`, `angelegt`, `verworfen`) führt die Brücke. Hier gilt nur: Nach einer
Antwort auf `art: anlegen` mit `fehler: null` und nicht leerem `missionen` setzt sie „angelegt“ und
zeigt die Links; „verworfen“ ist ein Klick in der Brücke und kommt nie beim Dienst an. Ein
`gestoppter` Chat (#47) liefert keine Nachricht mehr an `GET`, bis der Mensch ihn fortsetzt; eine
schon quittierte Nachricht darf der Dienst noch beantworten.

**Ablauf je Takt:** zuerst Antworten nachliefern, die die Brücke noch nicht nahm (sie laufen nicht
noch einmal), dann `GET`, dann je freiem Chat die älteste Nachricht: Quittung, dann

- `art: text`: Verbrauchsbremse des Kontos (bei Rot nur die Meldung als `fehler`, kein Aufruf),
  `claude -p` mit `--resume <sitzung>` und `--json-schema` (`{text, karten, entwurf}`) im Ordner
  `<ordner>/<name>` des Rechners, Antwort;
- `art: anlegen`: kein `claude` und keine Verbrauchsbremse; der Dienst ruft
  `flotte auftrag <ordner>/<name> - [--starten]` mit `entwurf` auf stdin auf und antwortet mit
  `missionen`.

Je Chat läuft höchstens eines; mehrere Chats laufen nebeneinander.

**Rechte des Chats:** Das Modell liest nur, und nur im Repository: `--tools Read,Grep,Glob`,
`--permission-mode dontAsk`, `--strict-mcp-config`; meldet `claude` beim Start ein anderes
Werkzeug, bricht der Dienst den Aufruf ab. Die Grenze zum Repository zieht die Lesesperre, ein
`PreToolUse`-Hook für `Read|Grep|Glob` per `--settings` (`flotte/src/befehle/chat-lesesperre.ts`,
`onFailure: block`, das Repository als Argument): Jeder Pfad außerhalb des Repositorys, auch über einen
Link, wird mit Exit 2 abgelehnt, ebenso jedes Glob-Muster mit `..` (auch nach Klammer-Expansion und
Zeichenklassen), Laufwerk, `~`, Backslash, runden Klammern oder einem Anfang mit `/`. `--allowedTools 'Read(./**)'` bleibt stehen, engt aber nichts ein, denn
Lesewerkzeuge brauchen keine Freigabe (Probe 23.11.2026). Kein Bash: Anlegen ist allein die Nachrichtenart
`anlegen`, also der Knopf des Menschen, und Missionen entstehen nur über den Auftragsschreiber
(agent-skills/ADR-0002).

## Was die Seite selbst nutzt

`GET /api/tafel` (das Board in drei Ebenen, dazu `prototypen[]`, `sitzungen[]` und `push`, der
öffentliche VAPID-Schlüssel oder `null`), `POST /api/push` und `POST /api/push/abmelden` (Abschnitt 7), `GET /holodeck/…` (im
abgeschotteten Rahmen), `POST /api/pin` (PIN prüfen, Kopf `X-Bruecke-Pin`),
`POST /api/antwort` (`{forge, epic, nr, seit, option, text}`) und `POST /api/handlung`
(`{forge, epic, art, nr, seit, text}`), beide von einem gekoppelten Gerät. Für den Bereitschaftsraum (#85),
ebenso: `POST /api/chat` (`{forge, konto, modell, text}`, ein neuer Chat mit seiner
ersten Nachricht; `konto` muss ein Rechner melden, sonst `409`), `POST /api/chat/{id}/nachricht`
(`{text}`), `POST /api/chat/{id}/einstellung` (`{konto, modell}`; ein anderes Konto nach der ersten
Sitzung oder während ein Rechner eine Nachricht des Chats bearbeitet `409`), `POST /api/chat/{id}/anlegen` (`{starten, von}`: `von` ist die Nachricht, deren Antwort
den gezeigten Entwurf brachte; `409` ohne Entwurf, bei einem neueren, solange eine Nachricht wartet oder
der Chat nicht offen ist), `POST /api/chat/{id}/verwerfen` (offen oder gestoppt) und (#47)
`POST /api/chat/{id}/stoppen` (offen → gestoppt, sonst `409`), `POST /api/chat/{id}/fortsetzen`
(gestoppt → offen, holt ihn auch aus dem Archiv, sonst `409`), `POST /api/chat/{id}/archivieren`
(`{archiviert}`; ein offener Chat wird dabei gestoppt; schon im oder nicht im Archiv `409`). Stand und
Archiv liegen in der Tabelle `chats` und überstehen einen Neustart. In `GET /api/tafel` steht
`bereitschaftsraum` `{pin, modell, konten[{konto, rechner[]}], rechner[], projekte[], chats[]}`, je Chat
Stand, `archiviert` (Zeitpunkt oder `null`), Verlauf, die Karten der letzten Antwort, der letzte Entwurf `{von, text}` und die angelegten
`missionen`. Fünf falsche PINs je Absender (Koppeln, Rechner-Eingang, `POST /api/pin`)
sperren für fünf Minuten. Über den Fernzugriff (#48) gelten seit ADR-0007 dieselben Regeln für die Wege der Person
(`PERSON_FERN` in `app/main.py`); jede andere Anfrage außer GET und HEAD und das Abholen bekommen dort `403`.
`nurAnsicht` in `GET /api/tafel` ist immer `false` (für ältere Seiten).

### Geräte (#46)

Jede schreibende Anfrage der Person oben braucht ein gekoppeltes Gerät (Cookie `bruecke_geraet`) mit
dem Recht dafür, ohne PIN (Stefan, 24.11.2026; die PIN koppelt und gibt am Rechner Rechte). Recht **Antworten**: `POST /api/antwort`, `POST /api/chat`,
`…/nachricht`, `…/einstellung`, `…/verwerfen`, `…/stoppen`, `…/fortsetzen`, `…/archivieren`, `POST /api/push`, `POST /api/push/abmelden`. Recht
**Handeln**: `POST /api/handlung`, `POST /api/werft/handlung`, `POST /api/chat/{id}/anlegen`. Die
Prüfung in dieser Reihenfolge: keine PIN gesetzt `403`; unbekanntes oder entkoppeltes Gerät `401` mit
Kopf `X-Bruecke-Grund: geraet`; Recht fehlt `403` (`recht`); Not-Aus `423`. `POST /api/pin` prüft nur die PIN (`204` oder `403`).

- `POST /api/geraete/koppeln` `{name}` mit PIN: setzt das Cookie (zufällig, HttpOnly, Secure,
  SameSite=Strict), gespeichert wird nur sein SHA-256. Antwort `{ok, geraet}`; ein neues Gerät hat
  `antworten: true`, `handeln: false`.
- **Nur über den Eingang des Rechners** (Port 8002 im Container, compose nur auf `127.0.0.1`), mit PIN,
  sonst `403`: `POST /api/geraete/{id}/rechte` `{antworten, handeln}`, `POST /api/geraete/{id}/entkoppeln`,
  `POST /api/notaus/loesen` (`409`, wenn keiner ausgelöst ist).
- `POST /api/notaus`: jedes gekoppelte Gerät, ohne PIN und ohne Recht; danach `423` für jede Antwort,
  Handlung und Kopplung, auch nach einem Neustart, bis zum Lösen.
- In `GET /api/tafel`: `geraete[{id, name, antworten, handeln, gekoppelt, zuletzt}]`, `geraet` (das
  anfragende Gerät oder `null`), `amRechner`, `notaus` (`{seit, geraet}` oder `null`) und
  `geraeteLogbuch[{zeit, geraet, befehl}]` (neueste zuerst, höchstens 200; `befehl` ist Pfad und Body,
  wie sie ankamen).
