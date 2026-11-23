---
name: mission-nacharbeit
description: Die offenen Punkte eines abgeschlossenen Außeneinsatzes abarbeiten — Fragerunden im Frontier-Verfahren, je Punkt entscheiden, ob er in dieser Sitzung erledigt, verworfen oder ein Ticket wird, dann umsetzen und nachdokumentieren. Legt ein needs-triage-Ticket nur an, wenn der Mensch gebraucht wird.
---

# Missions-Nacharbeit

Ein Außeneinsatz (`/mission`) endet mit einem offenen Pull Request und einem Abschlusskommentar, in dem steht,
**was er offen gelassen hat**: nicht gefahrene Verifikationen, Handgriffe des Betreibers,
Doku-Lücken, und die Funde der Ersten Offiziere außerhalb der Tickets. Dieser Ablauf arbeitet diese Liste
ab.

Zielvorgabe ist das Argument des Aufrufs: die Nummer der Mission, ersatzweise die Nummer des
Pull Requests. Ohne Argument nimmst du den letzten Außeneinsatz des Repositorys — der jüngste
Missions-Branch mit offenem Pull Request.

Der Projektadapter ist derselbe wie bei `/mission`: **`.claude/epic.md`**. Lies ihn als Erstes; er
nennt Forge, Vokabulardatei, ADR-Pfad, Testbefehle, Commit-Konvention und `base_branch`. Die
Regeln von `/mission` gelten hier weiter, insbesondere: **der Basis-Branch — `base_branch` aus dem
Adapter, nach einem Lauf maßgeblich die `base` des Pull Requests — ist niemals direktes Ziel eines
Commits**, Datenmigration ist Handarbeit, keine Testsuite wird durch Löschen von Tests grün,
Fachsprache aus der Vokabulardatei.

---

## Was diesen Ablauf von `/mission` unterscheidet

`/mission` hat einen fremden Scope: die Abnahmekriterien der Kind-Tickets, und nichts darüber hinaus.
Nacharbeit hat **keinen vorgegebenen Scope** — sie ist genau die Arbeit, die außerhalb lag. Damit
fällt die Sicherung weg, die bei `/mission` der Ticket-Body war, und an ihre Stelle tritt die
Fragerunde: **jeder Punkt wird einzeln entschieden, bevor er angefasst wird.**

Deshalb auch: **hier arbeiten keine Subagenten.** Die Punkte sind einzeln klein, hängen
inhaltlich zusammen und brauchen den Kontext des ganzen Laufs. Ein Ingenieur, dem man den
halben Zusammenhang in den Auftrag schreiben müsste, kostet mehr als er trägt. Wird ein Punkt so
groß, dass ein Subagent sich lohnt, ist das das Signal, dass er ein Ticket braucht und nicht in
diese Sitzung gehört.

---

## Die Regel, um die es geht

Ein neues Ticket nur, wenn der Mensch gebraucht wird: ein Befund, der eine Entscheidung von der
Liste „Beim Menschen“ verlangt (Sicherheit und Zugänge, ein Bruch mit einer Architekturentscheidung,
was nach außen geht) oder den Ablauf des Projekts ändert. Arbeit, die klar ist und nach Zeit und
Umfang angemessen ist, wird in der Mission erledigt, bevor sie andockt: zuerst gefundene Fehler und
was zum Missionsziel gehört. Klare Arbeit, die dafür zu groß ist, wird ein Issue mit `epic` und dem
Freigabelabel, nicht `needs-triage`. Ein Wunsch ohne beobachteten Schaden wird verworfen: eine Zeile
unter „Verworfen“ im Missions-PR, kein Ticket. Jedes Ticket für den Menschen trägt `needs-triage`
und einen Satz zur Ursache, und der Missions-PR listet die angelegten Tickets. Eine Ticketfrage geht
nicht an den Menschen.

Der Grund: Ein Ticket anzulegen ist billig und fühlt sich nach Fortschritt an — und es verlagert
Arbeit in eine Zukunft, in der niemand mehr weiß, warum sie dasteht. Die drei Zeilen Nachtrag,
die den Fund erklären, sind oft die ganze Lösung. Die Umkehrung gilt genauso: **ein Punkt, der
nicht in diese Sitzung passt, wird nicht hineingequetscht.** Dann ist das Ticket richtig.

