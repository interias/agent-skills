# `flotte` für Menschen

Der Flotten-Treiber: ein Programm (TypeScript, läuft mit Bun), das mehrere `/epic`-Läufe
gleichzeitig als `claude -p` auf einem oder mehreren Konten fährt. Belegung, Bremsen, Merge,
Aufräumen, Tafel und Logbuch macht das Programm; ein Sprachmodell, der Admiral, entscheidet nur je
Frageblock. Die vollständige Beschreibung mit allen Schaltern steht in [`SKILL.md`](SKILL.md).

## Starten

Aus einem Terminal im Projektordner, nicht aus einer Sitzung:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" fahren --konten 1,2 --bruecke http://127.0.0.1:4747
```

| Schalter | Wirkung |
|---|---|
| `--konten 1,2` | Konten, auf die neue Epics verteilt werden; ein Epic bleibt bei seinem Konto |
| `--epics 15,21` | nur diese Epics; ohne Angabe alle freigegebenen, alle 15 Minuten neu eingesammelt |
| `--dauerhaft` | nicht enden, wenn nichts mehr freigegeben ist, sondern auf neue Epics warten |
| `--konto-max 3=1` | höchstens so viele Epics gleichzeitig auf diesem Konto |
| `--admiral <konto>` | alle Admiral-Aufrufe auf ein festes Konto legen |
| `--bruecke <url>` | Stand an die [Flottenbrücke](../flottenbruecke/README.md) melden, Antworten dort abholen, die Prototypen aus `prototypen/` (Adapter `prototype_dir`) fürs Holodeck schicken; für die Schiffsliste ruft er höchstens einmal je Minute je Konto `claude agents --json` auf (nur lesend) und meldet Konto, Ordnername (nie den Pfad), Name, Status, Art und Beginn der Sitzungen |
| `--ohne-nacharbeit` | offene Punkte eines Laufs nicht mit `/epic-nacharbeit` abarbeiten |

## Einstellungen ohne Neustart

Die Startparameter und die festen Schwellen sind nur Anfangswerte. Auf der Brücke (Maschinenraum,
mit PIN) lassen sich ändern: Epics gleichzeitig (1–4), Pakete je Epic gleichzeitig (1–3), die Konten
der Läufe, das Admiral-Konto, die 5-h-Schwellen der Verbrauchsbremse (gelb/rot) und je Konto „bis
100 % leerfahren“, die RAM-Schwelle, das Plattenminimum, der Leerlauf und (#112) das Andocken des
Projekts (automatisch nach Andockprüfung oder Mensch prüft jeden PR). Der Treiber prüft die
Grenzen selbst und lehnt einen ungültigen Wert mit einem Ereignis ab.

- **Wirkung ab dem nächsten Takt.** Nichts Laufendes wird abgebrochen: Eine gesenkte Obergrenze
  startet nur weniger, ein entferntes Konto startet nichts Neues, seine Läufe bleiben dort. Die
  Pakete je Epic stehen im Auftrag an `/epic` („höchstens N Pakete gleichzeitig“); eine Änderung
  erreicht laufende Läufe mit dem nächsten Fortsetzen.
- **Jede Änderung** steht als Ereignis und im Flottenlogbuch („Einstellung … von … → auf …, Mensch
  über die Brücke“). Die Brücke zeigt je Einstellung den Wert und woher er kommt (Start, Brücke,
  Standard).
- **Neustart:** Die Werte der Brücke stehen in `zustand.json` und gelten weiter. Ein Startparameter,
  der ausdrücklich gesetzt ist, gewinnt beim Start; das Ereignis nennt beide Werte.
- **Andocken je Projekt und Epic (#112):** Startwert ist `merge` des Adapters. Die Brücke verschärft nur:
  „automatisch“ gibt es nur bei `merge: nach_gate`, `merge.ps1` bleibt die harte Grenze. Je Epic
  schlägt der Treiber „Mensch prüft“ vor, wenn Body des Epics oder Titel/Body eines Kindes ein
  Merkmalswort eines Punkts von `BEIM_MENSCHEN` nennt (`MERKMALE` in `src/treiber/admiral.ts`), und
  zeigt den Grund; ein Schalter am Epic (Sternenkarte) überstimmt Vorschlag und Projekt.
- **Nicht einstellbar:** die Merge-Regel des Adapters, Rechte, Geheimnisse, Updates.

Grenzen und Form: [`SCHNITTSTELLE.md`](../flottenbruecke/SCHNITTSTELLE.md), „Einstellungen“.

## Anhalten und neu starten

Ein Lauf ist ein eigener `claude -p` in einer eigenen Prozessgruppe. Er schreibt sein Log selbst
und überlebt den Treiber; der Zustand steht nach jedem Takt in `zustand.json`. Ein Neustart prüft
je Epic PID und Startzeit: Ein Lauf, der noch lebt, wird nur beobachtet; einer, der inzwischen
endete, wird aus seinem Log ausgewertet. Nichts startet doppelt.

Anders der Merge: `merge.ps1`, das Gate des Treibers und die `nach_merge`-Befehle sind Kinder des
Treibers und sterben mit Strg+C mitten im Schritt. Deshalb zum Aktualisieren:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" anhalten .
```

