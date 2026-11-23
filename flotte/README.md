# `flotte` für Menschen

Der Flotten-Treiber: ein Programm (TypeScript, läuft mit Bun), das mehrere `/mission`-Läufe
gleichzeitig als `claude -p` auf einem oder mehreren Konten fährt. Belegung, Bremsen, Andocken,
Aufräumen, Tafel und Logbuch macht das Programm; ein Sprachmodell, der Admiral, entscheidet nur je
Frageblock. Die vollständige Beschreibung mit allen Schaltern steht in [`SKILL.md`](SKILL.md).

## Starten

Aus einem Terminal im Projektordner, nicht aus einer Sitzung:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" fahren --konten 1,2 --bruecke http://127.0.0.1:4747
```

| Schalter | Wirkung |
|---|---|
| `--konten 1,2` | Konten, auf die neue Missionen verteilt werden; eine Mission bleibt bei ihrem Konto |
| `--epics 15,21` | nur diese Missionen; ohne Angabe alle freigegebenen, alle 15 Minuten neu eingesammelt |
| `--dauerhaft` | nicht enden, wenn nichts mehr freigegeben ist, sondern auf neue Missionen warten |
| `--konto-max 3=1` | höchstens so viele Missionen gleichzeitig auf diesem Konto |
| `--admiral <konto>` | alle Admiral-Aufrufe auf ein festes Konto legen |
| `--bruecke <url>` | Stand an die [Flottenbrücke](../flottenbruecke/README.md) melden, Antworten dort abholen, die Prototypen aus `prototypen/` (Adapter `prototype_dir`) fürs Holodeck schicken; für die Schiffsliste ruft er höchstens einmal je Minute je Konto `claude agents --json` auf (nur lesend) und meldet Konto, Ordnername (nie den Pfad), Name, Status, Art und Beginn der Sitzungen |
| `--ohne-nacharbeit` | offene Punkte eines Laufs nicht mit `/mission-nacharbeit` abarbeiten |

## Einstellungen ohne Neustart

Die Startparameter und die festen Schwellen sind nur Anfangswerte. Auf der Brücke (Maschinenraum,
mit PIN) lassen sich ändern: Missionen gleichzeitig (1–4), Pakete je Mission gleichzeitig (1–3), die Konten
der Läufe, das Admiral-Konto, die 5-h-Schwellen der Verbrauchsbremse (gelb/rot) und je Konto „bis
100 % leerfahren“, die RAM-Schwelle, das Plattenminimum, der Leerlauf und (#112) das Andocken des
Projekts (automatisch nach Andockprüfung oder Mensch prüft jeden PR) und (#166) das Modell der Triage
(Standard `opus`) und des Admirals (Startwert `--admiral-modell`), ab dem nächsten Aufruf. Der Treiber prüft die
Grenzen selbst und lehnt einen ungültigen Wert mit einem Ereignis ab.

- **Wirkung ab dem nächsten Takt.** Nichts Laufendes wird abgebrochen: Eine gesenkte Obergrenze
  startet nur weniger, ein entferntes Konto startet nichts Neues, seine Läufe bleiben dort. Die
  Pakete je Mission stehen im Auftrag an `/mission` („höchstens N Pakete gleichzeitig“); eine Änderung
  erreicht laufende Läufe mit dem nächsten Fortsetzen.
- **Jede Änderung** steht als Ereignis und im Flottenlogbuch („Einstellung … von … → auf …, Mensch
  über die Brücke“). Die Brücke zeigt je Einstellung den Wert und woher er kommt (Start, Brücke,
  Standard).
- **Neustart:** Die Werte der Brücke stehen in `zustand.json` und gelten weiter. Ein Startparameter,
  der ausdrücklich gesetzt ist, gewinnt beim Start; das Ereignis nennt beide Werte.
- **Andocken je Projekt und Mission (#112):** Startwert ist `merge` des Adapters. Die Brücke verschärft nur:
  „automatisch“ gibt es nur bei `merge: nach_gate`, `merge.ps1` bleibt die harte Grenze. Je Mission
  schlägt der Treiber „Mensch prüft“ vor, wenn Body der Mission oder Titel/Body eines Missionsziels ein
  Merkmalswort eines Punkts von `BEIM_MENSCHEN` nennt (`MERKMALE` in `src/treiber/admiral.ts`), und
  zeigt den Grund; ein Schalter an der Mission (Sternenkarte) überstimmt Vorschlag und Projekt.
- **Nicht einstellbar:** die Andock-Regel des Adapters, Rechte, Geheimnisse, Updates.

Grenzen und Form: [`SCHNITTSTELLE.md`](../flottenbruecke/SCHNITTSTELLE.md), „Einstellungen“.

## Anhalten und neu starten

Ein Lauf ist ein eigener `claude -p` in einer eigenen Prozessgruppe. Er schreibt sein Log selbst
und überlebt den Treiber; der Zustand steht nach jedem Takt in `zustand.json`. Ein Neustart prüft
je Mission PID und Startzeit: Ein Lauf, der noch lebt, wird nur beobachtet; einer, der inzwischen
endete, wird aus seinem Log ausgewertet. Nichts startet doppelt.

Anders das Andocken: `merge.ps1`, die Andockprüfung des Treibers und die `nach_merge`-Befehle sind Kindprozesse des
Treibers und sterben mit Strg+C mitten im Schritt. Deshalb zum Aktualisieren:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" anhalten .
```

Der Treiber startet dann nichts Neues mehr, lässt ein begonnenes Andocken zu Ende laufen und endet
mit dem Ereignis „Angehalten auf Wunsch“. Danach aktualisieren und mit demselben Aufruf neu
starten. Läuft kein Treiber, wirkt die Datei `anhalten` beim nächsten Start sofort; löschen, wenn
das nicht gewollt ist.