**Unter dem Flotten-Treiber** gehen die Fragerunden an den Admiral statt an den Nutzer (`mission/SKILL.md`,
„Wie gefragt wird"; Frageblock: `flotte/references/bloecke.md`). Die
Ticketfrage entscheidet er; was im Entscheidungsrecht dem Menschen vorbehalten ist, legt er dem
Menschen vor. Die Bestätigung vor dem Handeln (Phase 2, Ende) gibt ebenfalls er.

---

## Phase 0 — Rüsten

- `.claude/epic.md` lesen, Forge-Zugang herstellen und **einmal verifizieren** (ein Lesezugriff).
- `git status` muss sauber sein. Ist das Arbeitsverzeichnis nicht sauber: **abbrechen und
  fragen.** Niemals fremde Änderungen wegwerfen oder mitcommitten.
- Feststellen, wie der Pull Request des Laufs steht. **Der Missions-Branch des Laufs ist die
  Arbeitsfläche, solange sein Pull Request offen ist** — dort gehört die Nacharbeit hin, wenn sie
  denselben Gegenstand betrifft (siehe Phase 3). Er liegt im Worktree `<worktree_root>/epic-<nr>`;
  das Hauptverzeichnis wird nie umgeschaltet (`mission/SKILL.md`, Regel 11). Der Missions-Worktree lebt
  mit der Sitzung des Laufs (`mission/SKILL.md`, Phase 3); steht er nicht mehr, legst du ihn mit
  `Up -Package epic-<nr> -Branch epic/<nr>-<slug>` auf dem vorhandenen Branch neu an (#38).
- **Vor dem ersten `Up`** läuft `worktree.ps1 -Action CleanupStale` wie in `/mission` (Phase 0), damit
  Reste toter Sitzungen nicht im Weg stehen; das Ergebnis gehört in den Bericht. Waisen eines
  `nacharbeit-<nr>`-Ordners ohne Lock erkennt es noch nicht, nur solche mit Lock (#34).
- **Den Basis-Branch feststellen:** `base_branch` aus dem Adapter ist der Standard, maßgeblich
  aber — sobald der Pull Request existiert — dessen eigene `base`. Eine Mission kann von einer anderen
  Mission abzweigen; dann ist der Hauptzweig des Repositorys nicht die Basis dieses Laufs.
- **Spec-Modus erkennen** (`issue_form: spec`): Nur **ohne** Kind-Tickets liegt alles am
  Spec-Issue selbst, und die Paket-Branches heißen nicht nach Kind-Issues. Hat das Spec-Issue
  Kinder, gilt derselbe Weg wie im Modus `tickets` — die Kinder sind die Pakete. Das
  Namensschema der Branches steht in `mission/SKILL.md` (Phase 3).
- `git worktree list` prüfen. Reste eines früheren Laufs melden, nicht löschen — dafür ist
  `/mission-aufraeumen` da.
- Vokabulardatei lesen, und das Verzeichnis für bewusst Verworfenes, falls der Adapter eines
  nennt (`out_of_scope_dir`). Dort steht, welche Idee schon einmal geprüft und abgelehnt wurde;
  ein Nacharbeitspunkt, der dort schon liegt, ist erledigt und nicht offen.
- **Teststand messen**, wenn irgendein Punkt Code berührt: Suiten- und Testzahl je Suite,
  gefahren und nicht aus dem `README` abgeschrieben. Ohne diese Zahl kannst du am Ende nicht
  sagen, ob eine Suite dazukam oder verschwand.

## Phase 1 — Die Liste zusammentragen

Aus **drei** Quellen, und keine davon reicht allein:

1. **Der Abschlusskommentar an der Mission.** Sein Abschnitt `### Was das Epic offen lässt` ist die
   Hauptquelle (ältere Läufe schreiben noch „Was das PRD offen lässt" — such nach beiden). Lies
   auch die Kommentare an den Kind-Tickets — dort stehen die Punkte, die nur ein einzelnes Ticket
   betreffen, und die im Abschlusskommentar zusammengefasst wurden. Kind ist dabei jedes Issue,
   das der Adapter nicht über `epic_label` als Mission kennzeichnet; eine Kante zwischen zwei Missionen
   ist Reihenfolge, kein Kind, und bleibt hier außen vor. **Im Spec-Modus ohne Kinder**
   (`issue_form: spec`) gibt es keine Kind-Tickets — alle Rückmeldungen zu den Paketen stehen als
   Kommentare am Spec-Issue selbst; **mit Kindern** gilt derselbe Weg wie im Modus `tickets`. Ergänze
   hier die Lauftafel (`references/lauftafel.md`): jeder dort verzeichnete Glut-Punkt (wartet auf
   den Menschen) gehört auf diese Liste. Lief der Lauf mit `Lauftafel aus` (Flotten-Treiber), gibt es
   keine Tafel; ihre Punkte stehen dann im Abschlusskommentar.
2. **Der Body des Pull Requests.** Dort steht, was beim Deploy passiert und welche Zusicherung
   nur gelesen und nicht gefahren wurde.
3. **Der Stand im Repository.** Ein Punkt kann zwischenzeitlich erledigt worden sein — vom
   Betreiber, von einem anderen Lauf, von einer Sitzung dazwischen. **Prüfe jeden Punkt am
   Repository nach, bevor du ihn auf die Liste nimmst.** Ein Handgriff, der als offen gemeldet
   wurde und längst getan ist, kostet sonst eine ganze Fragerunde.

Sortiere die Punkte in vier Arten. Die Art entscheidet, wie viel Fragerunde ein Punkt braucht:

| Art | Beispiel | Fragerunde |
|---|---|---|
| **Handgriff** — eine Handlung, kein Urteil | eine gitignorierte Datei verschieben, ein Verzeichnis löschen | keine, wenn lokal und reversibel — tun und melden |
| **Nachweis** — etwas gilt als geprüft, wurde aber nur gelesen | Containerstart, Migrationslauf, ein Bedienablauf im Browser | eine Frage: nachholbar oder hier nicht fahrbar? |
| **Doku-Lücke** — eine Aussage fehlt oder ist überholt | ein ADR-Satz, der ein Werkzeug nennt, das es nicht gibt | die eigentliche Fragerunde: *was* soll dastehen |
| **Fund** — eine Beobachtung außerhalb der Tickets | eine Doppelung, ein Geruch, ein ungeprüfter Randfall | die eigentliche Fragerunde: reicht Dokumentation, oder braucht es Arbeit |

Ein **Handgriff, der nicht lokal und reversibel ist**, ist kein Handgriff, sondern eine
Entscheidung: alles, was nach außen wirkt (Push, Deploy, Produktivdaten, Zugänge), geht in die
Fragerunde oder ist Abbruchbedingung.

## Phase 2 — Die Fragerunden

Im **Frontier-Verfahren**: Die Punkte der Liste bilden einen Entscheidungsbaum. Jede Runde stellt
alles, was jetzt entscheidbar ist — die Frontier. Was von einer noch offenen Antwort abhängt,
wartet auf die nächste Runde. Fertig ist die Fragerunde, wenn die Frontier leer ist. Gestellt wird
jede Runde nach `mission/SKILL.md` („Wie gefragt wird"), je Frage mit Antwortmöglichkeiten und deiner
Empfehlung.

**Die Fakten beschaffst du selbst, aber ohne Subagenten** (siehe oben). Braucht eine Frage einen
Fakt aus der Umgebung — steht die Datei noch da, was sagt der Adapter, ist der Test fahrbar —, sieh
selbst nach, bevor du fragst. Eine Frage, die auf einem ungeprüften Fakt steht, kostet eine ganze
Runde.

### Die eine Frage, die jeder Punkt beantworten muss

Neben dem inhaltlichen „was soll dastehen" trägt jede Runde eine zweite Frage, und die ist der
Zweck dieses Ablaufs:

> **Wird dieser Punkt in dieser Sitzung erledigt, wird er verworfen, oder braucht er ein eigenes
> Ticket?**

Du entscheidest sie selbst (Regel oben): Sie geht nicht als Frage an den Menschen, sondern steht
in der Runde als Zeile `✔ <Punkt> — Sitzung`, `✔ <Punkt> — verworfen` oder `✔ <Punkt> — Ticket`,
mit Grund. Beantworte sie nicht nach Gefühl, sondern nach Volumen. Nenne dabei, was du geschätzt
hast: welche Dateien, wie viele Zeilen, ob Code oder nur Text, ob ein Test dazukommt.

- **Sitzung** ist der Regelfall für alles, was klar ist und nach Zeit und Umfang angemessen —
  auch mit neuem Test. Zuerst gefundene Fehler, die so nicht andocken dürfen, und alles, was zum
  Missionsziel gehört: Eine Mission, deren Ziel nur halb erreicht ist, ist nicht fertig, und der
  Rest wird kein Folgeticket.
- **Verworfen** ist ein Wunsch ohne beobachteten Schaden: eine Idee, eine Verschönerung, „wäre
  schön, wenn“. Er steht als Zeile unter „Verworfen“ im Missions-PR, mit Grund; mehr nicht.
- **Ticket** nur in zwei Fällen. Mit `needs-triage`, wenn der Mensch gebraucht wird: eine
  Entscheidung von der Liste „Beim Menschen“ (`flotte/references/entscheidungsrecht.md`) — etwa
  Sicherheit und Zugänge oder ein Bruch mit einer Architekturentscheidung — oder eine Änderung am
  Ablauf des Projekts. Mit `epic` und dem Freigabelabel, wenn die Arbeit klar ist, aber für diese
  Sitzung zu groß (ein eigener Umbau, mehr als ein Subagent trüge) oder ihr Verifikationsweg hier
  nicht fahrbar ist; dann nimmt die Flotte sie ohne Triage.

Der häufigste Fall ist der Fund, für den ein datierter Nachtrag und ein Querverweis die ganze
Lösung sind: er hält die Erkenntnis fest, kostet eine Viertelstunde und erzeugt keine Arbeit, die
später niemand mehr begründen kann.

**Handle nicht, bevor der Nutzer bestätigt hat, dass ihr dasselbe Verständnis habt** — sobald die
Frontier leer ist, holst du diese Bestätigung ein.

## Phase 3 — Umsetzen

Auf dem **Missions-Branch des Laufs**, solange sein Pull Request offen ist und die Nacharbeit denselben
Gegenstand betrifft. Das ist der Normalfall, und er ist der bequemere: der Pull Request wird
ohnehin von einem Menschen gelesen, und die Nacharbeit gehört in dieselbe Lesung.

Zwei Dinge dabei, und beide sind leicht zu vergessen:

- **Ein eigener Commit, erkennbar als Nacharbeit.** Er gehört zu keinem Kind-Ticket. Nenne im
  Betreff die Mission und nicht eine Ticketnummer, sonst schließt eine `Closes`-Zeile später ein
  Ticket mit, das damit nichts zu tun hatte.
- **Der Pull-Request-Body bekommt einen eigenen Abschnitt „Nacharbeit".** Die `Closes`-Zeilen
  bleiben unangetastet bei ihren Tickets. Wer den Pull Request liest, muss sehen können, was von
  den Kindern kam und was danach dazukam — sonst prüft er die Nacharbeit gegen Abnahmekriterien,
  die sie nie hatte.

Ist der Pull Request schon angedockt, oder betrifft die Nacharbeit einen anderen Gegenstand: eigener
Branch, eigener Pull Request, Namensschema `nacharbeit/<epic-nr>-<slug>`, als Ziel derselbe
Basis-Branch wie beim ursprünglichen Lauf (`base_branch` aus dem Adapter, bei bereits angedocktem
Pull Request dessen `base`). Der Branch bekommt einen eigenen Worktree unter `worktree_root`,
angelegt mit `Up -Package nacharbeit-<epic-nr> -Branch nacharbeit/<epic-nr>-<slug> -From <push_remote>/<base>`
und abgeräumt mit `Down -Package nacharbeit-<epic-nr>`, **nur per `scripts/worktree.ps1` aus
`/mission`** (`mission/references/worktree.md`; Hauptverzeichnis: `mission/SKILL.md`, Regel 11). Exit 1
meldest du im Wortlaut, von Hand holst du nichts nach. Steht das Frontmatter nur auf dem
Missions-Branch, bekommt jeder Aufruf `-AdapterFile` (#38, `mission/references/worktree.md`, „Umstellung"). **Nie direkt auf den
Basis-Branch committen**, auch nicht für einen Einzeiler in einer Textdatei — das Andocken dorthin kann
deployen.

Nach jeder Änderung, die Code berührt: **den Testbefehl des Projekts fahren** und gegen den in
Phase 0 gemessenen Stand vergleichen. Auch dann, wenn du nur einen Kommentar geändert hast; eine
Kommentarzeile im falschen Block ist ein Syntaxfehler wie jeder andere.

## Phase 4 — Nachdokumentieren

Der Teil, der am leichtesten ausfällt, weil sich der Punkt nach dem Commit erledigt anfühlt.

- **Kommentar an der Mission.** Je abgearbeiteter Punkt eine Zeile: was war offen, was wurde
  entschieden, **mit welcher Begründung**, wo steht das Ergebnis. Dazu: was weiterhin offen ist
  und warum. Dieser Kommentar ist die Fortsetzung des Abschlusskommentars und der Ort, an dem in
  einem halben Jahr steht, warum ein Fund nicht zum Ticket wurde.
- **Kommentar am betroffenen Kind-Ticket**, wenn ein Punkt aus dessen Review kam.
- **Die Mission schließen**, wenn der Pull Request angedockt ist, jedes Kind geschlossen ist und keine
  User Story mehr offen ist — `/mission` schließt sie nie per `Closes` (`mission/SKILL.md`, Phase 6). Vorher
  die Kinder, deren `Closes` gescheitert ist (412, `mission/references/forge.md`, „Diese
  Gitea-Instanz"), von Hand schließen, Vorgänger zuerst. Dazu
  ein Kommentar an der Mission: die Kinder mit ihren Andock-Commits. Bleibt eine Story offen, bleibt die
  Mission offen, und der Kommentar sagt, welche und warum.
- **Statuslabels** (`mission/SKILL.md`, „Die Statuslabels"): Ein Ticket, dessen Glut-Punkt oder
  Zurücklassen-Grund jetzt erledigt ist, verliert `status/haengt`; ein Ticket, dessen Blocker jetzt
  geschlossen ist, verliert `status/blockiert`. Ein Kind, das nach dem Andocken des Pull Requests
  offen bleibt (etwa weil `Closes` scheiterte und es noch nicht von Hand zu ist),
  verliert `status/in-arbeit`. Ein Punkt, der zum Ticket wird, ändert am alten Ticket nichts.
- **Neu angelegte Issues** — falls die Entscheidung welche verlangt hat — tragen das
  Triage-Label des Projekts (`needs-triage`), **nie** das Freigabe-Label, und im Body: der Fund,
  woher er kommt (Lauf, Ticket, Erster Offizier), was daran noch zu entscheiden ist, und die
  Fundstellen. Ein maschinell vorbereitetes Ticket, das aussieht wie ein triagiertes, ist schlimmer als keins.
- **Die Lauftafel des Außeneinsatzes** (`references/lauftafel.md`; entfällt bei `Lauftafel aus`), bei `plan_artifact: publish`
  (`mission/references/adapter.md`): Diese Sitzung hat ein anderes Scratchpad als der
  ursprüngliche Lauf, ein lokaler `file_path` trägt hier also nicht mehr. Die URL steht im
  Eröffnungskommentar am Zielissue — die Tafel darüber lesen (Artifact-Werkzeug, `action: read`),
  ändern und mit derselben `url` erneut veröffentlichen, damit der Link bleibt. Ein Abschnitt
  „Nacharbeit" mit den Entscheidungen, und jeder abgearbeitete Glut-Punkt wird darin als erledigt
  markiert. Der Lauf ist damit nicht mehr „beendet", sondern „beendet, nachgearbeitet am
  <Datum>".

Prüfe nach, dass die Kommentare angekommen sind (`mission/references/forge.md`, „Nachzählen statt
annehmen").

## Phase 5 — Bericht

- Je Punkt: erledigt / als Ticket angelegt / weiterhin offen, jeweils mit Beleg.
- Die Entscheidungen der Fragerunden in je einem Satz, mit ihrer Begründung.
- Der Teststand vorher/nachher.
- Was ein Mensch noch tun muss, und was beim Andocken in der Produktion passiert.

---

## Abbruchbedingungen — anhalten und fragen

Gefragt wird nach `mission/SKILL.md` („Wie gefragt wird"): was vorliegt, die Wege weiter, deine
Empfehlung.

- Das Arbeitsverzeichnis war zu Beginn nicht sauber.
- Ein Punkt widerspricht einer Entscheidungsdokumentation oder einem Eintrag im Verzeichnis für
  bewusst Verworfenes. Dann ist entweder der Punkt falsch oder die Entscheidung überholt — beides
  entscheidet ein Mensch.
- Ein Punkt verlangt Zugriff, den es hier nicht gibt (Produktivdatenbank, Datei-Share,
  Identitätsanbieter, Deploy-Plattform).
- Ein Punkt würde Produktivdaten umschreiben.
- Ein Nachweis ist nicht fahrbar, und der Punkt hängt daran.
- Der Pull Request des Laufs ist inzwischen angedockt **und** der Missions-Branch gelöscht, während die
  Nacharbeit ihn noch als Arbeitsfläche annimmt.
- Ein Andockkonflikt, der nicht mechanisch ist.

Bei Abbruch: nichts wegwerfen, den Stand berichten — **und zwar auch in der Forge**, an der Mission.
Ein Abbruch, der nur im Chat steht, ist für den nächsten Leser nicht von „nie angefangen" zu
unterscheiden.