Der Treiber startet dann nichts Neues mehr, lässt einen begonnenen Merge zu Ende laufen und endet
mit dem Ereignis „Angehalten auf Wunsch“. Danach aktualisieren und mit demselben Aufruf neu
starten. Läuft kein Treiber, wirkt die Datei `anhalten` beim nächsten Start sofort; löschen, wenn
das nicht gewollt ist.

Ein weiteres Konto zuschalten: [`SKILL.md`](SKILL.md), „Weiteres Konto
zuschalten“, eingerichtet nach [`arbeitspferd/README.md`](../arbeitspferd/README.md).

## Was der Treiber tut

1. **Belegen:** Kollisionsstufen und Reihenfolge-Kanten aus Adapter und Issues bestimmen, wie
   viele Epics gleichzeitig laufen (nie mehr als vier). Ein Epic mit dem Label `prio/hoch` (am Epic
   oder an einem Kind) kommt als erstes in die nächste Belegung; kollidiert es mit einem laufenden,
   wartet es, und nichts Kollidierendes überholt es. Laufende Epics werden nie abgebrochen.
2. **Bremsen** in jedem Takt: RAM, Plattenplatz und Verbrauch je Konto. Gelb startet nichts Neues,
   Rot hält auch Fortsetzungen an.
3. **Fragen** eines Laufs gehen an den Admiral. Er entscheidet, was sich bis zum Merge widerrufen
   lässt; der Rest geht an dich, auf Tafel, Issue und Brücke.
4. **Nacharbeit:** Nennt das Ende eines Laufs offene Punkte, setzt der Treiber ihn einmal mit
   `/epic-nacharbeit` fort, solange der PR offen ist.
5. **Mergen** nur nach dem Adapterschlüssel `merge`: bei `mensch` meldet er „PR bereit“, bei
   `nach_gate` reiht er den PR in die Merge-Schlange und mergt mit `merge.ps1`, nur mit
   Gate-Nachweis aus dem Log des Laufs (fehlt er, fährt er das Gate selbst).