Ein weiteres Konto zuschalten: [`SKILL.md`](SKILL.md), „Weiteres Konto
zuschalten“, eingerichtet nach [`arbeitspferd/README.md`](../arbeitspferd/README.md).

## Was der Treiber tut

1. **Belegen:** Kollisionsstufen und Reihenfolge-Kanten aus Adapter und Issues bestimmen, wie
   viele Missionen gleichzeitig laufen (nie mehr als vier). Eine Mission mit dem Label `prio/hoch` (an der Mission
   oder an einem Missionsziel) kommt als erstes in die nächste Belegung; kollidiert sie mit einer laufenden,
   wartet sie, und nichts Kollidierendes überholt sie. Laufende Missionen werden nie abgebrochen.
2. **Bremsen** in jedem Takt: RAM, Plattenplatz und Verbrauch je Konto. Gelb startet nichts Neues,
   Rot hält auch Fortsetzungen an.
3. **Fragen** eines Laufs gehen an den Admiral. Er entscheidet, was sich bis zum Andocken widerrufen
   lässt; der Rest geht an dich, auf Tafel, Issue und Brücke.
4. **Nacharbeit:** Nennt das Ende eines Laufs offene Punkte, setzt der Treiber ihn einmal mit
   `/mission-nacharbeit` fort, solange der PR offen ist.
5. **Andocken** nur nach dem Adapterschlüssel `merge`: bei `mensch` meldet er „PR bereit“, bei
   `nach_gate` reiht er den PR in die Andock-Schlange und dockt mit `merge.ps1` an, nur mit
   Nachweis der Andockprüfung aus dem Log des Laufs (fehlt er, fährt er die Andockprüfung selbst).
6. **Nach dem Andocken** die `nach_merge`-Befehle des Adapters, dann Aufräumen (`CleanupStale`, der
   lokale Missions-Branch, wenn er ganz in der Basis liegt). Nennt der Adapter `lern_issue`, schreibt
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
`modules_section` mit ihren Standards (`mission/references/adapter.md`, „Issues“). Er spricht GitHub
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
Befehl mit allen Lücken ab, bevor er irgendetwas anlegt. `## Betroffene Module` ist wie bei `/mission`
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

