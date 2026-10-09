# agent-skills

Dieses Repository ist die versionierte Quelle für Claude-Code-Skills, die bisher nur lokal
unter `~/.claude/skills` lagen. Änderungen laufen ab jetzt über dieses Repo, nicht mehr direkt
am lokalen Ordner.

## Der Ablauf

![Schienenplan: grill-with-docs klärt Plan und Fachsprache; to-spec oder to-tickets schneiden daraus ein Epic; du gibst es mit ready-for-agent frei, beantwortest am Vorab-Tor einmal alle Fragen und mergst am Ende den Pull Request; dazwischen setzt /epic die Pakete um; danach schließen /epic-nacharbeit und /epic-aufraeumen ab. Darunter die Spuren in Gitea und KIBO: Labels, Statuslabels, Kommentare, Lauftafel, erledigte Tickets.](assets/prozess/prozess.png)

Die orangen Halte sind die drei Stellen, an denen ein Mensch entscheidet. Dazwischen läuft alles
ohne Rückfrage; den Stand zeigen Gitea und KIBO. Quelle und Rendern des Bildes:
[`assets/prozess/`](assets/prozess/README.md).

## Enthaltene Skills

- **epic** — Ein Epic samt Kind-Tickets, oder ein Spec-Issue mit sieben Abschnitten
  (`issue_form: tickets` / `spec`), auf einem Epic-Branch abarbeiten: Graph planen, bis zu drei Pakete
  parallel in eigenen Worktrees umsetzen, jedes abgenommene Paket sofort in den Epic-Branch
  mergen, mit offenem Pull Request enden. Für Gitea, GitHub und GitLab.
- **epic-nacharbeit** — Die offenen Punkte eines abgeschlossenen `/epic`-Laufs abarbeiten:
  Fragerunden im Frontier-Verfahren, je Punkt entscheiden ob er in diese Sitzung passt oder ein
  Ticket braucht, dann umsetzen und nachdokumentieren. Legt keine Issues ohne ausdrückliche
  Entscheidung an.
- **epic-aufraeumen** — Nach dem Merge des Pull Requests eines `/epic`-Laufs aufräumen: den
  Basiszweig des Pull Requests holen, ohne das Hauptverzeichnis umzuschalten, dann Epic-Worktree,
  Epic- und Ticket-Branches sowie Worktree-Reste nach Prüfung entfernen. Löscht nichts, dessen Commits nicht nachweislich im Basiszweig liegen.

- **epic-flotte** *(optional)* — Leitstand über den drei anderen: wählt die Epics, die
  gleichzeitig laufen dürfen, startet je Epic einen Lauf als Hintergrund-Subagenten, zeigt die
  Lauftafeln im Browser, entscheidet Tor- und Nacharbeitsfragen im Rahmen seines
  Entscheidungsrechts selbst und stößt danach Nacharbeit und Aufräumen an. Mergt nie.

Die drei Skills gehören zusammen: `epic-nacharbeit` und `epic-aufraeumen` setzen einen `/epic`-Lauf
voraus und verweisen im Text aufeinander. Alle drei kennen beide Modi (`tickets` mit Kind-Tickets,
`spec` mit oder ohne Kinder) und erwarten im jeweiligen Zielrepo eine projektlokale Adapterdatei
`.claude/epic.md`. Der verbindliche Vertrag für deren Schlüssel — welche es gibt, was sie
bedeuten, was gilt, wenn einer fehlt — steht in [`epic/references/adapter.md`](epic/references/adapter.md).

Bis Oktober 2026 hießen die Skills `prd`, `prd-nacharbeit`, `prd-aufraeumen` und `prd-flotte`, die
Adapterdatei `.claude/prd.md` und der Modus `tickets` hieß `prd`. Die alten Adapter werden
weiter gelesen; das Vorab-Tor erinnert ans Umbenennen. Die Begriffe stehen in [`CONTEXT.md`](CONTEXT.md).

## Mehrere Epics gleichzeitig: `/epic-flotte`

