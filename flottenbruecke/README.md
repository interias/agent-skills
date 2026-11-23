# Flottenbrücke

Ein kleiner, dauerhaft laufender Dienst (#28): Er zeigt alle Einsätze des Flotten-Treibers
(`flotte`) über Repositorys und Konten hinweg, nimmt die Antworten des Menschen auf Fragen der
Läufe entgegen und reicht zwei Handlungen bei Blockaden an den Treiber (neu einreihen, aufgeben), die Einstellungen des Treibers (Maschinenraum) und die Steuerung der Missionen im Einsatz (Sternenkarte: aufnehmen, pausieren, fortsetzen, Priorität, Andocken) und die Triage (Frachtraum: Triage-Lauf starten, Fragen beantworten, Entscheidungen und Missionen des Schnittplans widerrufen).
Nur im LAN, kein Tunnel. Die Brücke startet, stoppt und dockt nichts selbst an.

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
| `BRUECKE_TZ` | `Europe/Berlin` | Zeitzone für „Angedockt (heute)“ |

Unter Windows muss die Firewall den Port im privaten Netz zulassen, damit das Handy ihn erreicht.

## Bereiche und Navigation

Oben eine Zeile: Logo, die Befehlszeile (Strg+K, am Mac ⌘K), der Zähler „Braucht dich“ (auf jeder
Seite, rot pulsierend, solange etwas offen ist) und die Bereiche als Pillen. Auf dem Handy (bis
700 px) stehen die Pillen unten in Daumenreichweite, die Brücke trägt dort die Zahl.

- **Brücke** (`#bruecke`, Startseite) — das Board unten.
- **Holodeck** (`#holodeck`) — die Prototypen der Projekte, unten.
- **Frachtraum** (`#frachtraum`) — die Sternzeit-Notizen aller Projekte, unten.
- **Sternenkarte** (`#sternenkarte`) — Projekte mit ihrem Backlog, unten.
- **Maschinenraum** (`#maschinenraum`), **Logbuch** (`#logbuch`) — siehe unten.

Bilder aller Bereiche mit den Beispieldaten aus `beispiel/`, je 1440 und 390 px breit: `doku/`.

Jeder Bereich hat eine Adresse zum Merken, die Zurück-Taste geht zum vorigen; eine unbekannte
Adresse zeigt die Brücke. Die Befehlszeile sucht und springt nur: Bereiche, Projekte und Missionen der
Tafel (Nummer oder Titel), mit Pfeiltasten, Enter und Esc. Eine Mission öffnet ihre Ebene und markiert
die Karte kurz. Sie führt nichts aus.

Für Entwickler: Ein Bereich liegt in `app/static/bereiche/<bereich>.js` (und `.css`) und meldet sich
mit `huelle.bereich({ name, titel, zeichne(t, el), treffer(t) })` an der Hülle (`huelle.js`) an.
`zeichne` läuft bei jedem Laden der Tafel, solange der Bereich sichtbar ist, `treffer` liefert
Einträge für die Befehlszeile. `huelle.springe(bereich, ziel)` springt wie ein Treffer der Befehlszeile
zu einem Element, `huelle.beiTafel(f)` ruft `f(t)` nach jedem Laden der Tafel (so zeichnet sich die
Schiffsliste). Alle Skripte und Stile, die `index.html` nennt, bindet die Brücke mit
Inhalts-Hash ein.

## Sternenkarte

Der Überblick über die Projekte und die Steuerung ihrer Missionen. Je Projekt (Forge-Repo des Treibers) ein Block mit dem
Kürzel, der Zahl offener Missionen und der Prognose „Backlog leer etwa …“ (ab 5 gemessenen Missionen, sonst
der Hinweis, wie auf der Brücke). Darunter jede offene Mission als Zeile: Nummer (Link aufs Issue),
Titel, die Stufe (läuft, wartet, Frage, blockiert, PR), `prio` bei `prio/hoch`, warum es wartet oder
hält, die Reihenfolge („nach #38“ springt zur Zeile des Vorgängers, „danach #41“ zeigt die wartenden
Nachfolger; ein erledigter Vorgänger ist ein Link aufs Issue) und eine aufklappbare Liste seiner
Missionsziel-Tickets mit Stand und Links. Ein Klick auf die Stufe führt zur Karte der Mission auf der Brücke.
Angedockte und aufgegebene Missionen gehören nicht in den Backlog. Die Daten stehen im Bericht des Treibers
(`nach[]` je Mission ist neu, siehe `SCHNITTSTELLE.md`); die Brücke fragt keine Forge. Ein älterer Treiber
ohne `nach[]` zeigt die Missionen ohne Kanten.

**Steuern (#61), nur mit PIN:** Unter jeder Mission im Einsatz **Pausieren** oder **Fortsetzen** und
**Priorität hoch** oder **Priorität normal**; unter „Freigegeben, nicht im Einsatz“ (offene Missionen mit
`ready_label`, die der Treiber nicht fährt, etwa neben `--epics`) **Aufnehmen**, nach einer Rückfrage.
Der Treiber holt die Handlung im nächsten Takt ab; bis zur Quittung steht an ihrer Stelle, dass sie
unterwegs ist. Eine Pause bricht nichts ab: Eine wartende Mission startet nicht; ein laufender Lauf erfährt
sie vor seinem nächsten Paketstart über die RAM-Messung (`ram.ps1` liest sie aus seiner Haltedatei und
meldet `hold`), startet kein weiteres Paket und lässt die laufenden zu Ende laufen; danach wartet die
Mission samt der Antwort des Admirals, bis sie fortgesetzt wird. **Andocken (#112):** Jede Mission zeigt,
wie sie andockt (automatisch nach Andockprüfung oder Mensch prüft), woher das kommt (Einstellung des
Projekts, Vorschlag mit Grund, Schalter an der Mission) und bietet „Mensch prüft“, „Automatisch
andocken“ (nur wenn der Treiber es anbietet, also bei `merge: nach_gate`) und „Zurück zum Vorschlag“.
„Priorität hoch“
lässt es unter den startbereiten zuerst auf einen freien Platz, Reihenfolge und Kollisionen gelten
weiter; sie gilt vor dem Label `prio/hoch`. Die Zeile zeigt `prio`, `pausiert` (gestrichelter Rand,
blau, nie rot) und „nicht im Einsatz“. Jede Handlung steht im Flottenlogbuch und unter „Erledigt
heute“. Bilder: `doku/v3-sternenkarte-1440.png`, `-390.png`.

## Frachtraum

Der Wareneingang (#116): alle Sternzeit-Notizen (`needs-triage`, `needs-info`) aller Projekte, je Projekt
ein Block mit der Zahl der Notizen und der offenen Fragen; Projekte mit Fragen stehen oben. Darin:

- **Fragen an dich** — die kritischen Fragen der Triage, auf die noch niemand geantwortet hat: Ticket,
  Frage, Punkt der Liste „beim Menschen“, warum sie bei dir liegt, Herkunft, je Option ein Knopf (die
  Empfehlung markiert) und ein eigener Text. Ein Tipp auf „B nehmen · Empfehlung“ sendet die Empfehlung.
  Der Treiber schreibt die Antwort als Kommentar ans Ticket; der nächste Triage-Lauf nimmt sie als Tatsache.
- **Entscheidungen des Triage-Laufs** — was ein über die Brücke gestarteter Lauf freigegeben (Warp frei)
  oder geschlossen hat, mit Grund und Herkunft. **› Widerrufen** mit einem Einwand: Der Treiber
  kommentiert zuerst am Ticket, dann nimmt er Warp frei zurück (`needs-triage` wieder an) oder öffnet die
  Notiz wieder. War die Notiz an eine Mission gehängt, löst er sie zuerst daraus (#148).
- **Schnittplan** (#148) — das Ergebnis des letzten Triage-Laufs: je Mission Titel (Link), Begründung,
  ihre Missionsziele (Links, mit dem Grund des Plans) und der Zustand (Warp frei, nicht freigegeben,
  widerrufen, Fehler); „neue Mission“ hat der Lauf angelegt, „bestehende Mission“ nur ergänzt. Die
  Missionen gibt der Lauf selbst frei. **› Widerrufen** mit einem Einwand nimmt das zurück: Der Treiber
  kommentiert zuerst, dann löst er die angehängten Missionsziele, gibt sie mit `needs-triage` in die
  Triage zurück, pausiert einen laufenden Außeneinsatz der Mission (ihr PR wartet dann auf einen
  Menschen), nimmt eine noch wartende aus dem Einsatz und schließt eine neue Mission als
  „not planned“; eine bestehende bleibt. Darunter die zusammengeführten und geschlossenen Notizen mit
  Grund, Fundstelle und Verweis.
- **Sternzeit-Notizen nach Thema** — Thema sind die fachlichen Labels (ohne `needs-triage`, `needs-info`,
  `ready-for-agent`, `status/*`, `epic`), sonst „ohne Thema“; Notizen mit offener Frage zuerst. Die
  Befehlszeile findet jede Notiz und jede Frage.

**Triage-Lauf starten** je Projekt und **Triage-Lauf für alle**, nach einer Rückfrage: Der Treiber führt
`flotte triage` aus (`flotte/README.md`, „Triage“), einen Lauf je Projekt zur Zeit. Jede Handlung braucht
die PIN und wirkt ab dem nächsten Takt des Treibers; nichts existiert nur auf der Brücke. Die Daten liest
der Treiber aus der Forge (`triage` im Bericht, `SCHNITTSTELLE.md`); ein älterer Treiber fehlt hier.
Bilder: `doku/v3-frachtraum-1440.png`, `-390.png`; Schnittplan: `doku/v3-frachtraum-schnittplan-1440.png`, `-390.png`.

## Schiffsliste

Die Seitenleiste links auf jeder Seite (auf dem Handy eine Schublade von links, geöffnet über den
Knopf neben dem Logo; sie schließt mit Esc, mit Tippen daneben und nach einem Sprung). Sie zeigt je
Projekt alle Läufe (Missionen mit Nummer, Titel, Konto) und die Sitzungen aller Konten, jeweils mit einem
Punkt nach Ebene. Eingeklappt (Knopf oben links in der Leiste, gemerkt je Gerät) bleibt eine schmale
Spalte, in der nur die Punkte stehen. Eine pausierte Mission trägt „pausiert“ neben ihrer Ebene, eine
Mission mit hoher Priorität `prio` vor der Nummer (#61); die Farbe bleibt die der Ebene. Ein Klick auf einen Lauf springt zu seiner Karte auf der Brücke;
eine Sitzung klappt ihre Angaben auf (Konto, Ordner, Status, seit). Die Leiste liest nur und tut
nichts. Chips über der Liste filtern (Alle, Braucht dich, Freigabe, Läuft, Sitzungen, Ruht); ab 12
Einträgen sind die ruhenden eingeklappt („+ N ruhende“).

| Punkt | Bedeutung | Woher |
|---|---|---|
| blau | Freigabe | Mission in der Andock-Schlange (Stufe `pr`) |
| lila | Frage | offene Frage, `blockiert`, `abgebrochen` (die Ebene „Braucht dich“) |
| grün | läuft | `laeuft`, `nacharbeit`, `frage` mit Prozess; Sitzung `busy` |
| gelb | neuer Prototyp | am Projektkopf, wenn das Holodeck dort einen Prototyp als neu seit dem letzten Besuch dieses Geräts zählt |
| grau | ruht | `wartend`, heute angedockt; Sitzung `idle` |

Die Zuordnung steht als Tabelle `ZUORDNUNG` in `app/static/schiffsliste.js`. Kein Punkt blinkt: Rot
und Bewegung gehören allein zu „Braucht dich“.

Die **Sitzungen** liest der Treiber, nicht die Brücke (sie läuft im Container ohne Zugriff auf die
Konten): je Konto `claude agents --json` mit dessen `CLAUDE_CONFIG_DIR`, höchstens einmal je Minute,
nur lesend. In den Bericht gehen Konto, der letzte Ordnername des Arbeitsverzeichnisses (nie der
Pfad), Name, Status, Art und Beginn; ein Projekt erkennt die Brücke am Repository-Namen, alles andere
steht unter „Sonstige“. Fehlt das Kommando oder schlägt es fehl, bleibt die Liste ohne Sitzungen.

## Board

Drei Ebenen, sortiert danach, was du tun musst:

1. **Braucht dich** — offene Fragen und blockierte Missionen, oben das, dessen Warten am meisten kostet
   (hält den ganzen Lauf oder die ganze Mission, dann die längste Wartezeit). Ist etwas offen, pulst
   der Kopf langsam rot, der Tab-Titel trägt die Zahl und das Icon einen roten Punkt; bei null ist
   die Ebene grau und still.
2. **Unterwegs** — Läufe und Andock-Schlange als Karten. Je Lauf ein Lebenszeichen: Puls, „letzter
   Schritt vor N min“ und eine Leiste bis zur Leerlauf-Grenze (gelb ab der Hälfte, rot kurz davor,
   dann stoppt der Puls). Je Mission eine Segmentleiste der Missionsziel-Tickets mit „3 von 5 fertig“;
   antippen zeigt `#nr Titel · Stand`, jede Zeile verlinkt aufs Issue (im spec-Modus die Pakete des
   Laufs, `P1`, `P2` …, ohne Link). Läuft eine Andockprüfung, steht im Kopf des Laufs **Andockprüfung n**
   mit Start und Dauer, in der Andock-Schlange die des Treibers ebenso. Darunter eine Zeile **Bereit**,
   Missionen mit `prio/hoch` zuerst, mit dem Grund, wenn sie warten, und ab fünf gemessenen Missionen
   mit „voraussichtlich 3–5 h“. Je Mission dort „N Tickets“ mit derselben Segmentleiste; antippen klappt
   die Tickets mit Links auf (im spec-Modus vor dem Start keine).
3. **Erledigt heute** (eingeklappt) — oben die Prognose „Backlog leer etwa …“ mit Trefferquote
   (Rechnung in `flotte/README.md`, „Prognose“), dann Angedocktes, Entscheidungen des Admirals mit „Zurücknehmen“,
   deine Antworten und Handlungen. Ein neues Andocken leuchtet einmal grün auf.

**Detailansicht einer Mission** (#51): Unter der Segmentleiste eines Laufs stehen **Plätze 3/3** (Pakete
in Ingenieur, Review oder Nachbesserung gegen das Fenster des Projektadapters) und die Zahl der
**Neustarts** des Laufs; die Laufzeit ist der Knopf „läuft seit …“. In der aufgeklappten Paketliste
hat jedes Paket, zu dem der Treiber Agent-Aufrufe im Protokoll des Laufs sah, eine zweite Zeile:
Phase (Ingenieur, Review, Nachbesserung, Andocken) mit Dauer in der Phase, Dauer gesamt, Runde, Stufe
(eine Eskalation als „Standard → Urteil“) und die Uhrzeit des Lebenszeichens. „länger als üblich“
(ruhig, kein Rot) erscheint, wenn ein laufendes Paket länger als das 1,5-Fache des Medians der
fertigen Pakete des Projekts läuft, ab drei fertigen; die Brücke rechnet es selbst. Fehlt ein Feld
(älterer Treiber, Paket ohne Aufruf), bleibt es weg; spec-Pakete haben sie wie Kind-Tickets (#151).
Felder: `SCHNITTSTELLE.md`.

Unter den Paketen stehen die **Entscheidungen bis zum Andocken** (#52), neueste zuerst, von jedem Tag:
deine Antworten (Mensch) und die einflussreichen Entscheidungen von Admiral und Lauf, je mit Frage,
Antwort, Herkunft und Zeit. Bis zum Andocken lässt sich jede mit „› Zurücknehmen“ widerrufen (nur mit
PIN); nach dem Andocken verschwinden sie hier, sie stehen weiter im Flottenlogbuch und an den Issues.

Im Kopf je Konto ein Tank mit dem Rest der Hauptenergie (5 h) und der Reserveenergie (Woche) samt Reset-Zeit, RAM und
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
Paketen“, eine Marke (`umkehrbar bis zum Andocken` oder warum es bleibt) und den Grund, warum die Frage
bei dir liegt. Je Option steht die Folge darunter. Ein Tipp auf „A nehmen · Empfehlung“ sendet die
Empfehlung; Optionen und Freitext gehen immer, der Freitext erreicht den Lauf unverändert. Ließ
sich ein Block nicht in Fragen zerlegen, steht sein Wortlaut selbst auf der Karte. Beim ersten
Senden fragt die Seite die PIN ab und merkt sie sich auf dem Gerät.

Bis der Treiber die Antwort abholt, lässt sie sich ändern; danach steht „Angekommen, Lauf setzt
fort“. Der Treiber behandelt sie wie `flotte antworten`, kommentiert am Issue mit der Herkunft
„Mensch über die Brücke“ und quittiert sie.

## Handlungen

Eine Blockadekarte zeigt Grund, Lage und auf Wunsch das Log der Mission. Dazu zwei Handlungen mit
PIN, die der Treiber im nächsten Takt abholt und ausführt:

- **Neu einreihen** — Zähler zurück; der Lauf setzt fort und erfährt den Grund der Blockade.
- **Aufgeben** — nach einer Rückfrage: Die Mission wird `abgebrochen` und nicht mehr gestartet.
  Branch, Pull Request und Issue bleiben.

**Zurücknehmen** in der Detailansicht der Mission (und für die Entscheidungen des Admirals von heute
auch in „Erledigt heute“) widerruft eine Entscheidung des Admirals oder deine eigene Antwort bis zum
Andocken: Du schreibst die neue Entscheidung, der Treiber kommentiert sie am Issue und gibt sie dem Lauf.
Beide Stellen teilen sich Formular und Entwurf.

Ansehen ist im LAN frei, Antworten und Handlungen nur mit PIN. Fünf falsche PINs sperren für fünf
Minuten (je Absenderadresse; hinter Docker Desktop teilen sich oft alle Geräte eine).

## Maschinenraum und Logbuch

- **Maschinenraum** (`#maschinenraum`): je Konto zwei Tanks (Hauptenergie und Reserveenergie, „… % übrig“, Reset-Zeit,
  mit Wochentag ab 20 h), Alter des Werts und Bremsstufe; je Rechner RAM, Platte, Obergrenze (Läufe
  gleichzeitig) und der Takt der Treiber, die dort melden. Alles stammt aus dem Bericht. Was er nicht
  trägt, steht als „… meldet der Treiber nicht“: heute die **Anmeldung** je Konto (der Treiber kennt sie
  nur als Halt einer Mission, nicht je Konto). Den **Grund** einer Bremse (`grund`, nur bei `gelb`/`rot`)
  liefert der Treiber; bei `gruen` steht „keine“. Kommt `anmeldung` je Konto in die Tafel, zeigt die
  Seite sie.
  Darunter der Abschnitt **Einstellungen** (keine eigene Pille): je Projekt die elf wirksamen Werte
  des Treibers mit Herkunft (Start, Brücke, Standard) und „wirksam seit …“, je Wert ein passendes
  Bedienelement (Stufenwahl, Häkchen je Konto, Zahl mit Grenzen, Wahl beim Andocken) und ein Satz, was
  er bremst. Eine Änderung geht erst nach **Übernehmen** mit PIN als Handlung `einstellen` an den Treiber (Grenzen aus
  dem Bericht, `422` darüber hinaus); bis zur Quittung steht dort „wartet auf den Treiber“. Sie gilt
  ab dem nächsten Takt, nichts Laufendes bricht ab, und steht im Logbuch. Ein älterer Treiber ohne
  `einstellungen` im Bericht: nur lesend mit Hinweis. Andocken (#112) verschärft nur: „automatisch“
  steht nur zur Wahl, wenn der Adapter `merge: nach_gate` sagt, sonst nennt die Zeile den Grund. Die
  Andock-Regel des Adapters, Rechte, Geheimnisse und Updates gibt es hier nicht. Bilder: `doku/v3-maschinenraum-1440.png`, `-390.png`.
  Meldet eine **Werft** (`flotte werft`, agent-skills/ADR-0005), steht nach den Rechnern der Abschnitt
  **Werft** (#90): je Repository und Rechner der Stand (Commit, geprüft, Abstand) und je Stack eine
  Karte mit gezogenem Commit, Zeit und Marke (grün, rot, wartet, aus), bei rot das letzte Protokoll
  aufgeklappt, dazu „Jetzt nachziehen“ und, nur wenn die Arbeits-Migration auf die Freigabe wartet,
  „Arbeits-Migration freigeben“ (mit Rückfrage, gebunden an Commit und Sicherung, die die Karte
  zeigt). Ist sie gesperrt oder rot, ist „Jetzt nachziehen“ der Hauptknopf: es nimmt eine neue
  Sicherung. Unter den Einstellungen folgt **Einstellungen · Werft** je Repository: Werft an/aus,
  Stacks an/aus, Abfrageabstand, Test-Migrationen selbst ja/nein. Alles nur mit PIN, bis zum Abholen
  „wartet auf die Werft“; die Brücke ruft die Werft nie auf, die Werft holt im nächsten Takt (15 s) ab
  und ihre Meldungen (auch jede Ablehnung) stehen im Laufband und Logbuch. Bilder:
  `doku/v3-maschinenraum-werft-1440.png`, `-390.png`, `doku/v3-maschinenraum-werft-einstellungen-1440.png`, `-390.png`.
- **Logbuch** (`#logbuch`): Ereignisse der Treiber, Entscheidungen des Admirals und Handlungen des
  Menschen in einer Liste, neueste oben, filterbar nach Mission und Art (Ereignis, Admiral, Mensch). Die
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
[`beispiel/bericht.json`](beispiel/bericht.json), [`beispiel/antworten.json`](beispiel/antworten.json), [`beispiel/handlungen.json`](beispiel/handlungen.json) und [`beispiel/holodeck.json`](beispiel/holodeck.json), für die Werft [`beispiel/werft.json`](beispiel/werft.json) und [`beispiel/werft-handlungen.json`](beispiel/werft-handlungen.json).
Zum Ausprobieren ohne Treiber:

```
curl -X POST -H "Content-Type: application/json" --data-binary @beispiel/bericht.json http://127.0.0.1:4747/api/bericht
curl -X POST -H "Content-Type: application/json" --data-binary @beispiel/bericht-notizen.json http://127.0.0.1:4747/api/bericht
curl -X POST -H "Content-Type: application/json" --data-binary @beispiel/bericht-spec.json http://127.0.0.1:4747/api/bericht
curl -X POST -H "Content-Type: application/json" --data-binary @beispiel/werft.json http://127.0.0.1:4747/api/werft
python -c "import json,urllib.request as u;[u.urlopen(u.Request('http://127.0.0.1:4747/api/holodeck',json.dumps(b).encode(),{'Content-Type':'application/json'})) for b in json.load(open('beispiel/holodeck.json',encoding='utf-8'))]"
```

`beispiel/holodeck.json` ist eine Liste mit einem Body je Projekt; die Zeile schickt jeden.
`beispiel/bericht-notizen.json` ist ein zweites, kleines Projekt (der Frachtraum mit zwei Projekten);
`beispiel/bericht-spec.json` ein drittes mit drei Missionen im spec-Modus (Pakete des Laufs, eine Andockprüfung
des Laufs, eine des Treibers in der Andock-Schlange, #151);
`beispiel/bericht.json` trägt den Schnittplan eines Triage-Laufs (zwei neue Missionen, eine bestehende,
drei geschlossene Notizen).

## Entwickeln

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Linux/macOS: .venv/bin/python
.venv/Scripts/python -m pytest
```

Backend: FastAPI (`app/main.py`), Board-Logik `app/tafel.py`, Speicher `app/speicher.py`.
Frontend ohne Build: `app/static/`.