6. **Nach dem Merge** die `nach_merge`-Befehle des Adapters, dann Aufräumen (`CleanupStale`, der
   lokale Epic-Branch, wenn er ganz in der Basis liegt). Nennt der Adapter `lern_issue`, schreibt
   nebenher die Lernschleife (`flotte lernen`, Haiku) höchstens drei belegte Vorschläge als Kommentar
   in dieses Issue. Umgesetzt wird nichts davon von selbst; jeden Vorschlag entscheidet die
   [Triage](#triage) wie eine Sternzeit-Notiz.

Den Stand zeigen die Tafel (`<git common dir>/flotte/tafel.html`), das Logbuch-Issue mit Label
`flotte` und die Brücke. Einzelne Befehle wie `flotte zustand`, `flotte antworten` und
`flotte zuschauen` stehen in [`SKILL.md`](SKILL.md).

## Aufträge

Missionen und Missionsziele legt nur der Auftragsschreiber an (agent-skills/ADR-0002), nie
`gh issue create` von Hand:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" auftrag <repo> <entwurf.md> [--starten] [--trocken]
```

`<repo>` ist der Checkout des Ziel-Repositorys. Aus seinem Adapter (`.claude/epic.md`) liest der
Befehl `forge` und `api` (ohne `api`: das GitHub-Repository von `origin`), `epic_label`,
`ready_label` und die Abschnitte `acceptance_section`, `verification_section` und
`modules_section` mit ihren Standards (`epic/references/adapter.md`, „Issues“). Er spricht GitHub
(über `gh`) und Gitea (über die API: `forge: gitea` und `api: <host>/api/v1/repos/<owner>/<repo>`,
Anmeldung mit `token_env`/`token_file` oder Basic Auth aus dem Git-Credential-Speicher). Gitea kennt
keine Sub-Issues: die Mission ist dort von ihren Missionszielen blockiert (Abhängigkeit), die Liste
im Body bleibt.

**Entwurf:** Markdown. Jede Überschrift erster Ebene beginnt ein Issue: höchstens eine
`# Mission: <Titel>` ganz oben, darunter ein oder mehrere `# Missionsziel: <Titel>`. Ohne Mission
ist genau ein Missionsziel erlaubt. Was unter einer Überschrift steht, wird der Text des Issues;
Abschnitte darin sind `##`-Überschriften.

```markdown
# Mission: Bereitschaftsraum und Auftragsschreiber

Ein, zwei Absätze, worum es geht.

# Missionsziel: Auftragsschreiber für GitHub

## Was
…

## Abnahmekriterien
- …

## Verifikationsweg
…

## Betroffene Module
- `flotte/`
```

**Prüfung:** Jedes Missionsziel braucht einen nicht leeren Abnahmeabschnitt (Standard: der erste
vorhandene von `## Abnahmekriterien`, `## Akzeptanzkriterien`, `## Acceptance criteria`) und
`## Verifikationsweg`; ohne sie überspringt ein Außeneinsatz das Ziel. Fehlt einer, bricht der
Befehl mit allen Lücken ab, bevor er irgendetwas anlegt. `## Betroffene Module` ist wie bei `/epic`
freiwillig; fehlt er, steht ein Hinweis in `hinweise`.

**Was entsteht:** Zuerst die Mission mit `epic_label`, dann die Missionsziele in der Reihenfolge des
Entwurfs, jedes mit `Teil von #<Mission>` als erster Zeile und als Sub-Issue der Mission verknüpft.
Zuletzt bekommt die Mission die Liste `## Missionsziele` (`- [ ] #<nr> <Titel>`) und die Zeile
`> **Reihenfolge:** von oben nach unten, …`, wenn ihr Text keine eigene `Reihenfolge`-Zeile hat.
Alle Issues tragen `needs-triage` (Sternzeit-Notiz), mit `--starten` stattdessen `ready_label`
(Warp frei). Scheitert die Forge mittendrin, nennt die Meldung, was schon angelegt ist.

**Ausgabe:** ein JSON-Objekt mit `forge`, `mission` und `ziele` (je Nummer, Link, Titel), den
Labels und den Hinweisen. `--trocken` legt nichts an und zeigt stattdessen Titel, Labels und Text
jedes Issues (Nummern als `#?`).

## Triage

Sternzeit-Notizen (`needs-triage`, `needs-info`) klärt der Admiral selbst:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" triage [<repo>...] [--forge <owner/name>] [--konto <k>] [--modell fable] [--trocken]
```

Je offenem Ticket ein `claude -p` (Werkzeuge nur `Read,Grep,Glob`): Er stellt sich die Fragen einer
Fragerunde, beantwortet sie aus Text, Kommentaren, ADRs und Code und entscheidet nach der Liste
„beim Menschen“ (`src/treiber/admiral.ts`):

- **klar:** fehlende oder leere Abschnitte `acceptance_section`/`verification_section` des Adapters
  nachgetragen (geprüft wie im Auftragsschreiber), `ready_label` dazu, `needs-triage`/`needs-info` ab.
- **überflüssig:** geschlossen (`not planned`) mit Grund; die Labels bleiben, Wiederöffnen mit einem
  Kommentar bringt es zurück in die Triage.
- **kritisch:** genau ein Kommentar mit allen Fragen, die nach der Liste beim Menschen liegen; das
  Label bleibt.

Eine Mission (Label `epic_label` des Adapters, so legt `flotte auftrag` sie an) überspringt die
Triage ohne Modellaufruf (`mission`): Sie wird über ihre Missionsziele freigegeben. Ein Ticket, das
kein `OWNER`, `MEMBER` oder `COLLABORATOR` eröffnet hat (`author_association`, je Ticket über
`gh api`), geht ebenfalls nicht ins Modell und wird nie geändert (`fremd`, scheitert die Abfrage, mit
`fehler`); hält ein Mensch es für gut, übernimmt er es mit eigener Neufassung oder einem Kommentar.

Vor jeder Änderung steht ein Kommentar mit Herkunft je Entscheidung („Projektregel …“,
„Skill-Empfehlung“, „Präzedenz …“, „Eigenes Urteil …“) und dem Weg zum Widerruf; scheitert er,
ändert sich nichts. Seine erste Zeile ist `<!-- flotte:triage -->`, bei einer Frage
`<!-- flotte:triage-frage -->` und darunter `**FRAGE AN DEN MENSCHEN (Triage)** — Sternzeit-Notiz #<nr>: …`.
Die Antwort ist ein Kommentar am Ticket; die nächste Triage nimmt sie als Tatsache. Als Antwort zählt
nur ein Kommentar der Rollen `OWNER`, `MEMBER` oder `COLLABORATOR` (`authorAssociation`); Kommentare
Dritter gehen gar nicht ins Modell, das Repository kann öffentlich sein. Steht unter dem letzten
Kommentar der Triage (Frage, oder Entscheidung, deren Freigabe gescheitert ist) kein solcher
Kommentar, wird das Ticket übersprungen (`wartet`), ohne Modellaufruf. Triage legt keine Tickets an
(agent-skills/ADR-0002), außer aus einem Lernvorschlag über den Auftragsschreiber, und spricht bisher
nur GitHub; ein Gitea-Repository steht in `fehler`.

**Lernvorschläge** (#117): Nennt der Adapter `lern_issue`, triagiert derselbe Befehl danach jeden
Vorschlag der Lernschleife an diesem Issue einzeln wie ein Ticket, mit demselben Auftrag an den
Admiral. Als Vorschlag zählt nur ein Kommentar mit `<!-- lernschleife -->` der Rollen oben. Jeder
Vorschlag hat die Kennung `Lernvorschlag <id>/<n>` (Id des Kommentars der Lernschleife, Nummer
darin); alle Kommentare der Triage dazu stehen am `lern_issue` und nennen sie im Kopf, und als Antwort
zählt dort nur ein Kommentar, der sie in der ersten Zeile nennt (eine weiter unten zitierte Kennung,
etwa im „Vorher“ eines Widerrufs, zählt nicht).

- **klar:** zuerst der Kommentar `**Triage: Lernvorschlag <id>/<n> wird Missionsziel, Warp frei**`
  mit Herkunft, dann legt der Auftragsschreiber das Missionsziel an (Abschnitte wie oben nachgetragen
  und geprüft, gleich mit `ready_label`, im Text der Vorschlag und `Herkunft: <Link des Kommentars>`),
  dann der Kommentar `Vorschlag <n> aus <Kommentar> → #<neu>, widerrufbar (Lernvorschlag <id>/<n>)`.
  Widerruf am Missionsziel: `ready_label` ab, `needs-triage` an.
- **überflüssig:** nur der Kommentar mit Grund; nichts wird angelegt.
- **kritisch:** genau ein Kommentar mit `<!-- flotte:triage-frage -->` und
  `**FRAGE AN DEN MENSCHEN (Triage)** — Lernvorschlag <id>/<n> („<Titel>“, Vorschlag <n> aus <Kommentar>): …`.

Ein Vorschlag, zu dem schon eine Entscheidung oder Frage steht, wartet ohne Modellaufruf, bis darunter
eine Antwort mit seiner Kennung steht; entschiedene erscheinen nicht mehr in der Ausgabe, eine offene
Frage als `wartet`. Scheitert der erste Kommentar, wird nichts angelegt. Scheitert danach das Anlegen
(oder der Kommentar mit der Nummer), steht es in `fehler`; in jedem späteren Lauf erscheint der
Vorschlag als `wartet` mit `fehler` = `Missionsziel fehlt`, im Frachtraum mit `— Missionsziel fehlt`
hinter dem Titel. Neu angelegt wird nichts von selbst (sonst droht ein doppeltes Missionsziel): Ein
Mensch prüft, ob es existiert, und schreibt einen Kommentar mit der Kennung in der ersten Zeile; dann
triagiert der nächste Lauf den Vorschlag neu. Steht unter einem Vorschlag dagegen schon der Kommentar
`→ #<neu>`, ist er endgültig entschieden: Ein späterer Kommentar mit seiner Kennung startet keine
Triage mehr, ein zweites Missionsziel entsteht nie; widerrufen wird am Missionsziel. Ein Feld eines
Vorschlags über mehrere Zeilen gehört ganz zum Vorschlag, eine Leerzeile beendet ihn. Im Frachtraum
stehen offene Vorschläge als Tickets des `lern_issue` unter dem Thema `Lernschleife`, Titel mit der
Kennung davor.

**Zum Menschen** kommt eine Frage der Triage nur auf zwei Wegen: als Fragekommentar am Ticket (bei
einem Lernvorschlag am `lern_issue`) und im Frachtraum der Brücke. Einen Chat, der sie sammelt, gibt
es nicht; das Entscheidungsrecht steht in `references/entscheidungsrecht.md`.

**Planen:** Der Befehl hält keinen eigenen Zustand und lässt sich beliebig oft wiederholen, etwa
stündlich über die Aufgabenplanung: `schtasks /Create /SC HOURLY /TN flotte-triage /TR "bun <skills>\flotte\src\cli.ts triage <repo>"`.

**Über die Brücke** (#116, Frachtraum): Mit `--bruecke` liest der Treiber die offenen Sternzeit-Notizen
und die unbeantworteten Fragen der Triage aus der Forge (beim Start, höchstens alle 30 min und sofort
nach einer Handlung des Frachtraums) und meldet sie samt den Entscheidungen seiner Triage-Läufe. Auf
Knopfdruck führt er diesen Befehl für sein Projekt aus (Admiral-Konto, einen Lauf zur Zeit), schreibt
eine Antwort des Menschen als Kommentar ans Ticket (ohne Triage-Marke; die nächste Triage nimmt sie als
Tatsache) und widerruft eine Entscheidung: erst der Kommentar, dann `ready_label` ab und `needs-triage`
an oder das Ticket wieder offen. Bei einem Lernvorschlag nennt die Antwort seine Kennung, der Widerruf
von „klar“ wirkt am Missionsziel, der von „überflüssig“ ist nur der Kommentar am `lern_issue`. Felder
und Handlungen: `flottenbruecke/SCHNITTSTELLE.md`.

**Ausgabe:** `trocken`, `repos` (`repo`, `forge`), `fehler` (`repo` oder `forge`, `fehler`),
`tickets` (je `forge`, `nummer`, `titel`, `url`, `ergebnis` = `klar` | `ueberfluessig` | `kritisch` |
`wartet` | `mission` | `fremd` | `ungueltig`, `geschrieben`, `kommentar`, gegebenenfalls `fehler`, `sitzung`, `herkunft` und `grund` der Entscheidung, bei
`--trocken` und `klar` der neue `body`; bei einem Lernvorschlag `lernvorschlag` = Kennung, `nummer`
das `lern_issue`, `url` der Kommentar der Lernschleife, bei `klar` `missionsziel`) und `fragen` (je
`forge`, `ticket`, `url`, `frage`, `optionen`, `empfehlung`, `grund`, `herkunft`, `marke` = Punkt der
Liste: `nach außen`, `Geld`, `Produktivdaten`, `Sicherheit und Zugänge`, `Kundentext`, `Architektur`;
bei einem Lernvorschlag `lernvorschlag`) mit den in diesem Lauf neu gestellten Fragen, dazu `offen`
in derselben Form mit den Fragen früherer Läufe, die unter einem `wartet` noch ohne Antwort stehen.
`--trocken` entscheidet und druckt, schreibt nichts.

## Werft

Nach einem Merge auf `main` zieht die Werft die berührten Stacks nach, auf dem Rechner und nicht im
Brücken-Container (agent-skills/ADR-0005). Einmal je Rechner aus einem Terminal starten (Sperre
`~/.flotte/werft.lock`; ein zweiter Start endet mit Exit 1, die Sperre eines toten Prozesses wird
übernommen):

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" werft [<ordner>...] [--bruecke http://127.0.0.1:4747] [--einmal]
```

- Sie nimmt jedes Repository in den Ordnern (Standard `~/git`, nur Hauptverzeichnisse) mit dem
  Adapterschlüssel `deploy` (`epic/references/adapter.md`, „Werft“). Alle 15 s schaut sie, welches
  fällig ist (`deploy.abfrage_s`, Standard 120 s), holt `origin/<main_branch>` und liest den Adapter
  von dort.
- Gezogen wird jeder Stack, dessen `pfade` eine Datei im Diff seit dem letzten Stand trifft, in der
  Reihenfolge des Adapters: `<stack>.nachziehen` in der Wurzel des Repositorys, mit `WERFT_COMMIT`
  und `WERFT_STACK` in der Umgebung, höchstens 30 min. Die Arbeitskopie fasst die Werft nicht an; wer
  den neuen Stand braucht, holt ihn im Befehl.
- Der Stand steht je Repository in `.git/flotte/werft.json`: `stand` (zuletzt abgearbeiteter Commit)
  und je Stack `status`, `commit`, `protokoll`. Geschrieben wird nach jedem Stack; ein Neustart setzt
  dort fort und zieht nichts doppelt: Ein Stack, der schon bei einem späteren Commit gezogen wurde,
  zählt nur, was danach kam. Beim ersten Blick merkt sie sich nur den Stand. Fehlt der alte Stand
  lokal (Force-Push und gc), gelten alle Stacks als berührt, mit einer Meldung.
- Ein Fehler (Exit ≠ 0) stellt nur diesen Stack auf `rot`, mit dem Ende der Ausgabe als Protokoll;
  die übrigen laufen weiter. Ein roter Stack wird nicht mehr von selbst gezogen, bis der Mensch auf
  der Brücke „nachziehen“ wählt.
- Mit `--bruecke` (oder `FLOTTE_BRUECKE`, Token `FLOTTE_BRUECKE_TOKEN`) meldet sie je Takt den
  Stand und holt Handlungen ab (`flottenbruecke/SCHNITTSTELLE.md`, „Werft“); ist die Brücke aus,
  zieht sie weiter nach.
- `<stack>.migration_test` läuft direkt nach einem grünen `nachziehen`; scheitert sie, steht der
  Stack rot wie bei einem Fehler im Nachziehen.
- Hat der Stack `migration_arbeit`, nimmt die Werft nach dem Nachziehen die Sicherung
  (`<stack>.sicherung`) und prüft sie (`epic/references/adapter.md`, „Geprüfte Sicherung“). Dann
  wartet die Migration auf die Freigabe des Menschen auf der Brücke (Handlung `migration_freigeben`
  mit PIN), gebunden an Commit, Sicherung und den Befehl zur Zeit der Sicherung (nennt der Adapter
  inzwischen einen anderen, wird sie abgelehnt). Erst dann läuft sie, genau einmal: Der Stand
  (`arbeit` je Stack: `wartet`, `gesperrt`, `laeuft`, `migriert`, `rot`) wird vor dem Start
  geschrieben, auch nach einem Absturz startet dieselbe Freigabe sie nicht noch einmal. Ohne
  geprüfte Sicherung steht der Stack rot und jede Freigabe wird abgelehnt.

## Prognose

Die Brücke sagt je wartendem Epic „voraussichtlich 3–5 h“ und oben in „Erledigt heute“, wann der
Backlog etwa leer ist. Gerechnet wird je Repository aus dem, was der Treiber dort gemessen hat:

- **Messen:** Je fertigem Epic schreibt der Treiber eine Zeile in
  `<git common dir>/flotte/messungen.jsonl`. Sie überdauert Einsätze. In der Zeile stehen:
  - die Arbeitszeit vom ersten Start bis zum letzten `FLOTTE-ENDE`, ohne die Zeit, in der der ganze
    Lauf auf dich wartete;
  - die Gate-Zeit des Treibers und das Konto;
  - je Paket die Klasse (mechanisch, Standard, Urteil, Urteil-hoch) und die Eskalationen, gelesen
    aus den Implementer-Aufrufen im Log des Laufs.
- **Rechnen:** Monte-Carlo über die gemessenen Verteilungen statt eines Mittelwerts, 2000 Züge mit
  festem Seed. Je Zug kommen aus den Messungen:
  - ein Tempo (Arbeitszeit je gewichtetem Paket eines fertigen Epics);
  - die Pakete des neuen Epics mit Klasse und Eskalationen;
  - eine Gate-Zeit.

  Die Komplexität zählt über die Klasse (Gewicht 0,5 / 1 / 2 / 3, je Eskalation +1), verteilt auf
  bis zu drei Pakete gleichzeitig, nicht über die bloße Zahl der Tickets. Für den Backlog verteilt
  die Rechnung alle freigegebenen, noch offenen Epics auf die Plätze der Obergrenze. Ein laufendes
  Epic braucht dabei nur noch seinen Rest. Angezeigt wird die Spanne P50–P90.
- **Schwelle:** erst ab 5 gemessenen Epics (Adapter `prognose_ab`). Vorher zeigt die Brücke
  „Prognose ab 5 Epics · bisher N“. Jedes weitere Epic rechnet sie von selbst mit.
- **Selbstprüfung:** Beim ersten Start eines Epics merkt sich der Treiber die Prognose; am Ende hält
  er fest, ob die echte Dauer samt Gate zwischen P10 und P90 lag. Die Brücke zeigt „traf 7 von 10“.
  Liegt die Quote ab 5 geprüften Epics unter 60 %, blendet sie die Prognose aus: „zu ungenau für
  dieses Projekt“.
- **Wartezeit auf dich** ist nirgends eingerechnet; die Brücke sagt das dazu.

`flotte messen` gibt die Messungen unter `prognose` mit aus: Anzahl, Verteilungen, Pakete je Klasse
und Trefferquote.

## Messen

`flotte messen <einsaetze.json>` (Form: `messung/einsaetze.beispiel.json`) liest die Transkripte
der Läufe samt ihrer Subagenten und gibt je Einsatz unter anderem aus:

- **`tokens`:** Eingabe, Cache-Schreiben, Cache-Lesen und Ausgabe, je Agent-Typ, je Epic und je
  Paket, jeweils mit **Cache-Quote** (Lesen durch alles, was hineinging). Je Paket die Zahl der
  Implementer- und Reviewer-Läufe, also die **Review-Runden**.
- **`kontext_anteil`** je Agent-Typ: welcher Anteil seiner gewichteten Tokens auf Werkzeugergebnisse
  einer Art fällt — Test, Gate, Diff (`git diff/show/log`), Lesen, übrige Shell. Ein Ergebnis kostet
  einmal das Schreiben in den Cache und danach bei jedem weiteren Modellaufruf das Lesen. Der Anteil
  ist die **Obergrenze** dessen, was eine Maßnahme sparen kann, die diese Ergebnisse kürzt.
- **`verlauf`** (unter dem Treiber): Durchlaufzeit je Epic ohne Warten auf dich und die
  Fehlerquote (Rückgabe an den Lauf, blockiert, abgebrochen).

**Was das schon entschieden hat (21.11.2026).** Für das „Sparpaket“ aus der Skill-Recherche lief
`flotte messen` über alle Läufe der drei Konten vom 1. bis 21.11.2026 (448 Implementer und
Reviewer, 195 Pakete). Je Agent-Typ kosteten Testausgaben 0,4–0,5 % der Tokens, Diffs im Review
4,2–4,5 %, Lesen 5–10 %, übrige Shell 5–17 %; die Cache-Quote lag bei 96–98 %. 13 von 195 Paketen
brauchten eine zweite Review-Runde. Ein Hook, der Testausgabe kürzt, ein enger Nach-Review und ein
Review-Paket als Datei hätten höchstens diese Anteile treffen können; sie wurden deshalb nicht
übernommen (Begründung im Pull Request des Sparpakets).

## Bei dir

Fragen, die der Admiral nicht entscheiden darf; das Mergen bei `merge: mensch`; eine Anmeldung,
wenn ein Konto abgemeldet ist; Widerruf einer Entscheidung als Kommentar am Issue oder auf der
Brücke; ein blockiertes Epic neu einreihen oder aufgeben (Brücke); Vorrang mit `prio/hoch` oder auf
der Brücke; ein freigegebenes Epic aufnehmen, ein Epic pausieren und fortsetzen, sein Andocken stellen
(Brücke, Sternenkarte); einen Triage-Lauf starten, eine Frage der Triage beantworten, eine Entscheidung
der Triage widerrufen (Brücke, Frachtraum).