![Flottenbild: /epic-flotte, der Admiral mit Zufallsnamen, startet drei /epic-Läufe A bis C nebeneinander; ein vierter wartet, bis ein Platz frei wird. Jeder Lauf fragt am Vorab-Tor den Admiral, endet mit offenem Pull Request, durchläuft /epic-nacharbeit, wartet auf deinen Merge und endet mit /epic-aufraeumen. Darunter die Kollisionsstufen (keine 4, klein 3–4, mittel 2, groß 1 gleichzeitig) und das Entscheidungsrecht des Admirals (selbst, mit Präzedenz, immer du).](assets/flotte/flotte.png)

Optional, für den Fall, dass mehrere freigegebene Epics bereitliegen, etwa beim Aufsetzen eines
neuen Projekts. Ohne ihn laufen die drei Skills wie bisher in je einem eigenen Chat.

- **Der Admiral** zieht zu Beginn per Zufall einen Namen aus der Sternenflotte und unterschreibt
  damit seine Forge-Kommentare. Er implementiert nicht und mergt nie.
- **Läufe sind Subagenten**, keine Chats. Fragen beantworten sie nicht selbst, sondern beenden
  ihren Zug mit einem `FLOTTE-FRAGE`-Block; der Admiral antwortet und sie setzen fort. Ihre
  Implementer laufen im Vordergrund, in Wellen statt im gleitenden Fenster, weil ein Subagent die
  Fertig-Meldung eigener Hintergrund-Agenten nicht hört.
- **Laufende Chats** mit `/epic` übernimmt er, statt sie neu zu starten: er überwacht sie,
  antwortet und stößt Nacharbeit und Aufräumen dort an. Dafür gibst du ihn in jedem Chat einmal
  selbst frei.
- **Flottenlogbuch:** Den Stand schreibt der Admiral zusätzlich in ein dauerhaft offenes Issue mit
  dem Label `flotte`. KIBO zeigt daraus Flottenabzeichen, Flottenband, Entscheidungen und Erfolge.
- **Verbrauchsbremse:** Der Admiral liest das 5-Stunden- und das Wochenlimit und rechnet hoch.
  Bei Gelb startet er nichts Neues, bei Rot pausieren die Läufe nach der laufenden Welle bis zum
  Reset. Dafür melden sich die Läufe nach jeder Welle mit `FLOTTE-WELLE`.
- **Wie viele gleichzeitig**, entscheidet die Kollisionsstufe des schlechtesten Paares, höchstens
  vier. Die Grenzen zwischen den Stufen sind noch Entwurf.
- **Entscheidungsrecht:** Der Admiral entscheidet selbst, was eine Herkunft hat (Empfehlung des
  Skills, Präzedenz in diesem oder einem anderen Projekt) und folgenlos aufhebbar ist. Jede solche
  Entscheidung steht mit Herkunft in der Forge. Regeln lockern, Produktivdaten, fehlende Zugänge,
  Merge und Remote-Löschungen bleiben bei dir.

Quelle und Rendern des Bildes: [`assets/flotte/`](assets/flotte/README.md).

Für die Skills davor (`grill-with-docs`, `to-spec`, `to-tickets` aus dem Plugin
`mattpocock-skills`) liegt hier keine Kopie, sondern die Einrichtung für unser Gitea:
[`mattpocock-skills/`](mattpocock-skills/README.md).

## Plugin: `agentenflotte`

![Agentenflotte über der Eingabezeile in Alarmstufe Gelb: ein Konsolenrahmen mit gelber Kappe und Dienstliste, in der Mitte rechts das Flaggschiff der Hauptsitzung, links davon in drei Spuren die Subagenten eines /epic-Laufs — Haiku-Shuttles als Kundschafter, Sonnet-Kreuzer als Implementer und Reviewer, Opus-Schiffe für Urteilspakete, eines mit Schild bei höchster Denkstufe —, unten je Subagent eine Pille mit Station und Aufgabe. Ein Reviewer wartet mit gelbem Ausrufezeichen auf Freigabe.](assets/agentenflotte/vorschau.png)

