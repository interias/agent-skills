# Flottenbrücke

Ein kleiner, dauerhaft laufender Dienst (#28): Er zeigt alle Einsätze des Flotten-Treibers
(`flotte`) über Repositorys und Konten hinweg, nimmt die Antworten des Menschen auf Fragen der
Läufe entgegen und reicht zwei Handlungen bei Blockaden an den Treiber (neu einreihen, aufgeben), die Einstellungen des Treibers (Maschinenraum) und die Steuerung der Missionen im Einsatz (Sternenkarte: aufnehmen, pausieren, fortsetzen, Priorität, Andocken) und die Triage (Frachtraum: Triage-Lauf starten, Fragen beantworten, Entscheidungen und Missionen des Schnittplans widerrufen) und (#154) das Einspielen eines neuen Stands (Maschinenraum).
Im LAN, unterwegs optional über Tailscale (unten „Fernzugriff“, agent-skills/ADR-0006 und ADR-0007). Die Brücke startet, stoppt und dockt nichts selbst an.

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
| `BRUECKE_FERNZUGRIFF` | `an` | `aus`: der Eingang für Tailscale wird gar nicht geöffnet. `einrichten.ps1` setzt für den Arbeitsrechner `127.0.0.1` und `aus` ([`INSTALL.md`](../INSTALL.md), Schritt 2) |
| `BRUECKE_RECHNER_PORT` | `4748` | Eingang des Rechners (#46), nur auf `127.0.0.1`: Rechte der Geräte, Not-Aus lösen |
| `BRUECKE_PIN` | leer | PIN zum Koppeln eines Geräts und, mit gekoppeltem Gerät, für jede Antwort und Handlung; leer schaltet Schreiben ab |
| `BRUECKE_TOKEN` | leer | optional: Treiber muss ihn als `X-Bruecke-Token` schicken |
| `BRUECKE_TZ` | `Europe/Berlin` | Zeitzone für „Angedockt (heute)“ |
| `BRUECKE_ZERT`, `BRUECKE_ZERT_SCHLUESSEL` | leer | optional (#37): Zertifikat und Schlüssel im Container (`/zert/…`, aus `./zert`); beide gesetzt: HTTPS, beide leer: HTTP |
| `BRUECKE_VAPID_SCHLUESSEL` | leer | optional (#37): privater VAPID-Schlüssel; gesetzt: Web-Push an, leer: aus |
| `BRUECKE_VAPID_KONTAKT` | `mailto:flottenbruecke@localhost` | optional: Kontakt, den der Push-Dienst sieht |
| `BRUECKE_TS_SCHLUESSEL` | leer | optional (#48): Auth-Key von Tailscale für den Fernzugriff |
| `BRUECKE_TS_NAME` | `flottenbruecke` | optional: Name der Brücke im Tailnet |

Unter Windows muss die Firewall den Port im privaten Netz zulassen, damit das Handy ihn erreicht.

## Meldungen: „Braucht dich“ am Rechner und auf dem Handy

Beides ist optional und getrennt abschaltbar (#37). Es meldet sich nur die Ebene „Braucht dich“: eine neue
offene Frage, eine neu blockierte oder abgebrochene Mission, je Ereignis einmal; mehrere aus demselben
Bericht des Treibers kommen als eine Meldung mit der Zahl. Inhalt nur Projektkürzel, Nummer, Art
(Frage/Blockade) und Titel (höchstens 60 Zeichen), nie Fragetext, Pfade oder Transkript. Ein schon
gemeldetes Ereignis klingelt nach einem Neustart von Treiber oder Brücke nicht erneut.

- **Am Rechner:** Der Treiber zeigt eine Windows-Meldung, auch wenn die Brücke in keinem Browser offen
  ist (oder gar nicht läuft). Schalter `meldung` des Treibers: Startparameter `--meldung an`, oder im
  Maschinenraum; Standard `aus` (`flotte/README.md`).
- **Auf dem Handy (Android):** Web-Push an die installierte Web-App, auch wenn sie geschlossen ist. Die
  Brücke braucht dafür HTTPS (Zertifikat aus mkcert) und einen VAPID-Schlüssel; ohne beide läuft sie
  unverändert über HTTP und spricht mit keinem Push-Dienst. Die Brücke schickt ausgehend an den
  Push-Dienst des Browsers (bei Chrome der von Google), Ende-zu-Ende verschlüsselt. Keine öffentliche
  Adresse: das Handy erreicht die Brücke im WLAN oder über den Fernzugriff. Ein Gerät meldet sich im
  Maschinenraum unter Einrichtung, „Meldungen auf diesem Gerät“ mit **Einschalten** an und mit **Abschalten** ab,
  beides als gekoppeltes Gerät. Ein Abo, das der Push-Dienst als abgelaufen meldet, löscht die Brücke selbst.
  Einrichten: [`INSTALL.md`](../INSTALL.md), „Optional: Meldungen“. iOS ist nicht geprüft.

## Fernzugriff (optional)

Unterwegs zeigt die Brücke die Lage über [Tailscale](https://tailscale.com) (#48, agent-skills/ADR-0006):
nur für Geräte im eigenen Tailnet, keine öffentliche Adresse, kein Port im Router. Der Zusatz ist ein
eigener Container im Compose-Profil `fernzugriff` und standardmäßig aus; `docker compose up -d` startet
wie bisher nur die Brücke. Mit `BRUECKE_FERNZUGRIFF=aus` (Arbeitsrechner) öffnet die Brücke den Eingang
dafür nicht; der Zusatz erreicht dann nichts.

**Einschalten** (einmal, im Ordner `flottenbruecke/`):

1. Im Tailscale-Admin unter DNS die HTTPS-Zertifikate einschalten (MagicDNS an), unter Settings → Keys
   einen Auth-Key erzeugen.
2. In `.env` eintragen (Vorlage in `.env.example`, auskommentiert): `BRUECKE_TS_SCHLUESSEL=<auth-key>`,
   wahlweise `BRUECKE_TS_NAME=<name>`. Der Schlüssel steht nur dort, nie im Repository.
3. `docker compose --profile fernzugriff up -d`

Die Brücke im LAN läuft dabei unverändert weiter. Der Container meldet sich mit dem Schlüssel einmal im
Tailnet an und merkt sich das Gerät im Volume `flottenbruecke_tailscale`; er startet mit dem Rechner
neu, bis er abgeschaltet ist. Die Seite liegt dann unter `https://<name>.<tailnet>.ts.net/`.

**Abschalten:** `docker compose --profile fernzugriff rm -sf tailscale`. Die Brücke im LAN bleibt.
Wer das Gerät ganz vergessen will: zusätzlich `docker volume rm flottenbruecke_tailscale` und das Gerät
im Tailscale-Admin entfernen.

**Handeln über den Fernweg (ADR-0007):** Tailscale reicht an einen eigenen Eingang der Brücke weiter
(Port 8001 im Container, auf dem Rechner nirgends veröffentlicht). Dort liefert die Brücke alles Lesende wie
im LAN und nimmt die Schreibwege der Person an, mit derselben Prüfung: Antworten, Handlungen, Werft,
Bereitschaftsraum, Web-Push, Koppeln und Not-Aus auslösen, jeweils von einem gekoppelten Gerät mit dem
Recht. Mit `403` abgelehnt bleiben die Wege von Treiber, Werft und Chat-Dienst (Bericht, Abholen,
Quittungen, Holodeck) und die des Rechners (Rechte, Entkoppeln, Not-Aus lösen). Das Cookie gehört zum
Namen der Seite: Ein Handy koppelt sich unter `https://<name>.<tailnet>.ts.net/` einmal neu, und der
Rechner gibt dem neuen Gerät unter `http://localhost:4748/` das Recht. Die Brücke erkennt den Fernweg am
Eingang, nicht an Absenderadresse oder Kopfzeilen; ein Gerät im LAN kann ihn nicht vortäuschen.

**Probe vom Handy:** WLAN aus, im Mobilfunknetz die Tailscale-App verbinden und
`https://<name>.<tailnet>.ts.net/` öffnen, beim ersten Senden mit Namen und PIN koppeln, am Rechner das
Recht geben. Danach handelt das Handy dort wie im WLAN.

## Bereiche und Navigation

Oben eine Zeile: Logo, die Befehlszeile (Strg+K, am Mac ⌘K), der Zähler „Braucht dich“ (auf jeder
Seite, rot pulsierend, solange etwas offen ist) und die Bereiche als Pillen. Auf dem Handy (bis
700 px) stehen die Pillen unten in Daumenreichweite, die Brücke trägt dort die Zahl.

- **Brücke** (`#bruecke`, Startseite) — das Board unten.
- **Holodeck** (`#holodeck`) — die Prototypen der Projekte, unten.
- **Frachtraum** (`#frachtraum`) — die Sternzeit-Notizen aller Projekte, unten.
- **Bereitschaftsraum** (`#bereitschaftsraum`) — der Chat, aus dem eine Mission entsteht, unten.
- **Sternenkarte** (`#sternenkarte`) — Projekte mit ihrem Backlog, unten.
- **Maschinenraum** (`#maschinenraum`), **Logbuch** (`#logbuch`) — siehe unten.

Bilder aller Bereiche mit den Beispieldaten aus `beispiel/`, je 1440 und 390 px breit: `doku/`.

Jeder Bereich hat eine Adresse zum Merken, die Zurück-Taste geht zum vorigen; eine unbekannte
Adresse zeigt die Brücke. Die Befehlszeile sucht und springt: Bereiche, Projekte und Missionen der
Tafel (Nummer oder Titel), mit Pfeiltasten, Enter und Esc. Eine Mission öffnet ihre Ebene und markiert
die Karte kurz. Ausführen kann sie nur Befehle der Bereiche (#47: `chat anlegen …`, unten
„Bereitschaftsraum“), und die gehen über dieselbe Anfrage wie ihr Knopf, mit Gerät und PIN.

Für Entwickler: Ein Bereich liegt in `app/static/bereiche/<bereich>.js` (und `.css`) und meldet sich
mit `huelle.bereich({ name, titel, zeichne(t, el), treffer(t, eingabe) })` an der Hülle (`huelle.js`) an.
`zeichne` läuft bei jedem Laden der Tafel, solange der Bereich sichtbar ist, `treffer` liefert
Einträge für die Befehlszeile; ein Eintrag mit `ausfuehren()` ist ein Befehl, prüft die `eingabe` selbst
und läuft nach dem Sprung. `huelle.springe(bereich, ziel)` springt wie ein Treffer der Befehlszeile
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
Angedockte Missionen gehören nicht in den Backlog; aufgegebene stehen am Ende als „aufgegeben“, solange ihr Issue offen
ist, mit „Neu einreihen“. Die Daten stehen im Bericht des Treibers
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
  Befehlszeile findet jede Notiz und jede Frage. Ein Haken je Notiz und „alle / keine“ je Thema und
  Projekt wählen die Notizen des nächsten Laufs: vorgewählt sind alle, auch eine neu hinzugekommene;
  die Wahl übersteht das Neuladen und gilt nur für den nächsten Start, danach ist wieder alles gewählt.
  Abgewählte bleiben unberührt mit ihrem Label für eine spätere Runde; nichts davon steht in der Forge.
  Die Lernvorschläge eines Sammel-Issues tragen dessen Nummer und haben einen gemeinsamen Haken.

**Triage-Lauf starten** je Projekt und **Triage-Lauf für alle**, nach einer Rückfrage, die die Wahl nennt:
Der Knopf heißt bei einer Teilwahl „Triage-Lauf starten (12 von 15)“ und ist bei keiner gewählten Notiz
gesperrt; „für alle“ nimmt je Projekt dessen Wahl, ein Projekt ohne gewählte Notiz bekommt keinen Lauf.
Der Treiber führt `flotte triage` aus (`flotte/README.md`, „Triage“), nur über die gewählten Notizen,
einen Lauf je Projekt zur Zeit. Jede Handlung braucht
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
   dann stoppt der Puls). Darüber sagt eine Zeile, was mit der Mission geschieht: Etikett (Arbeitet, Prüft,
   Wartet auf dich, Wartet, Gestoppt), ein Satz des Treibers mit Grund und „seit 42 min“; braucht es dich,
   steht darunter „Dein Schritt“ mit Link zur Frage, zum PR oder zu „Neu einreihen“ (Bild:
   [`doku/unterwegs-lage-1440.png`](doku/unterwegs-lage-1440.png)). Der letzte Schritt des Laufs und die
   Kontexte der Andockprüfung stehen dann in der aufgeklappten Leiste. Je Mission eine Segmentleiste der Missionsziel-Tickets mit „3 von 5 fertig“;
   antippen zeigt `#nr Titel · Stand`, jede Zeile verlinkt aufs Issue (im spec-Modus die Pakete des
   Laufs, `P1`, `P2` …, ohne Link). Läuft eine Andockprüfung, steht im Kopf des Laufs **Andockprüfung n**
   mit Start und Dauer, in der Andock-Schlange die des Treibers ebenso. Darunter eine Zeile **Bereit**,
   Missionen mit `prio/hoch` zuerst, mit dem Grund, wenn sie warten, und ab fünf gemessenen Missionen
   mit „voraussichtlich 3–5 h“. Je Mission dort „N Tickets“ mit derselben Segmentleiste; antippen klappt
   die Tickets mit Links auf (im spec-Modus vor dem Start keine).
   **Verbrauch** (Tag Q): Meldet der Treiber ihn, steht unter dem Titel jeder Karte unter *Unterwegs* eine
   Zahlzeile, z. B. `≈3,1 % Woche · K2 · 2,4 Mio Tok · Cache 92 %` (die Laufzeit steht darüber im Kopf):
   geschätzter Anteil am Wochenlimit, Konten, Tokens, Cache-Quote; der Tooltip schlüsselt Eingabe,
   Cache-Schreiben, Cache-Lesen, Ausgabe und die gewichtete Summe auf. ≈ geschätzt: Wochenanteil des Kontos geteilt durch die gewichteten Tokens aller Missionsläufe auf dem Konto in diesem Wochenfenster, mal die gewichteten Tokens der Mission; andere Arbeit auf dem Konto zählt mit, die Zahl liegt eher zu hoch.
   Markiert ab dem Doppelten des Mittels vergleichbarer abgeschlossener Missionen (gleiche Paketzahl ± 1, sonst alle) oder bei einer Cache-Quote unter 70 % (ab 500 000 Eingabe-Tokens):
   Dann wird die Zeile gelb und nennt den Grund, nichts hält an. Kein Geldwert. Ein älterer Treiber ohne
   `verbrauch`: keine Zeile. Bilder: [`doku/verbrauch-unterwegs-1440.png`](doku/verbrauch-unterwegs-1440.png),
   [`doku/verbrauch-unterwegs-390.png`](doku/verbrauch-unterwegs-390.png).
3. **Erledigt heute** (eingeklappt) — oben die Prognose „Backlog leer etwa …“ mit Trefferquote
   (Rechnung in `flotte/README.md`, „Prognose“), dann Angedocktes, Entscheidungen des Admirals mit „Zurücknehmen“,
   deine Antworten und Handlungen. Ein neues Andocken leuchtet einmal grün auf.

**Detailansicht einer Mission** (#51): Unter der Segmentleiste eines Laufs stehen **Plätze 3/3** (Pakete
in Ingenieur, Erster Offizier oder Nachbesserung gegen das Fenster des Projektadapters) und die Zahl der
**Neustarts** des Laufs; die Laufzeit ist der Knopf „läuft seit …“. In der aufgeklappten Paketliste
hat jedes Paket, zu dem der Treiber Agent-Aufrufe im Protokoll des Laufs sah, eine zweite Zeile:
Phase (Ingenieur, Erster Offizier, Nachbesserung, Andocken) mit Dauer in der Phase, Dauer gesamt, Runde, Stufe
(eine Eskalation als „Standard → Urteil“) und die Uhrzeit des Lebenszeichens. „länger als üblich“
(ruhig, kein Rot) erscheint, wenn ein laufendes Paket länger als das 1,5-Fache des Medians der
fertigen Pakete des Projekts läuft, ab drei fertigen; die Brücke rechnet es selbst. Fehlt ein Feld
(älterer Treiber, Paket ohne Aufruf), bleibt es weg; spec-Pakete haben sie wie Missionsziele (#151).
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

**Verlauf mitlesen** (Tag J): Ein Klick auf eine Karte unter *Unterwegs* (oder ihr Knopf „Verlauf ›“)
öffnet rechts eine Schublade mit dem Verlauf der Mission: was der Lauf sagt, je Werkzeug eine Zeile in
Klartext (Lesen, Tests, Andockprüfung …) mit Ziel und Dauer, Subagenten als aufklappbare Gruppen mit Rolle
und Paket, Fragen und Entscheidungen hervorgehoben; der rohe Befehl nur hinter „Befehl zeigen“. Die Tafel
bleibt daneben klickbar, ‹ › und die Pfeiltasten wechseln die Mission, Esc schließt, „Weit“ nimmt die
ganze Breite, Filter und „Mitlaufen“ stehen im Kopf ([`doku/verlauf-schublade-1440.png`](doku/verlauf-schublade-1440.png)).
Auf dem Handy schiebt sich ein Blatt von unten hoch, Neuestes oben, Reiter Verlauf · Pakete ·
Entscheidungen ([`doku/verlauf-blatt-390.png`](doku/verlauf-blatt-390.png)). Lesen darf jedes gekoppelte
Gerät, auch über den Fernweg; Werkzeugausgaben kommen nie auf die Brücke, Geheimnisse sind maskiert
(`SCHNITTSTELLE.md`, Abschnitt 5a).
Im Kopf von Schublade und Blatt steht der **Verbrauch** der Mission (Tag Q): die Summenzeile wie auf der
Karte (gelb mit Grund, wenn markiert), aufgeklappt eine kleine Tabelle je Paket und Rolle mit ≈Wochenanteil,
Tokens (Tooltip: Aufschlüsselung) und Cache-Quote; Paket leer heißt ganze Mission, der Orchestrator steht
als „Orchestrator (Lagebesprechung, Andocken)“. Bilder: [`doku/verbrauch-verlauf-1440.png`](doku/verbrauch-verlauf-1440.png),
[`doku/verbrauch-verlauf-390.png`](doku/verbrauch-verlauf-390.png).

## Holodeck

Je Projekt ein fester Ordner mit Prototypen: `prototypen/` in der Repo-Wurzel, anders mit dem
Adapterschlüssel `prototype_dir` in `.claude/epic.md`. Jede HTML-Datei direkt darin (keine
Unterordner, höchstens 50, je höchstens 2 MB) erscheint als Kachel mit Titel (`<title>`), Projekt,
Datum und Vorschau, gruppiert und filterbar nach Projekt; die Befehlszeile findet sie auch. Antippen
öffnet den Prototyp in einem Rahmen, wahlweise als **Schreibtisch** (volle Breite) oder **Telefon**
(390 px breit). **Rückmeldung an den Chat** (#47) schickt den Text als Nachricht
`Rückmeldung zu Prototyp <owner/name>/<datei>: …` in einen offenen Chat des Bereitschaftsraums (Chats
des Projekts zuerst; Gerät und PIN wie beim Schreiben dort); **Rückmeldung kopieren** legt den Anfang
in die Zwischenablage. Die Brücke ändert keine Datei des Prototyps.

Die Vorschau ist der Prototyp selbst, verkleinert in einem Rahmen ganz ohne Skripte
(`sandbox=""`, `loading="lazy"`): kein Bilderdienst, kein Bildschirmfoto-Schritt; ein Prototyp, der
erst per Skript zeichnet, bleibt in der Vorschau leer und läuft erst in der Ansicht.

**Sicherheitsmodell:** Der Treiber liest nur Dateien direkt im freigegebenen Ordner (keine
Verknüpfungen, kein Weg hinaus) und schickt nur Dateinamen und Inhalte, keine Pfade; die Brücke
liefert nur, was sie gespeichert hat, und kennt kein Dateisystem der Projekte. Jeder Prototyp läuft
in einem opaken Ursprung (`Content-Security-Policy: sandbox allow-scripts` und
`<iframe sandbox="allow-scripts">`, beide ohne `allow-same-origin`): Er sieht weder den localStorage
noch Cookies und kann die Brücken-API weder lesen noch, ohne PIN, etwas auslösen;
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
Senden fragt die Seite die PIN ab; das Gerät behält sie nicht (#46, unten „Geräte“).

Bis der Treiber die Antwort abholt, lässt sie sich ändern; danach steht „Angekommen, Lauf setzt
fort“. Der Treiber behandelt sie wie `flotte antworten`, kommentiert am Issue mit der Herkunft
„Mensch über die Brücke“ und quittiert sie.

## Handlungen

Eine Blockadekarte zeigt Grund, Lage und auf Wunsch das Log der Mission. Dazu zwei Handlungen mit
PIN, die der Treiber im nächsten Takt abholt und ausführt:

- **Neu einreihen** — Zähler zurück; der Lauf setzt fort und erfährt den Grund der Blockade.
- **Aufgeben** — nach einer Rückfrage: Die Mission wird `abgebrochen` und nicht mehr gestartet, bis sie in der
  Sternenkarte neu eingereiht wird. Branch, Pull Request und Issue bleiben.

**Zurücknehmen** in der Detailansicht der Mission (und für die Entscheidungen des Admirals von heute
auch in „Erledigt heute“) widerruft eine Entscheidung des Admirals oder deine eigene Antwort bis zum
Andocken: Du schreibst die neue Entscheidung, der Treiber kommentiert sie am Issue und gibt sie dem Lauf.
Beide Stellen teilen sich Formular und Entwurf.

Ansehen ist im LAN (und über den Fernzugriff) frei, Antworten und Handlungen nur im LAN von einem
gekoppelten Gerät mit dem passenden Recht (unten „Geräte“). Fünf falsche PINs (beim Koppeln oder am Rechner) sperren für fünf
Minuten (je Absenderadresse; hinter Docker Desktop teilen sich oft alle Geräte eine).

## Geräte, Rechte und Not-Aus (#46)

Wer schreibt, braucht ein **gekoppeltes Gerät** mit dem passenden Recht. Die **PIN** braucht es nur zum
Koppeln und am Rechner (Rechte, Entkoppeln, Not-Aus lösen); ein Gerät mit Recht antwortet und handelt
ohne sie (Stefan, 24.11.2026: die PIN bei jedem Schalter war zu viel). Die PIN allein reicht nicht: Ohne
gekoppeltes Gerät geht nichts.

- **Koppeln:** Beim ersten Senden fragt ein unbekanntes Gerät nach Namen und PIN (oder oben im
  Maschinenraum **Koppeln**). Die Brücke gibt ihm einen zufälligen Schlüssel als Cookie
  (HttpOnly, Secure, SameSite=Strict, 400 Tage) und speichert nur dessen Hash. Weil das Cookie `Secure`
  ist, geht Koppeln nur über HTTPS (Zertifikat aus mkcert, oben) oder am Rechner über `localhost`.
- **Rechte je Gerät:** ansehen (immer), **Antworten** (Fragen, Bereitschaftsraum, Web-Push), **Handeln**
  (alle Handlungen, Werft, Missionen aus dem Bereitschaftsraum anlegen). Ein neues Gerät darf ansehen und
  antworten, nicht handeln.
- **Nur der Rechner vergibt Rechte:** Die Brücke hat dafür einen eigenen Eingang, den compose nur auf
  `127.0.0.1` veröffentlicht (`http://localhost:4748/`, Port aus `BRUECKE_RECHNER_PORT`). Dort zeigt der
  Maschinenraum unter Einrichtung je Gerät **Antworten geben/nehmen**, **Handeln geben/nehmen** und **Entkoppeln**, jeweils
  mit PIN. Aus dem LAN lehnt die Brücke das mit `403` ab; sie erkennt den Rechner am Eingang, nicht an
  der Absenderadresse, und nimmt dort nur den Namen `localhost`, `127.0.0.1` oder `[::1]` an (keine fremde
  Seite, die ihren Namen auf den Rechner umbiegt). Ein entkoppeltes Gerät ist sofort unbekannt (`401`) und muss neu koppeln.
- **Not-Aus:** Jedes gekoppelte Gerät löst ihn im Maschinenraum aus, ohne PIN und ohne Recht. Danach
  lehnt die Brücke jede Antwort, Handlung und Kopplung ab (`423`), auch nach einem Neustart, bis der
  Rechner ihn über seinen Eingang mit PIN löst. Oben steht solange rot „Not-Aus“. Die Treiber laufen
  weiter, bekommen aber nichts mehr ausgeliefert, auch nicht, was vor dem Not-Aus abgeschickt war; das
  geht erst nach dem Lösen hinaus.
- **Origin:** Eine schreibende Anfrage, deren `Origin` nicht die Brücke selbst ist (eine fremde Seite,
  ein Prototyp im Holodeck), bekommt `403`. Der Treiber schickt keinen `Origin` und weist sich weiter mit
  `X-Bruecke-Token` aus.
- **Logbuch:** Jede Antwort und Handlung steht mit Gerät, Zeit und dem Befehl, wie er ankam, im Logbuch
  der Brücke (Art „Gerät“), ebenso Koppeln, Rechte, Entkoppeln und Not-Aus. Jede Handlung, die der
  Treiber ausführt, steht dazu mit Gerät und Zeit im Flottenlogbuch.
- **PIN je Handlung:** Die Seite behält die PIN nicht auf dem Gerät, nur eine halbe Minute im Speicher der
  offenen Seite, damit eine Handlung aus mehreren Anfragen nicht mehrmals fragt.
- **Fernweg:** Über Tailscale (unten) bleibt alles Ansicht: dort lässt sich weder koppeln noch handeln.

Bilder: [Geräte im LAN](doku/maschinenraum-einrichtung-1440.png) ([390](doku/maschinenraum-einrichtung-390.png)),
[am Rechner](doku/maschinenraum-einrichtung-rechner-1440.png) ([390](doku/maschinenraum-einrichtung-rechner-390.png)),
[Koppeln](doku/v3-geraet-koppeln-390.png), [Logbuch](doku/v3-logbuch-geraete-1440.png).

## Maschinenraum und Logbuch

- **Maschinenraum** (`#maschinenraum`, #242): oben immer „Dieses Gerät“ mit Name und Rechten (ungekoppelt:
  **Koppeln**) und **Not-Aus**, nach dem Auslösen rot „Not-Aus seit …“; ohne PIN steht dort einmal, dass die Knöpfe
  abgeschaltet sind. Darunter drei mitlaufende Unterreiter mit eigenem Anker: **Betrieb**
  (`#maschinenraum/betrieb`, auch ohne Unteranker), **Einstellungen** (`#maschinenraum/einstellungen`, mit der Zahl
  offener Entwürfe) und **Einrichtung** (`#maschinenraum/einrichtung`). Fehlt noch ein Konto, eine Anmeldung, die
  Forge oder ein Projekt, öffnet die Brücke ohne Anker in der Adresse die Einrichtung; ist alles da, startet sie
  auf der Brücke. Der Fuß `B … · T …` führt zum Banner (neuer Stand) oder zum Stand in der Einrichtung. Jeder
  Hinweis ist ein Satz; mehr steht hinter ⓘ (antippen) oder „Mehr“. Alles stammt aus dem Bericht; was er nicht
  trägt, heißt „nicht gemeldet“.
- **Betrieb:** Meldet ein Treiber einen neueren Commit auf `main` seiner Quelle (höchstens alle 15 Minuten
  geprüft), steht oben das Banner „Neuer Stand verfügbar …“ mit **Einspielen und Treiber neu starten** (bei
  mehreren Treibern: alle). **Eine Karte je Konto**: Name und Farbe aus `~/.claude/flotte/konten.json`, Konto und
  Rechner, die Tanks Hauptenergie und Reserveenergie („… % übrig“, Reset mit Wochentag ab 20 h), der
  **Vorsprung** in der Reserveenergie (danach wählt der Treiber das Konto einer neuen Mission; Erklärung und
  Verbrauchsschätzung hinter ⓘ), Bremse mit Grund (`grund`, nur bei `gelb`/`rot`, sonst „keine“) und Alter des
  Werts, Anmeldung (`kontenListe`, #95), zugeklappt die **Missionen** des Kontos (Tag Q: heute und seit Beginn
  des Wochenfensters, `#491 heute ≈1,2 % · 1,2 Mio Tok Woche ≈3,1 % · 2,4 Mio Tok`, bei mehreren Projekten mit
  dem Projektnamen) und die Knöpfe **Am Rechner anmelden** (nur wenn nicht angemeldet) und
  **Deaktivieren**/**Aktivieren** (#96), als Handlung an den Treiber, bis zur Quittung „wartet auf den Rechner“.
  **Eine Zeile je Rechner**: RAM, Platte, Obergrenze (Läufe gleichzeitig), eine Bremse farbig. **Eine Karte je
  Projekt**: Repository, Rechner, Takt und letzter Bericht; die **Forge** als eine Zeile (#125, „GitHub · als …
  · Schreiben“), **Am Rechner verknüpfen** nur, wenn Anmeldung oder Schreibrecht fehlt (der Rechner öffnet ein
  Terminal mit `gh auth login` bzw. fragt Benutzer und Token für den Git-Credential-Speicher ab; kein Token geht
  durch die Brücke); Lücken des Adapters („Dein Schritt: Adapter ausfüllen (in einem eigenen Chat)“, bis dahin
  startet dort keine Mission); der Halt der Andock-Schlange nach rotem Nachtlauf und der letzte Nachtlauf; die
  Schalter **Einsammeln** (#193: der Treiber sammelt freigegebene Missionen selbst ein; Ausschalten hält nichts
  an) und **Lernschleife** (Tag O: ab Werk aus, auch für ein neu hinzugefügtes Projekt; an schreibt nach jedem
  Andocken höchstens drei belegte Vorschläge an das `lern_issue` des Projekts, der Triage-Lauf entscheidet sie,
  der Frachtraum zeigt sie; nennt der Adapter kein `lern_issue`, ist der Schalter gesperrt und nennt sichtbar
  den Grund), beide als `einstellen`, wirksam ab dem nächsten Takt; die Zahl laufender, wartender und
  freigegebener, noch nicht eingesammelter Missionen; die letzten drei Andockprüfungen des Treibers (Ergebnis,
  Dauer, Anteil aus dem Cache), der Rest unter „Mehr“. Meldet eine **Werft** (`flotte werft`,
  agent-skills/ADR-0005), folgt je Repository und Rechner ihr Stand (Commit, geprüft, Abstand) und je Stack eine
  Karte (#90) mit gezogenem Commit, Zeit und Marke (grün, rot, wartet, aus), bei rot das letzte Protokoll
  aufgeklappt, dazu **Jetzt nachziehen** und, nur wenn die Arbeits-Migration auf die Freigabe wartet,
  **Arbeits-Migration freigeben** (mit Rückfrage, gebunden an Commit und Sicherung); ist sie gesperrt oder rot,
  ist „Jetzt nachziehen“ der Hauptknopf: es nimmt eine neue Sicherung. Die Brücke ruft die Werft nie auf, die
  Werft holt im nächsten Takt (15 s) ab, bis dahin „wartet auf die Werft“.
  Bilder: [`doku/maschinenraum-betrieb-1440.png`](doku/maschinenraum-betrieb-1440.png),
  [`doku/maschinenraum-betrieb-390.png`](doku/maschinenraum-betrieb-390.png).
- **Einstellungen** (#59): die übrigen wirksamen Werte der Treiber (ohne Einsammeln und Lernschleife) als
  kompakte Zeilen mit Name, Wert und Herkunft (Start, Brücke, Standard) in Gruppen: **Kapazität**
  (Missionen gleichzeitig, Pakete je Mission, Konten, Admiral-Konto), **Bremsen** (Gelb, Rot, Leerfahren,
  RAM-Schwelle, Plattenminimum, Leerlauf), **Andocken und Modelle** (Andocken, Modell der Triage, Modell des
  Admirals, Dateizugriffe der Triage), **Meldung**; dazu je Repository eine Gruppe **Werft** (an/aus, Stacks,
  Abfrageabstand, Test-Migration selbst). Mit mehreren Treibern steht jeder Wert einmal für alle. Antippen öffnet
  das passende Bedienelement mit einem Satz Hilfe und „wirksam seit …“; eine Wahl ist ein Entwurf (gold). Eine
  feste Leiste unten nennt alle Entwürfe und schickt sie mit **n Änderungen übernehmen** zusammen ab, je Entwurf
  die Handlung `einstellen` an jeden Treiber (bzw. an die Werft) wie bisher (Grenzen aus dem Bericht, `422`
  darüber hinaus); **Verwerfen** nimmt alle zurück. „Wartet auf den Treiber“ und „unterschiedlich je Treiber“
  stehen an der Zeile; eine unterschiedliche Zeile lässt sich auch mit demselben Wert angleichen. Änderungen
  gelten ab dem nächsten Takt, nichts Laufendes bricht ab, und stehen im Logbuch. Ein älterer Treiber ohne
  `einstellungen`: nur lesend mit Hinweis. Andocken (#112) verschärft nur: „automatisch“ steht nur zur Wahl, wenn
  der Adapter `merge: nach_gate` sagt, sonst nennt die Zeile den Grund. Die Andock-Regel des Adapters, Rechte,
  Geheimnisse gibt es hier nicht.
  Bilder: [`doku/maschinenraum-einstellungen-1440.png`](doku/maschinenraum-einstellungen-1440.png),
  [`-390.png`](doku/maschinenraum-einstellungen-390.png), mit zwei Entwürfen
  [`doku/maschinenraum-einstellungen-entwurf-1440.png`](doku/maschinenraum-einstellungen-entwurf-1440.png),
  [`-390.png`](doku/maschinenraum-einstellungen-entwurf-390.png).
- **Einrichtung:** die Schritte **Einrichten** (Konto anlegen → am Rechner anmelden → Forge verknüpfen →
  Projekt hinzufügen, je offen / wartet auf den Rechner / fertig; fertige klappen zu, ist alles fertig, die ganze
  Liste). **Projekt hinzufügen** (#126) mit **Link zum Repository** (nur `https://` auf github.com oder die
  Gitea-Forge eines Projekts; der Rechner klont mit seiner eigenen Anmeldung in den vorgeschlagenen, änderbaren
  Ordner, prüft Rechte und Labels und nennt, was zum Einrichten fehlt) oder dem Ordner am Rechner, dem Schalter
  **Autostart beim Anmelden** und, bei mehreren laufenden Treibern, der Wahl „am Rechner des Treibers von“: Der
  Treiber legt den Adapter aus der Vorlage an, wenn er fehlt, und das Startskript
  `~/.claude/flotte/start/<name>.ps1`; das Projekt bekommt einen eigenen Treiber, der mit Autostart bei der
  nächsten Anmeldung oder von Hand über das Startskript startet, sein erster Bericht legt das Projekt an (der
  Rest unter „Mehr“). Meldet sich kein Treiber, nennt die Seite den Weg am Rechner (`flotte projekt
  hinzufuegen`). **Konten und Projekte verwalten:** **Konto anlegen** je Rechner und **… entfernen** je Projekt
  (der Treiber hält an wie `flotte anhalten`, das Projekt verschwindet aus der Liste, gelöscht wird nichts; eine
  geplante Aufgabe „Flotte <name>“ startet ihn bei jeder Anmeldung wieder, abschalten in der Aufgabenplanung).
  **Geräte** (#46, siehe „Geräte, Rechte und Not-Aus“) mit ihren Rechten, am Rechner mit **Antworten/Handeln geben/nehmen**, **Entkoppeln**
  und **Not-Aus lösen**. **Meldungen auf diesem Gerät** (#37). **Stand** (#154): die Brücke mit Commit und Datum
  ihres Images, je Treiber Commit und Datum des installierten Skill-Satzes, wann er eingespielt wurde und wann er
  startete, ein neuerer Stand in Gold, je Treiber **Einspielen und Treiber neu starten** und bei mehreren
  **Einspielen und alle Treiber neu starten** (nach einer Rückfrage). Die Brücke legt nur die Handlung ab
  (agent-skills/ADR-0005): Der Treiber hält an, wartet ein offenes Andocken ab („Wartet auf das Andocken von
  #…“), spielt `main` ein, baut die Brücke neu, wenn sich `flottenbruecke/` geändert hat, und startet mit
  derselben Kommandozeile neu; laufende Läufe übernimmt er. Ablauf: `flotte/README.md`, „Anhalten und neu
  starten“. Ein älterer Treiber ohne Stand: „einspielen von Hand“.
  Bilder: [`doku/maschinenraum-einrichtung-1440.png`](doku/maschinenraum-einrichtung-1440.png),
  [`-390.png`](doku/maschinenraum-einrichtung-390.png), am Rechner
  [`doku/maschinenraum-einrichtung-rechner-1440.png`](doku/maschinenraum-einrichtung-rechner-1440.png),
  [`-390.png`](doku/maschinenraum-einrichtung-rechner-390.png).
- **Logbuch** (`#logbuch`): Ereignisse der Treiber, Entscheidungen des Admirals und Handlungen des
  Menschen in einer Liste, neueste oben, filterbar nach Mission und Art (Ereignis, Admiral, Mensch). Die
  Tafel hält 40 Ereignisse und von den Entscheidungen nur die von heute; ältere gibt es hier nicht. Das
  Feld „Logbuch“ im Fuß und „Alle im Logbuch“ unter dem Laufband führen hierher.
  Die Endsumme einer abgeschlossenen Mission schickt der Treiber als Ereignis „Verbrauch der Mission: …“
  (Bilder: [`doku/verbrauch-logbuch-1440.png`](doku/verbrauch-logbuch-1440.png), [`doku/verbrauch-logbuch-390.png`](doku/verbrauch-logbuch-390.png)).

## Bereitschaftsraum

Der Chat der Brücke (#85, agent-skills/ADR-0004): ein Gespräch über ein Repository, aus dem eine
Mission, ein Missionsziel oder nichts entsteht. Die Brücke startet kein `claude`; der Dienst
`flotte chat --repos <ordner> --bruecke <url>` auf einem Rechner holt die Nachrichten, führt je Chat
eine fortgesetzte Sitzung auf dem gewählten Konto und antwortet (`SCHNITTSTELLE.md`, Abschnitt 8). Die
Brücke speichert nur Nachrichten, Antworten und Stand, keine Anmeldedaten.

- **Chats je Repository** mit Stand: offen, gestoppt, angelegt (nach erfolgreichem Anlegen, mit Links auf die
  angelegten Issues), verworfen (ein Klick hier, beim Dienst kommt davon nichts an).
- **Stoppen, Fortsetzen, Archivieren** (#47): Gestoppt bekommt kein Rechner eine Nachricht des Chats,
  bis er fortgesetzt ist. Archivieren blendet einen Chat aus der Liste aus (ein offener wird dabei
  gestoppt); „Archiv (n)“ zeigt sie wieder, „Aus dem Archiv“ holt einen zurück. Stand und Archiv
  überstehen einen Neustart der Brücke.
- **Befehlszeile:** `chat anlegen [repo] <text>` („chat“ ganz, von „anlegen“ genügen drei Buchstaben; ein `owner/name`, das kein Projekt der Brücke ist, ergibt keinen Befehl) füllt „Neuer Chat“ und schickt
  ihn mit Text gleich ab, wie der Knopf mit Gerät und PIN; ohne Text landet der Cursor im Feld.
- **Neuer Chat**: Repository (`owner/name`), Konto aus den Konten, die die Dienste melden, Modell
  (Standard `claude-opus-5-5`), erste Nachricht. Das Konto steht fest, sobald der Chat eine Sitzung hat
  (dann gehört er dem Rechner, der zuerst eine Sitzung brachte); das Modell lässt sich jederzeit ändern.
- **Fragekarten** der letzten Antwort als Knöpfe; die Wahl geht mit dem Freitext als eine Nachricht
  zurück (`Q1 A`, bei Mehrfachwahl `Q2 A, C`).
- **Entwurf** mit „Anlegen“ (als Sternzeit-Notiz, `needs-triage`) und „Anlegen und starten“ (dazu Warp frei), nach einer
  Rückfrage. Angelegt wird wörtlich der Entwurf der letzten Antwort, die ihn brachte; kam inzwischen ein
  neuerer oder wartet eine Nachricht noch, lehnt die Brücke ab.

Schreiben braucht ein gekoppeltes Gerät, „Anlegen“ das Recht Handeln (oben „Geräte“); ohne
gesetzte PIN ist Schreiben abgeschaltet. Ansehen ist frei im LAN.

## Aktualisieren

Am einfachsten über den Knopf im Maschinenraum (#154: Banner unter Betrieb oder Stand unter Einrichtung). Von Hand: `git pull`, dann
`docker compose up -d --build` im Ordner; mit Stand im Maschinenraum (PowerShell):
`$env:BRUECKE_COMMIT = git rev-parse HEAD; $env:BRUECKE_DATUM = git log -1 --format=%cI; docker compose up -d --build`.
Ohne die beiden Werte zeigt die Brücke ihren Stand nicht und das nächste Einspielen baut sie neu. Das Volume bleibt; v2 legt auf einem
v1-Volume nur die Tabelle `handlungen` an und nimmt weiter Berichte eines älteren Treibers an, v3
ebenso die Tabelle `prototypen`, die Meldungen (#37) die Tabellen `push_abos` und `gemeldet`, der Bereitschaftsraum die Tabellen `chats`,
`chat_nachrichten` und `chat_rechner`.

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

Backend: FastAPI (`app/main.py`), Board-Logik `app/tafel.py`, Speicher `app/speicher.py`, Web-Push
`app/meldung.py`, Start mit HTTP oder HTTPS samt den Eingängen für den Fernzugriff und den Rechner (#46) `app/start.py`.
Frontend ohne Build: `app/static/`.