**Mission über vorhandene Missionsziele** (#147, nur aus der Triage, kein Entwurf): `missionAnlegen`
in `src/auftrag/auftrag.ts` legt eine Mission an, deren Missionsziele schon existieren (die
Sternzeit-Notizen selbst): Body wie oben (`## Missionsziele` mit den Nummern), nur `epic_label`,
danach jedes Missionsziel als Sub-Issue verknüpft; an den Missionszielen ändert sich dabei nichts.
`ready_label` setzt der Aufrufer erst, wenn ein Missionsziel freigegeben ist, damit nie eine Mission
ohne freigegebenes Missionsziel Warp frei hat. Scheitert ein Verknüpfen, nennt der Fehler die schon angelegte
Mission. `missionszielAnhaengen` hängt ein vorhandenes Missionsziel an eine offene Mission:
verknüpfen, dann `- [ ] #<nr> <Titel>` unter den letzten Eintrag ihrer Liste (fehlt die Liste, kommt
sie ans Ende), der übrige Text bleibt. Nennt die Liste es schon (etwa eine widerrufene Notiz, die
zurückkommt), bleibt alles, wie es ist: kein zweites Verknüpfen, kein zweiter Eintrag.

## Triage

Sternzeit-Notizen (`needs-triage`, `needs-info`) klärt der Admiral selbst:

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" triage [<repo>...] [--forge <owner/name>] [--konto <k>] [--modell fable] [--trocken]
```

**Ein Aufruf je Projekt** (#146): Ein einziger `claude -p` je Projekt (Werkzeuge nur
`Read,Grep,Glob`, Schema `schnittplanSchema()` in `src/triage.ts`) liest alle Notizen, die ins Modell gehen
(Autor berechtigt, keine Mission, nicht `wartet`; Lernvorschläge nicht), dazu die offenen Missionen
(Label `epic_label`, offen, ohne `status/in-arbeit`, mit der Zahl ihrer Missionsziele aus
`sub_issues_summary`, im Auftrag als `(<n> Kinder, noch <m> frei)` bzw. `(8 Kinder, voll, keine neuen Kinder)`;
eine, deren Missionsziele nicht lesbar sind, kommt nicht in Frage). Passende offene Missionen haben
ausdrücklich Vorrang vor neuen, so gehen Notizen eines späteren Laufs in die Missionen früherer. Er liefert in
einer strukturierten Antwort den Schnittplan und die Klärung jeder Notiz; eine Einzelklärung je Notiz gibt es
nicht. Er ordnet jede Notiz genau einmal zu: `mission` (Missionsziel einer offenen Mission), `neue_mission` (Missionsziel einer neuen
Mission für ein Thema), `zusammengefuehrt` (Duplikat oder Teilstück; `in` = die Notiz, die bleibt),
`ueberfluessig` (mit Grund und Fundstelle), `verworfen` (mit Grund) oder `triage` (bleibt in der
Triage). Grenzen: höchstens 4 neue Missionen je Lauf, eine Mission höchstens 8 Missionsziele, vorhandene
zählen mit. Aus einer Notiz entsteht nie ein neues Ticket. Je Zuordnung klärt er die Notiz wie in einer
Fragerunde: Er stellt sich die Fragen, beantwortet sie aus Text, Kommentaren, ADRs und Code (`fragen`,
je mit Antwort, Herkunft und Grund) und entscheidet nach der Liste „beim Menschen“
(`src/treiber/admiral.ts`); nur was dort steht, bekommt `beim_menschen: true` und den Punkt als `marke`.
Für eine Notiz mit `mission` oder `neue_mission` ohne solche Frage schreibt er die fehlenden oder leeren
Abschnitte `acceptance_section`/`verification_section` des Adapters (`abnahmekriterien`,
`verifikationsweg`). Das Programm prüft den Plan; fehlt eine
Notiz, steht eine doppelt, ist eine Nummer unbekannt, eine Grenze überschritten, fehlt bei `verworfen`
ein Grund oder bei `ueberfluessig` Grund oder Fundstelle, verweist `zusammengefuehrt` auf keine
Notiz, die bleibt, fragt eine geschlossene Notiz den Menschen, oder besteht eine Notiz, die in eine
Mission kommt, mit ihren ergänzten Abschnitten die Prüfung des Auftragsschreibers nicht,
gilt er nicht. Hat das Modell geantwortet, folgt genau eine **Reparaturrunde** (#147): derselbe Auftrag
mit dem Fehler und der ungültigen Antwort darunter, „korrigiere nur das“. Sie ist der einzige zweite
Aufruf: Der Normalfall ist genau ein Aufruf je Projekt, die Zahl steht in der Ausgabe (`aufrufe`). Fallen
im Plan nach der Reparaturrunde nur noch einzelne Notizen mit `mission` oder `neue_mission` durch die
Prüfung ihrer Abschnitte, hält das den Plan nicht auf: Das Programm stuft jede solche Notiz auf `triage`
herab (`herabgestuft` nennt Fehler und vorgesehene Mission), der Rest gilt; eine neue Mission, der so alle
Missionsziele fehlen, wird nicht angelegt. Text und Label der Notiz bleiben; sie bekommt eine Frage an den Menschen
in der Form der Triage (Punkt `Prüfung nicht bestanden`, Optionen „Abschnitte ergänzen, dann <Mission>
zuordnen“ als Empfehlung oder „verwerfen“) und wartet auf seine Antwort, wie jede gefragte Notiz. Ist
auch der zweite Plan sonst ungültig, oder kam gar keine Antwort im Schema (der Aufruf selbst scheiterte;
derselbe Auftrag noch einmal scheiterte meist genauso), gilt er als Ganzes nicht: Für die Notizen dieses
Projekts wird in diesem Lauf nichts geschrieben (der nächste Lauf versucht es neu).
Aus einem gültigen Plan werden
`zusammengefuehrt`, `ueberfluessig` und `verworfen` geschlossen: erst der Kommentar
`**Triage: zusammengeführt in #<nr>**` bzw. `geschlossen, überflüssig` / `geschlossen, verworfen (not planned)`
mit Grund und Herkunft, dann `gh issue close --reason "not planned"`; scheitert der Kommentar, ändert
sich nichts, gelöscht wird nie. Widerruf: das Ticket wieder öffnen und den Einwand als Kommentar
schreiben. Was mit einer übrigen Notiz geschieht, bestimmen ihre Klärung und ihre Zuordnung im Plan (die
Liste unten, **Missionen in der Forge**). Der Auftrag hat ein Gesamtbudget (Notizen zusammen 120 000,
Missionen 30 000 Zeichen, je Notiz höchstens 6 000, je Mission 2 000). **Geteilt wird nur über dieser
Größengrenze** (`pakete` in `src/triage.ts`): Passen die Notizen mit je bis zu 6 000 Zeichen nicht in die
120 000, teilt das Programm sie ohne Modell nach Thema in wenige Pakete, einen Aufruf je Paket mit denselben
Regeln. Thema einer Notiz ist das Wort ihres Titels (oder ein Label außer den Triage-Labels), das die meisten
anderen Notizen teilen, aber höchstens die Hälfte aller; ganze Themen kommen zusammen in so wenige Pakete wie
passen, ein Thema größer als ein Paket wird in der Reihenfolge seiner Notizen geschnitten. Ein Paket je Notiz
gibt es nie. Die Grenzen gelten über alle Pakete zusammen: Jedes nächste Paket sieht die freien Plätze, die
die früheren den offenen Missionen ließen, und die übrigen neuen Missionen; ein Schlüssel einer neuen Mission,
den ein früheres Paket schon trägt, bekommt `-<Paket>` angehängt, so oft, bis er weder in einem früheren
noch im selben Paket vorkommt. Ist ein Paket ungültig, wird für das ganze
Projekt nichts geschrieben. Innerhalb eines Auftrags werden viele Notizen kürzer
gekürzt, keine fällt weg. Gekürzt wird eine Notiz (#148) zuerst um ihre ältesten Kommentare (mit dem
Vermerk `(N ältere Kommentare ausgelassen)`), dann am Text; der neueste Kommentar, etwa ein Widerruf
oder eine Antwort des Menschen, bleibt stehen. Über die Brücke erscheint eine vom Plan geschlossene Notiz im Frachtraum als
Entscheidung „überflüssig“ (Grund mit `verworfen:` bzw. `zusammengeführt in #<nr>`), ihr Widerruf
öffnet sie wieder; ein ungültiger Plan zählt im Logbuch als „ohne Ergebnis“.

Je Notiz, die bleibt, aus derselben Antwort:

- **klar** (keine Frage beim Menschen): die fehlenden oder leeren Abschnitte werden ergänzt (geprüft wie
  im Auftragsschreiber); die Notiz wird nie einzeln freigegeben, sondern geht an ihre Mission (unten).
  `triage` ohne Frage beim Menschen gibt es nicht (#146): Lässt der Plan eine Notiz so auf `triage`, fragt
  das Programm selbst (Feld `fragenErgaenzt: true`; Punkt `zu dünn`, Sachverhalt der Grund des Admirals,
  Optionen „Notiz ergänzen (was fehlt: …), dann neu triagieren“ als Empfehlung oder „verwerfen“); der
  Plan bleibt gültig, und die Notiz ist **kritisch** wie jede gefragte.
- **kritisch** (mindestens eine Frage beim Menschen, gleich welche Zuordnung): genau ein Kommentar mit
  allen Fragen, die nach der Liste beim Menschen liegen; das Label bleibt, die Notiz kommt erst nach der
  Antwort (in einem späteren Lauf) in eine Mission.

Überflüssig ist eine Notiz im Plan selbst (`ueberfluessig`, oben): geschlossen (`not planned`) mit Grund
und Fundstelle; die Labels bleiben, Wiederöffnen mit einem Kommentar bringt sie zurück in die Triage.

**Missionen in der Forge** (#147): Die klaren Notizen mit `mission` oder `neue_mission` im Plan werden
Mission für Mission geschrieben, je Notiz in dieser Reihenfolge:

1. der Kommentar `**Triage: Missionsziel von Mission #<nr> „<Titel>“, Warp frei**` (bzw. `von neuer
   Mission „<Titel>“`) mit Grund und Herkunft der Zuordnung, den Entscheidungen der Fragerunde und den
   ergänzten Abschnitten im Wortlaut;
2. der Text der Notiz wird **ergänzt, nicht ersetzt**: ein fehlender Abschnitt kommt ans Ende, ein
   leerer bekommt seinen Inhalt unter die Überschrift; der bisherige Text bleibt Zeichen für Zeichen
   stehen (auch Zeilenenden und Leerzeichen). Ist nichts zu ergänzen, wird er nicht angefasst;
3. die Mission: eine **neue** entsteht nur, wenn mindestens eines ihrer Missionsziele in diesem Lauf klar
   ist, über den Auftragsschreiber (`missionAnlegen`, oben) mit `epic_label`, der Begründung des Plans
   als Text und den klaren Missionszielen; danach der Kommentar `**Triage: Mission aus dem Schnittplan**` mit
   Titel, Begründung, Missionszielen, den Missionszielen, die nach ihrer Antwort später dazukommen, dem
   Hinweis, wann sie Warp frei bekommt, und dem Widerruf (`ready_label` an der Mission ab). An eine
   **offene** Mission kommt zuerst ein Kommentar mit den neuen Missionszielen und ihrer Herkunft, dann
   wird jede Notiz verknüpft und in ihre Liste `## Missionsziele` eingetragen (`missionszielAnhaengen`;
   steht sie dort schon, etwa nach einem Widerruf, wird nichts doppelt verknüpft); die Grenze von
   8 Missionszielen prüft schon der Plan;
4. zuletzt `ready_label` dazu, `needs-triage`/`needs-info` ab. Erst jetzt, denn eine Notiz mit
   `ready_label`, die an keiner Mission hängt, wäre wieder ein eigener Einsatz. Eine **neue** Mission
   bekommt `ready_label` erst nach ihrem ersten so freigegebenen Missionsziel; scheitert vorher das
   Verknüpfen, ihr Kommentar oder jede Freigabe, bleibt sie ohne (der Treiber startete sonst einen
   leeren Außeneinsatz), steht aber mit `nummer` und `url` in der Ausgabe. Scheitert nur ihr eigenes
   `--add-label`, holt es ein späterer Lauf nach (#149, vor den Notizen; `--trocken` meldet nur): an
   einer offenen Mission ohne `ready_label`, an der der Kommentar `**Triage: Mission aus dem
   Schnittplan**` einer berechtigten Rolle steht, ohne berechtigten Kommentar ohne Triage-Marke darunter
   (Einwand, Widerruf), die nie `ready_label` trug (Ereignis `labeled`; wer es abnahm, hat widerrufen) und
   mindestens ein offenes Sub-Issue mit `ready_label` hat. Erst der Kommentar `**Triage: Warp frei der
   Mission nachgeholt**` mit Herkunft, dann das Label; Missionen eines Menschen tragen den Kommentar nie.
   Trägt eine **offene** Mission noch `needs-triage`/`needs-info`, nennt ihr Kommentar das, und mit ihrem
   ersten so freigegebenen Missionsziel nimmt die Triage das Label an ihr ab (#170); sonst stünde sie im
   Frachtraum weiter als offene Notiz.

Scheitert ein Schritt, bleibt die Notiz bei diesem Schritt stehen und ihr letzter Kommentar ist der der
Triage: Der nächste Lauf überspringt sie (`wartet`), statt etwas doppelt anzulegen oder zu kommentieren,
bis ein Mensch darunter kommentiert. Scheitert der Kommentar an einer Notiz, ändert sich an ihr nichts
und sie kommt nicht in die Mission; scheitert der Kommentar an der Mission, wird nichts angehängt bzw.
keine Notiz der neuen Mission freigegeben. Ein zweiter Lauf ohne neue Notizen ändert nichts: Die
freigegebenen tragen kein Triage-Label mehr, die gefragten warten, die auf `triage` gelassenen werden
wieder nur geklärt.

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
(agent-skills/ADR-0002), außer aus einem Lernvorschlag über den Auftragsschreiber (eine Sternzeit-Notiz)
und ebenso eine Mission aus dem Schnittplan, und spricht bisher
nur GitHub; ein Gitea-Repository steht in `fehler`.

**Lernvorschläge** (#117): Nennt der Adapter `lern_issue`, triagiert derselbe Befehl vor dem Schnittplan
jeden Vorschlag der Lernschleife an diesem Issue einzeln, einen `claude -p` je Vorschlag (Schema
`triageSchema()`, dieselbe Fragerunde und Liste „beim Menschen“). Sie sind Kommentare am Sammel-Issue;
ein klarer wird eine Sternzeit-Notiz und geht in denselben Schnittplan wie die Tickets (#170).
Als Vorschlag zählt nur ein Kommentar mit `<!-- lernschleife -->` der Rollen oben. Jeder
Vorschlag hat die Kennung `Lernvorschlag <id>/<n>` (Id des Kommentars der Lernschleife, Nummer
darin); alle Kommentare der Triage dazu stehen am `lern_issue` und nennen sie im Kopf, und als Antwort
zählt dort nur ein Kommentar, der sie in der ersten Zeile nennt (eine weiter unten zitierte Kennung,
etwa im „Vorher“ eines Widerrufs, zählt nicht).

- **klar:** zuerst der Kommentar `**Triage: Lernvorschlag <id>/<n> wird Sternzeit-Notiz für den Schnittplan**`
  mit Herkunft, dann legt der Auftragsschreiber die Notiz an (Abschnitte wie oben nachgetragen
  und geprüft, mit `needs-triage`, im Text der Vorschlag und `Herkunft: <Link des Kommentars>`),
  dann der Kommentar `Vorschlag <n> aus <Kommentar> → #<neu>, widerrufbar (Lernvorschlag <id>/<n>)`.
  Die Notiz geht in den Schnittplan desselben Laufs: Sie wird Missionsziel einer Mission (erst dann
  `ready_label`), zusammengeführt, geschlossen oder gefragt wie jede Notiz, nie ein loses Missionsziel
  (#170). Widerruf an der Notiz; hängt sie schon an einer Mission, dort `ready_label` ab, `needs-triage` an.
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

**Abschlussprüfung** (#147): Nach dem Schreiben liest der Lauf jede Notiz seiner Eingabe (die Notizen fürs
Modell und die wartenden; Missionen und `fremd` nicht) neu aus der Forge (`gh issue view` mit Kommentaren,
`gh api …/issues/<nr>` Feld `parent_issue_url`, die Mission einmal je Lauf). Erlaubt sind nur drei
Endzustände: **geschlossen mit Grund** (der letzte Triage-Kommentar nennt `Grund:` oder `Zusammengeführt in
#<nr>`); **Missionsziel einer Mission mit `ready_label`** (offen, Sub-Issue einer offenen Mission mit `epic_label`;
eine in diesem Lauf angelegte Mission trägt `ready_label` ebenfalls); **in der Triage mit offener Frage**
(`needs-triage`/`needs-info`, der letzte Triage-Kommentar ist eine Frage ohne Antwort darunter). Alles
andere ist eine Abweichung, auch eine klare Notiz, die der Plan auf `triage` ließ, und eine wartende
Notiz, deren letzter Triage-Kommentar keine Frage ist (gescheiterte Freigabe): Der Lauf ist dann
`unvollstaendig`, nicht beendet. Die Notizen aus Lernvorschlägen dieses Laufs gehören zur Eingabe; dazu
nennt `abweichungen` jedes andere offene Ticket mit `ready_label`, das an keiner offenen Mission hängt
(freigegeben, aber ohne Mission: kein Außeneinsatz startet es; #170), ohne es in `geprueft` zu zählen. Ausgabe `abschluss` = `{geprueft, sauber, abweichungen[] {forge, nr,
titel, zustand, grund}}` und `zustand` = `beendet` | `unvollstaendig` | `abgebrochen`; bei `--trocken`
und nach einem Abbruch entfällt die Prüfung (`entfaellt` nennt warum). Über die Brücke steht die Zeile dann als
`Triage-Lauf unvollständig: …; N Notizen nicht sauber abgearbeitet: #a (<grund>), …` im Flottenlogbuch und
`triage.abschluss` im Frachtraum.

**Sauberes Ende** (#147): Jeder `claude -p` des Laufs endet mit ihm. Bei Leerlauf (`leerlaufMs`) beendet
`starte` den ganzen Prozessbaum (Windows `taskkill /T /F`, sonst die Prozessgruppe); über `abbruch`
(ein `AbortSignal`) ebenso sofort, Ergebnis `fehler: 'abbruch'`, danach startet kein Aufruf mehr.
`triagiere` prüft den Abbruch (`TriageWelt.abgebrochen`) vor jedem Block, der schreibt (Nachfreigabe,
Schnittplan, Missionen, Lernvorschläge, Abschlussprüfung): Danach wird nichts mehr geschrieben, was bis
dahin geschrieben ist, steht in der Ausgabe. `flotte triage` bricht so bei Ctrl+C ab (Exit-Code 130,
die Ausgabe mit `zustand: abgebrochen`). Der Treiber bricht einen Triage-Lauf ab, wenn er anhält
(`flotte anhalten`, die Logbuchzeile `Triage-Lauf abgebrochen: Treiber angehalten; bis dahin …`, die
Entscheidungen und der Schnittplan bis dahin bleiben widerrufbar) oder Ctrl+C bekommt (Logbuch und
Zustand noch vor dem Ende); anders als ein Missions-Lauf übernimmt ihn kein Neustart. Er steht mit `seit` und den pids seiner Aufrufe im Zustand
(`triageLauf`); steht er dort beim Start noch, meldet der Treiber ihn als abgebrochen (Logbuch und
`triage.abschluss`) und beendet einen noch lebenden Aufruf, wenn Startzeit und pid passen (D16).

**Planen:** Der Befehl hält keinen eigenen Zustand und lässt sich beliebig oft wiederholen, etwa
stündlich über die Aufgabenplanung: `schtasks /Create /SC HOURLY /TN flotte-triage /TR "bun <skills>\flotte\src\cli.ts triage <repo>"`.

**Über die Brücke** (#116, Frachtraum): Mit `--bruecke` liest der Treiber die offenen Sternzeit-Notizen
und die unbeantworteten Fragen der Triage aus der Forge (beim Start, höchstens alle 30 min und sofort
nach einer Handlung des Frachtraums) und meldet sie samt den Entscheidungen seiner Triage-Läufe. Auf
Knopfdruck führt er diesen Befehl für sein Projekt aus (Admiral-Konto, einen Lauf zur Zeit), schreibt
eine Antwort des Menschen als Kommentar ans Ticket (ohne Triage-Marke; die nächste Triage nimmt sie als
Tatsache) und widerruft eine Entscheidung: erst der Kommentar, dann (#148) bei einer an eine Mission
gehängten Notiz das Lösen aus ihr (Sub-Issue und Zeile der Liste `## Missionsziele`), `ready_label` ab
und `needs-triage` an, oder das Ticket wieder offen. Bei einem Lernvorschlag nennt die Antwort seine Kennung, der Widerruf
von „klar“ wirkt an ihrer Sternzeit-Notiz (#170), der von „überflüssig“ ist nur der Kommentar am `lern_issue`.

**Schnittplan über die Brücke** (#148): Der Treiber meldet den Schnittplan seines letzten Triage-Laufs
(`triage.schnittplan`): die angelegten Missionen (Nummer, Titel, Begründung, verknüpfte Missionsziele,
Warp frei oder nicht, Fehler) und die offenen, an die der Lauf Notizen hängte, dazu die geschlossenen
Notizen mit Grund und Verweis. Die Missionen sind vom Lauf schon freigegeben; je Mission kann der Mensch
sie im Frachtraum **widerrufen** (`schnitt-widerruf`, mit Einwand). Jede Änderung erst nach dem Kommentar
`**Widerruf des Menschen (Mensch über die Brücke)** — …` mit Einwand und Herkunft:

- **neue Mission** (vom Lauf angelegt): `ready_label` ab. Wartet sie im Einsatz und lief noch nie
  (kein Zug, kein Auftrag), wird sie ausgetragen (aus dem Einsatz, aus `aufgenommen` und aus dem Zustand;
  sie startet nicht und hält das Ende des Einsatzes nicht auf). Hat sie schon begonnen, wird sie pausiert
  (der laufende Zug läuft zu Ende, keine Arbeit geht verloren, wie `pausieren`) und ihr Schalter fürs
  Andocken auf `mensch` gestellt (#112): Ihr PR, auch einer noch vor dem Kopf der Andock-Schlange, wird nur
  von einem Menschen angedockt; ein schon laufendes Andocken läuft zu Ende. Jede vom Lauf verknüpfte Notiz
  bekommt einen Kommentar, wird gelöst (`DELETE …/issues/<mission>/sub_issue`, Zeile aus der Liste) und
  bekommt `ready_label` ab, `needs-triage` an; zuletzt wird die Mission `not planned` geschlossen (nie
  gelöscht, wieder zu öffnen; offen böte der nächste Schnittplan sie wieder an). Eine ausgetragene
  Mission merkt sich der Zustand (`widerrufen`, #149): Das Einsammeln ohne `--epics` nimmt sie nicht wieder
  auf, auch nach einem Neustart und wenn `ready_label` abnehmen und Schließen scheiterten (einmal je Prozess
  eine Zeile im Flottenlogbuch); nur die Handlung `aufnehmen` holt sie bewusst zurück und hebt das auf.
  Eine schon begonnene behält ihren Eintrag im Zustand (pausiert, später `fertig`) und startet nie neu.
- **bestehende Mission:** nur die vom Lauf angehängten Notizen gehen so zurück; die Mission bleibt, wie
  ein Mensch sie freigegeben hat.

Der Kommentar an der Notiz sagt, dass sie nicht wieder in diese Mission soll; er trägt keine Triage-Marke,
also wartet die Notiz danach nicht (`wartetAufAntwort`), und die nächste Triage nimmt ihn als Tatsache.
Ihre Entscheidung „Warp frei“ gilt damit als widerrufen. Der Widerruf einer einzelnen Entscheidung
(`triage-widerruf`) einer angehängten Notiz nennt im Kommentar ebenso das Lösen und „Nicht wieder in
Mission #<nr>“. Scheitert ein Schritt, steht er im Ereignis,
im Flottenlogbuch und am Eintrag der Mission (`fehler`); nichts wird wiederholt. Scheitert schon der
erste Kommentar an der Mission, ändert sich nichts. Felder und Handlungen: `flottenbruecke/SCHNITTSTELLE.md`.

**Ausgabe:** `trocken`, `repos` (`repo`, `forge`), `fehler` (`repo` oder `forge`, `fehler`),
`tickets` (je `forge`, `nummer`, `titel`, `url`, `ergebnis` = `klar` | `ueberfluessig` | `kritisch` |
`wartet` | `mission` | `fremd` | `ungueltig`, `geschrieben`, `kommentar`, gegebenenfalls `fehler`, `sitzung`, `herkunft` und `grund` der Entscheidung, bei
`--trocken` und `klar` der ergänzte `body`; bei einer Notiz aus dem Schnittplan `zuordnung` = ihre Art
im Plan, bei `klar` und angehängt `mission` = die Nummer ihrer Mission; bei einem Lernvorschlag
`lernvorschlag` = Kennung, `nummer`
das `lern_issue`, `url` der Kommentar der Lernschleife, bei `klar` `missionsziel` = die Nummer ihrer
Sternzeit-Notiz, die als eigenes Ticket im Schnittplan desselben Laufs steht) und `fragen` (je
`forge`, `ticket`, `url`, `frage`, `optionen`, `empfehlung`, `grund`, `herkunft`, `marke` = Punkt der
Liste: `nach außen`, `Geld`, `Produktivdaten`, `Sicherheit und Zugänge`, `Kundentext`, `Architektur`;
bei einem Lernvorschlag `lernvorschlag`) mit den in diesem Lauf neu gestellten Fragen, dazu `offen`
in derselben Form mit den Fragen früherer Läufe, die unter einem `wartet` noch ohne Antwort stehen.
`schnittplan` (#146) je Projekt mit Notizen fürs Modell: `forge`, `sitzung` (die des geltenden Plans,
bei Paketen die des letzten), nach einer Reparaturrunde `reparatur` (`sitzung` und `fehler` des ersten
Plans), `aufrufe` (die Admiral-Aufrufe für die Notizen dieses Projekts: 1, je Reparatur und je weiterem
Paket einer mehr), nur bei einer Teilung `pakete` (je `notizen`, `sitzung`, gegebenenfalls `reparatur`), `neue_missionen` (je
`schluessel`, `titel`, `begruendung`, `kinder` = Nummern der Notizen; #147, wenn ein Missionsziel klar war,
dazu `labels` (mit `ready_label` erst nach der ersten Freigabe), `body`, `kommentar`, `angehaengt` =
die Notizen in ihr, `geschrieben`, angelegt `nummer` und `url` (auch wenn danach ein Schritt
scheiterte), gegebenenfalls `fehler`), `missionen` (#147, die offenen Missionen, an die
Notizen kommen sollten: je `nummer`, `titel`, `kinder` = die vorgesehenen Notizen, `angehaengt`, `kommentar`, `geschrieben`, bei `--trocken` der
neue `body`, gegebenenfalls `fehler`), `zuordnungen` (je `notiz`,
`titel`, `url`, `art`, `grund`, `herkunft`, bei `mission` die Nummer `mission`, bei `neue_mission`
deren `neue_mission`, bei `zusammengefuehrt` der Verweis `in`, bei `ueberfluessig` die `fundstelle`;
`fragen` der Fragerunde und, wo geschrieben, `abnahmekriterien` und `verifikationsweg`; bei einer vom
Programm auf `triage` herabgestuften Notiz `herabgestuft`, bei einer vom Programm gefragten Notiz
`fragenErgaenzt: true` (beides auch an ihrem Eintrag in `tickets`);
bei den geschlossenen Arten dazu `geschrieben`, `kommentar` und gegebenenfalls `fehler`), bei einem
ungültigen Plan oder nicht lesbaren Missionen `fehler` und leere Listen. Geschlossene Notizen stehen
nur hier, nicht in `tickets`. `nachgeholt` (#149): je Mission der Triage, deren `ready_label` der Lauf
nachträglich setzte (oder bei `--trocken` setzen würde), `forge`, `nummer`, `titel`, `kinder` = ihre
offenen Sub-Issues mit `ready_label`, `kommentar`, `geschrieben`, gegebenenfalls `fehler`.
`abschluss` und `zustand` (#147): oben, **Abschlussprüfung**.
`--trocken` erstellt Plan und Entscheidungen und druckt sie, schreibt nichts; es zeigt die neuen
Missionen samt Body, die Listen der offenen und die ergänzten Texte der Notizen. Im Logbuch der Brücke
zählt der Lauf dazu die angehängten Notizen und die angelegten Missionen
(`… Warp frei (2 an Missionen angehängt), 1 Mission angelegt, Warp frei nachgeholt für Mission #100, …`);
ein gescheiterter Schritt an einer
Mission zählt einmal als „ohne Ergebnis“, an ihren Notizen, nur ohne solche an der Mission selbst. Die
Anzeige des Plans ist #148.

## Werft

Nach dem Andocken auf `main` zieht die Werft die berührten Stacks nach, auf dem Rechner und nicht im
Brücken-Container (agent-skills/ADR-0005). Einmal je Rechner aus einem Terminal starten (Sperre
`~/.flotte/werft.lock`; ein zweiter Start endet mit Exit 1, die Sperre eines toten Prozesses wird
übernommen):

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" werft [<ordner>...] [--bruecke http://127.0.0.1:4747] [--einmal]
```

- Sie nimmt jedes Repository in den Ordnern (Standard `~/git`, nur Hauptverzeichnisse) mit dem
  Adapterschlüssel `deploy` (`mission/references/adapter.md`, „Werft“). Alle 15 s schaut sie, welches
  fällig ist (`deploy.abfrage_s`, Standard 120 s), holt `origin/<main_branch>` und liest den Adapter
  von dort. Ob ein Repository `deploy` hat, sieht sie dagegen an `origin/HEAD`, ohne zu holen: Kommt
  `deploy` erst mit einem Andocken in ein Repository, nimmt sie es erst im Takt nach dem
  nächsten `git fetch` dort auf, das ein anderer macht (der Treiber, ein Lauf, der Mensch).
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
  (`<stack>.sicherung`) und prüft sie (`mission/references/adapter.md`, „Geprüfte Sicherung“). Dann
  wartet die Migration auf die Freigabe des Menschen auf der Brücke (Handlung `migration_freigeben`
  mit PIN), gebunden an Commit, Sicherung und den Befehl zur Zeit der Sicherung (nennt der Adapter
  inzwischen einen anderen, wird sie abgelehnt). Erst dann läuft sie, genau einmal: Der Stand
  (`arbeit` je Stack: `wartet`, `gesperrt`, `laeuft`, `migriert`, `rot`) wird vor dem Start
  geschrieben, auch nach einem Absturz startet dieselbe Freigabe sie nicht noch einmal. Ohne
  geprüfte Sicherung steht der Stack rot und jede Freigabe wird abgelehnt.
- Einstellungen über die Brücke (Maschinenraum, mit PIN, #90), je Repository im Stand gespeichert:
  Abfrageabstand (`abfrage_s`), **Werft an/aus** (aus: nichts geholt, nichts gezogen, keine Migration;
  wieder an, zieht sie nach, was inzwischen kam), **Stack an/aus** (ein abgeschalteter Stack wird nie
  gezogen, auch nicht auf Knopfdruck; was ihn berührte, holt er nach dem Einschalten nach) und
  **Test-Migrationen selbst** ja/nein. Eine Freigabe für eine abgeschaltete Werft oder einen
  abgeschalteten Stack wird abgelehnt, die Migration wartet weiter auf eine neue. Der Bericht zeigt
  die wirksamen Werte (`flottenbruecke/SCHNITTSTELLE.md`, „Werft“).

## Prognose

Die Brücke sagt je wartender Mission „voraussichtlich 3–5 h“ und oben in „Erledigt heute“, wann der
Backlog etwa leer ist. Gerechnet wird je Repository aus dem, was der Treiber dort gemessen hat:

- **Messen:** Je fertiger Mission schreibt der Treiber eine Zeile in
  `<git common dir>/flotte/messungen.jsonl`. Sie überdauert Einsätze. In der Zeile stehen:
  - die Arbeitszeit (`arbeitS`) vom ersten Start bis zum letzten `FLOTTE-ENDE`, ohne die Zeit, in der
    der ganze Lauf auf dich wartete (`menschWartenS`), pausiert war (`pauseS`) oder sein nächster Zug
    an einer Bremse hing, am Limit des Kontos oder am RAM (`limitS`, #202); die drei stehen als eigene
    Felder daneben, ältere Zeilen haben `pauseS` und `limitS` nicht;
  - die Andockprüfungs-Zeit des Treibers und das Konto;
  - je Paket die Klasse (mechanisch, Standard, Urteil, Urteil-hoch) und die Eskalationen, gelesen
    aus den Ingenieur-Aufrufen im Log des Laufs.
- **Rechnen:** Monte-Carlo über die gemessenen Verteilungen statt eines Mittelwerts, 2000 Züge mit
  festem Seed. Je Zug kommen aus den Messungen:
  - ein Tempo (Arbeitszeit je gewichtetem Paket einer fertigen Mission);
  - die Pakete der neuen Mission mit Klasse und Eskalationen;
  - eine Andockprüfungs-Zeit.

  Die Komplexität zählt über die Klasse (Gewicht 0,5 / 1 / 2 / 3, je Eskalation +1), verteilt auf
  bis zu drei Pakete gleichzeitig, nicht über die bloße Zahl der Tickets. Für den Backlog verteilt
  die Rechnung alle freigegebenen, noch offenen Missionen auf die Plätze der Obergrenze. Eine laufende
  Mission braucht dabei nur noch ihren Rest. Angezeigt wird die Spanne P50–P90.
- **Schwelle:** erst ab 5 gemessenen Missionen (Adapter `prognose_ab`). Vorher zeigt die Brücke
  „Prognose ab 5 Missionen · bisher N“. Jede weitere Mission rechnet sie von selbst mit.
- **Selbstprüfung:** Beim ersten Start einer Mission merkt sich der Treiber die Prognose; am Ende hält
  er fest, ob die echte Dauer samt Andockprüfung zwischen P10 und P90 lag. Die Brücke zeigt „traf 7 von 10“.
  Liegt die Quote ab 5 geprüften Missionen unter 60 %, blendet sie die Prognose aus: „zu ungenau für
  dieses Projekt“.
- **Wartezeit auf dich** ist nirgends eingerechnet; die Brücke sagt das dazu.

`flotte messen` gibt die Messungen unter `prognose` mit aus: Anzahl, Verteilungen, Pakete je Klasse
und Trefferquote.

## Messen

`flotte messen <einsaetze.json>` (Form: `messung/einsaetze.beispiel.json`) liest die Transkripte
der Läufe samt ihrer Subagenten und gibt je Einsatz unter anderem aus:

- **`tokens`:** Eingabe, Cache-Schreiben, Cache-Lesen und Ausgabe, je Agent-Typ, je Mission und je
  Paket, jeweils mit **Cache-Quote** (Lesen durch alles, was hineinging). Je Paket die Zahl der
  Ingenieur- und Erster-Offizier-Läufe, also die **Review-Runden**.
- **`kontext_anteil`** je Agent-Typ: welcher Anteil seiner gewichteten Tokens auf Werkzeugergebnisse
  einer Art fällt — Test, Andockprüfung, Diff (`git diff/show/log`), Lesen, übrige Shell. Ein Ergebnis kostet
  einmal das Schreiben in den Cache und danach bei jedem weiteren Modellaufruf das Lesen. Der Anteil
  ist die **Obergrenze** dessen, was eine Maßnahme sparen kann, die diese Ergebnisse kürzt.
- **`verlauf`** (unter dem Treiber): Durchlaufzeit je Mission ohne Warten auf dich und die
  Fehlerquote (Rückgabe an den Lauf, blockiert, abgebrochen).

**Was das schon entschieden hat (21.11.2026).** Für das „Sparpaket“ aus der Skill-Recherche lief
`flotte messen` über alle Läufe der drei Konten vom 1. bis 21.11.2026 (448 Aufrufe von Ingenieuren und
Ersten Offizieren, 195 Pakete). Je Agent-Typ kosteten Testausgaben 0,4–0,5 % der Tokens, Diffs im Review
4,2–4,5 %, Lesen 5–10 %, übrige Shell 5–17 %; die Cache-Quote lag bei 96–98 %. 13 von 195 Paketen
brauchten eine zweite Review-Runde. Ein Hook, der Testausgabe kürzt, ein enger Nach-Review und ein
Review-Paket als Datei hätten höchstens diese Anteile treffen können; sie wurden deshalb nicht
übernommen (Begründung im Pull Request des Sparpakets).

## Prüfen

`bun test` braucht keine Installation und läuft in der Andockprüfung (`gate.ps1`). Die Typprüfung
(`bun run typecheck`, `tsc -p .`) braucht die `devDependencies` und damit vorher `bun install` in
`flotte/`; ein Worktree von `Up` hat kein `node_modules`, und die Andockprüfung fährt sie nicht.

## Bei dir

Fragen, die der Admiral nicht entscheiden darf; das Andocken bei `merge: mensch`; eine Anmeldung,
wenn ein Konto abgemeldet ist; Widerruf einer Entscheidung als Kommentar am Issue oder auf der
Brücke; eine blockierte Mission neu einreihen oder aufgeben (Brücke); Vorrang mit `prio/hoch` oder auf
der Brücke; eine freigegebene Mission aufnehmen, eine Mission pausieren und fortsetzen, ihr Andocken stellen
(Brücke, Sternenkarte); einen Triage-Lauf starten, eine Frage der Triage beantworten, eine Entscheidung
der Triage widerrufen (Brücke, Frachtraum).