Ein Claude-Code-Mod, der die Sitzung zur Schiffsbrücke macht. Laufende Subagenten fahren als
Pixel-Raumschiffkonvoi über der Eingabezeile, angeführt vom Flaggschiff der Hauptsitzung:
Schiffsklasse = Modell, Warpfaktor = Denkstufe (Warp 2 bis 9,9). Übernommen aus
[interias/agentenflotte](https://github.com/interias/agentenflotte); braucht Claude Code mit
Mod-Unterstützung (getestet mit 2.1.293, die Desktop-App bringt sie mit).

- **Band:** Konsolenrahmen mit Dienstliste und Datenkaskade; Alarmfarbe in der Kappe.
- **Alarmstufen:** Gelb = ein Subagent wartet auf Freigabe, Rot = Fehler oder Ausfall, Blau =
  weniger als 20 % Kontext übrig oder Komprimierung.
- **Brücke:** Spinner-Wörter, Stationsetiketten an Werkzeugzeilen (Sensorscan, Archiv,
  Maschinenraum …), „Unter Warp“-Zeile, Statuszeile mit Sternzeit, Warp, Schilden und Flotte,
  Modus-Etikett, Hinweis unter Freigabe-Dialogen und Rufe, wenn ein Subagent zurückkehrt.
- **Logbuch:** eine Zeile nach jeder Antwort, wenn Subagenten etwas getan haben; `/logbuch` zeigt
  die letzten zehn Einträge, `/logbuch alle` die letzten fünfzig.
- **Bordcomputer:** Nachrichten mit „Computer,“ am Anfang werden knapp und sachlich beantwortet,
  nie bei Code, Commits, Tickets oder Berichten an Dritte. Standardmäßig aus.
- **Taktisches Display:** `/taktik` öffnet oder schließt das Pane: am Desktop ein Radar der
  Flotte mit Stationsliste, im Terminal eine Textfassung je Station.

Schalter (bleiben über Sitzungen erhalten):

| Befehl | Wirkung |
|---|---|
| `/flotte` | Hauptschalter: ganzen Mod aus- oder einblenden |
| `/flotte status` | Hauptschalter und alle Teile anzeigen |
| `/flotte <band\|bruecke\|logbuch\|computer> [an\|aus]` | einen Teil schalten |

Den ganzen Mod ausschalten: `/plugin`, agentenflotte wählen, Disable — oder
`claude plugin disable agentenflotte@breuckmann-agent-skills`.

Dieses Repo ist dafür selbst ein Plugin-Marketplace namens `breuckmann-agent-skills`
(`.claude-plugin/marketplace.json`); `install.ps1` installiert und aktualisiert das Plugin mit.
Ein Update greift nur, wenn `version` in `agentenflotte/.claude-plugin/plugin.json` steigt.

## Modelle und Denkstufen

Opus macht nicht alles. Der Lauf stuft jedes Paket beim Schneiden in eine **Paketklasse** ein, und
die Klasse wählt den Agent-Typ:

| Rolle | Modell, Denkstufe |
|---|---|
| Kundschafter (liest nur, liefert Fundstellen) | Haiku, niedrig |
| Implementer mechanisch / Standard / Urteil | Sonnet niedrig / Sonnet mittel / Opus mittel |
| Reviewer mechanisch und Standard / Urteil | Sonnet hoch / Opus mittel |
| Lauf-Agent unter `/epic-flotte` | Opus mittel |

Opus mit hoher Denkstufe gibt es nur als letzte Stufe einer **Eskalation**: Meldet der Reviewer
eine strukturelle Abweichung, läuft die nächste Runde eine Stufe höher. Kundschafter laufen zu
mehreren gleichzeitig (höchstens acht), etwa um Behauptungen im Issue gegen den Code zu prüfen oder
am Ende Kommentare und Labels nachzuzählen. Regeln: `epic/SKILL.md`, „Modelle, Paketklasse,
Kundschafter"; Begriffe: [`CONTEXT.md`](CONTEXT.md).

## Aufbau

```
epic/
  SKILL.md
  references/
epic-nacharbeit/
  SKILL.md
epic-aufraeumen/
  SKILL.md
epic-flotte/           optional: mehrere Epics gleichzeitig
  SKILL.md
agents/                Agent-Typen der Modellstaffel (epic-kundschafter, epic-implementer-*, …)
mattpocock-skills/     keine Skills: Einrichtung des Plugins für Gitea
agentenflotte/         Plugin (Mod): Subagenten als Konvoi über der Eingabezeile
.claude-plugin/        macht das Repo zum Marketplace breuckmann-agent-skills
assets/avatar/         Repository-Avatar (avatar.png, 512 px) und sein Generator
assets/prozess/        Prozessbild im README (prozess.png) und seine Quelle
assets/flotte/         Flottenbild im README (flotte.png) und seine Quelle
assets/agentenflotte/  Vorschaubild des Plugins (vorschau.png) und sein Generator
install.ps1
```

Jeder Ordner entspricht einem Skill-Namen unter `~/.claude/skills/<name>`.

## Installieren / Aktualisieren

Erst trocken prüfen, was passieren würde:

```powershell
powershell -File install.ps1 -DryRun
```

Dann tatsächlich installieren:

```powershell
powershell -File install.ps1
```

Nur einen einzelnen Skill installieren:

```powershell
powershell -File install.ps1 -Skill epic
```

Das Skript kopiert die Skill-Ordner nach `~/.claude/skills/<name>`. Ein vorhandener Zielordner
wird vorher nach `~/.claude/skills-backup/<name>-<Zeitstempel>/` gesichert; erst wenn die
Sicherung nachweislich vollständig ist (Dateizahl geprüft), wird der Zielordner geleert und neu
befüllt. Ordner unter den alten Namen (`prd`, `prd-nacharbeit`, `prd-aufraeumen`, `prd-flotte`)
werden auf dieselbe Weise gesichert und dann entfernt, damit nicht alter und neuer Name zugleich
auslösen.

Die Agent-Typen aus `agents/` kopiert das Skript Datei für Datei nach `~/.claude/agents/`; eine
vorhandene, abweichende Datei wird vorher nach `~/.claude/skills-backup/agents-<Zeitstempel>/`
gesichert. Mit `-Skill` bleiben die Agent-Typen und Plugins unberührt.

Die Plugins aus `.claude-plugin/marketplace.json` installiert das Skript über die `claude`-CLI im
User-Scope (`claude plugin marketplace add/update`, `claude plugin install/update`). Weil der
Marketplace ein lokaler Ordner ist, liest Claude Code das Plugin aus diesem Repo
(`claude plugin list` zeigt `Read from: …\agent-skills\agentenflotte`); ein Branchwechsel hier
ändert also den Mod der nächsten Sitzung. Eine Junction oder ein Symlink entsteht dabei nicht.

## Warum Kopie statt Junction/Symlink

Das Skript kopiert immer, verlinkt nie. Ein rekursives Löschen auf einen verlinkten Ordner folgt
dem Link und löscht die Quelle mit — das ist am 18.09.2026 in KOKOS mit
`node_modules`-Junctions passiert. Vor dem Löschen des Zielordners prüft das Skript zusätzlich
auf Reparse-Points und bricht ab, falls es welche findet.

## Änderungen nur über Branch + Pull Request

`~/.claude/skills` nie direkt editieren — das driftet unbemerkt von diesem Repo ab. Änderungen
an einem Skill gehören auf einen Branch und als Pull Request hierher; danach `install.ps1`
laufen lassen, um sie lokal zu übernehmen.

Die laufende Verallgemeinerung dieses Vorgehens (weitere Skills, CI, o.ä.) ist in
[Epic #1](http://mb-vsv-cast:3003/Breuckmann/agent-skills/issues/1) beschrieben.
