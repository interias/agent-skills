---
name: epic-nacharbeit
description: Die offenen Punkte eines abgeschlossenen /epic-Laufs abarbeiten — Fragerunden im Frontier-Verfahren, je Punkt entscheiden ob er in diese Sitzung passt oder ein Ticket braucht, dann umsetzen und nachdokumentieren. Legt keine Issues ohne ausdrückliche Entscheidung an.
---

# Epic-Nacharbeit

Ein `/epic`-Lauf endet mit einem offenen Pull Request und einem Abschlusskommentar, in dem steht,
**was er offen gelassen hat**: nicht gefahrene Verifikationen, Handgriffe des Betreibers,
Doku-Lücken, und die Funde der Reviewer außerhalb der Tickets. Dieser Ablauf arbeitet diese Liste
ab.

Zielvorgabe ist das Argument des Aufrufs: die Nummer des Epics, ersatzweise die Nummer des
Pull Requests. Ohne Argument nimmst du den letzten `/epic`-Lauf des Repositorys — der jüngste
Epic-Branch mit offenem Pull Request.

Der Projektadapter ist derselbe wie bei `/epic`: **`.claude/epic.md`**. Lies ihn als Erstes; er
nennt Forge, Vokabulardatei, ADR-Pfad, Testbefehle, Commit-Konvention und `base_branch`. Die
Regeln von `/epic` gelten hier weiter, insbesondere: **der Basis-Branch — `base_branch` aus dem
Adapter, nach einem Lauf maßgeblich die `base` des Pull Requests — ist niemals direktes Ziel eines
Commits**, Datenmigration ist Handarbeit, keine Testsuite wird durch Löschen von Tests grün,
Fachsprache aus der Vokabulardatei.

---

## Was diesen Ablauf von `/epic` unterscheidet

`/epic` hat einen fremden Scope: die Abnahmekriterien der Kind-Tickets, und nichts darüber hinaus.
Nacharbeit hat **keinen vorgegebenen Scope** — sie ist genau die Arbeit, die außerhalb lag. Damit
fällt die Sicherung weg, die bei `/epic` der Ticket-Body war, und an ihre Stelle tritt die
Fragerunde: **jeder Punkt wird einzeln entschieden, bevor er angefasst wird.**

Deshalb auch: **hier arbeiten keine Subagenten.** Die Punkte sind einzeln klein, hängen
inhaltlich zusammen und brauchen den Kontext des ganzen Laufs. Ein Implementer, dem man den
halben Zusammenhang in den Auftrag schreiben müsste, kostet mehr als er trägt. Wird ein Punkt so
groß, dass ein Subagent sich lohnt, ist das das Signal, dass er ein Ticket braucht und nicht in
diese Sitzung gehört.

---

## Die Regel, um die es geht

**Keine Issues ohne ausdrückliche Entscheidung.** Nicht „höchstens drei", nicht „nur mit
`needs-triage`" — sondern: du legst kein Issue an, bis in einer Fragerunde entschieden wurde,
dass dieser Punkt eines braucht.

Der Grund ist nicht Vorsicht, sondern Messbarkeit. Ein Fund eines Reviewers ist in dem Moment
noch keine Aufgabe; er ist eine Beobachtung. Ob daraus eine Aufgabe wird, hängt an einer Frage,
die ein Agent nicht beantworten kann: *lohnt der Aufwand?* Ein Ticket anzulegen ist billig und
fühlt sich nach Fortschritt an — und es verlagert Arbeit in eine Zukunft, in der niemand mehr
weiß, warum sie dasteht. Die drei Zeilen Nachtrag, die den Fund erklären, sind oft die ganze
Lösung.

Die Umkehrung gilt genauso: **ein Punkt, der nicht in diese Sitzung passt, wird nicht
hineingequetscht.** Dann ist das Ticket richtig, und du legst es an — nach der Entscheidung.

**Unter `/epic-flotte`** gehen die Fragerunden an den Admiral statt an den Nutzer: Du beendest
deinen Zug mit dem Frageblock aus `epic-flotte/SKILL.md` und setzt mit seiner Antwort fort. Eine
Entscheidung, die er im Rahmen seines Entscheidungsrechts trifft und in der Forge vermerkt, ist
eine ausdrückliche Entscheidung im Sinn dieser Regel; was dort dem Menschen vorbehalten ist, legt
er dem Menschen vor. Die Bestätigung vor dem Handeln (Phase 2, Ende) gibt ebenfalls er.

---

## Phase 0 — Rüsten

- `.claude/epic.md` lesen, Forge-Zugang herstellen und **einmal verifizieren** (ein Lesezugriff).
- `git status` muss sauber sein. Ist das Arbeitsverzeichnis nicht sauber: **abbrechen und
  fragen.** Niemals fremde Änderungen wegwerfen oder mitcommitten.
- Feststellen, wie der Pull Request des Laufs steht. **Der Epic-Branch des Laufs ist die
  Arbeitsfläche, solange sein Pull Request offen ist** — dort gehört die Nacharbeit hin, wenn sie
  denselben Gegenstand betrifft (siehe Phase 3). Er liegt im Worktree `<worktree_root>/epic-<nr>`;
  das Hauptverzeichnis wird nie umgeschaltet (`epic/SKILL.md`, Regel 11).
- **Den Basis-Branch feststellen:** `base_branch` aus dem Adapter ist der Standard, maßgeblich
  aber — sobald der Pull Request existiert — dessen eigene `base`. Ein Epic kann von einem anderen
  Epic abzweigen; dann ist der Hauptzweig des Repositorys nicht die Basis dieses Laufs.
- **Spec-Modus erkennen** (`issue_form: spec`): Nur **ohne** Kind-Tickets liegt alles am
  Spec-Issue selbst, und die Paket-Branches heißen nicht nach Kind-Issues. Hat das Spec-Issue
  Kinder, gilt derselbe Weg wie im Modus `tickets` — die Kinder sind die Pakete. Das Schema aus
  `epic/SKILL.md` (Phase 3): Epic-Branch `epic/<nr>-<slug>`, Paket-Branch `agent/<nr>-<slug>`, im
  Modus `spec` ohne Kinder `agent/<spec>-p<k>-<slug>` (Slug mit ä→ae).
- `git worktree list` prüfen. Reste eines früheren Laufs melden, nicht löschen — dafür ist
  `/epic-aufraeumen` da.
- Vokabulardatei lesen, und das Verzeichnis für bewusst Verworfenes, falls der Adapter eines
  nennt (`out_of_scope_dir`). Dort steht, welche Idee schon einmal geprüft und abgelehnt wurde;
  ein Nacharbeitspunkt, der dort schon liegt, ist erledigt und nicht offen.
- **Teststand messen**, wenn irgendein Punkt Code berührt: Suiten- und Testzahl je Suite,
  gefahren und nicht aus dem `README` abgeschrieben. Ohne diese Zahl kannst du am Ende nicht
  sagen, ob eine Suite dazukam oder verschwand.

## Phase 1 — Die Liste zusammentragen

Aus **drei** Quellen, und keine davon reicht allein:

1. **Der Abschlusskommentar am Epic.** Sein Abschnitt `### Was das Epic offen lässt` ist die
   Hauptquelle (ältere Läufe schreiben noch „Was das PRD offen lässt" — such nach beiden). Lies
   auch die Kommentare an den Kind-Tickets — dort stehen die Punkte, die nur ein einzelnes Ticket
   betreffen, und die im Abschlusskommentar zusammengefasst wurden. Kind ist dabei jedes Issue,
   das der Adapter nicht über `epic_label` als Epic kennzeichnet; eine Kante zwischen zwei Epics
   ist Reihenfolge, kein Kind, und bleibt hier außen vor. **Im Spec-Modus ohne Kinder**
   (`issue_form: spec`) gibt es keine Kind-Tickets — alle Rückmeldungen zu den Paketen stehen als
   Kommentare am Spec-Issue selbst; **mit Kindern** gilt derselbe Weg wie im Modus `tickets`. Ergänze
   hier die Lauftafel (`references/lauftafel.md`): jeder dort verzeichnete Glut-Punkt (wartet auf
   den Menschen) gehört auf diese Liste.
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

Nach dem Frontier-Verfahren, wie im `grilling`-Ablauf.

Baue die Punkte als **Entscheidungsbaum**: jede Entscheidung verzweigt in die Entscheidungen, die
an ihr hängen. Die **Frontier** ist jede Entscheidung, deren Voraussetzungen schon geklärt sind —
die Fragen, die du *jetzt* stellen kannst, ohne eine Antwort zu raten, die du noch nicht gehört
hast. **Frage die ganze Frontier in einer Runde**, jede Frage mit Antwortmöglichkeiten und deiner
Empfehlung, gestellt nach `epic/SKILL.md` („Wie gefragt wird"). Dann warte auf die Antworten.

Nach jeder Runde verschiebt sich die Frontier: geklärte Entscheidungen schalten die frei, die von
ihnen abhingen. Eine Frage, deren Antwort von einer noch offenen Frage derselben Runde abhängt,
gehört in eine **spätere** Runde, nicht in diese.

**Fakten zu beschaffen ist deine Aufgabe, nie die des Nutzers.** Braucht eine Frage einen Fakt aus
der Umgebung — steht die Datei noch da, was sagt der Adapter, ist der Test fahrbar —, sieh selbst
nach, bevor du fragst. Eine Frage, die auf einem ungeprüften Fakt steht, kostet eine ganze Runde.
Die **Entscheidungen** sind die des Nutzers; die legst du vor und wartest.

### Die eine Frage, die jeder Punkt beantworten muss

Neben dem inhaltlichen „was soll dastehen" trägt jede Runde eine zweite Frage, und die ist der
Zweck dieses Ablaufs:

> **Passt dieser Punkt in diese Sitzung — umsetzen und nachdokumentieren —, oder braucht er ein
> eigenes Ticket?**

Beantworte sie nicht nach Gefühl, sondern nach Volumen. Nenne in der Frage, was du geschätzt hast:
welche Dateien, wie viele Zeilen, ob Code oder nur Text, ob ein Test dazukommt, ob eine Suite
betroffen ist. Ein Punkt gehört in ein Ticket, wenn eins davon zutrifft:

- Er ändert **Verhalten**, das heute von einem Test abgedeckt ist, oder er braucht einen neuen
  Test, um überhaupt prüfbar zu sein.
- Er berührt eine **Entscheidungsdokumentation**, die dann neu zu treffen wäre — nicht
  fortzuschreiben, sondern zu ändern.
- Er hat **einen Verifikationsweg, der hier nicht fahrbar ist** (fehlender Host, fehlender
  Compose-Stack, fehlender Zugang).
- Er wäre ohne die **Abnahmekriterien** eines Tickets nicht abnehmbar — du könntest also am Ende
  nicht belegen, dass er fertig ist.

Trifft nichts davon zu, gehört er in diese Sitzung. Der häufigste Fall ist der Fund, für den ein
datierter Nachtrag und ein Querverweis die ganze Lösung sind: er hält die Erkenntnis fest, kostet
eine Viertelstunde und erzeugt keine Arbeit, die später niemand mehr begründen kann.

Die Sitzung ist fertig befragt, wenn die Frontier leer ist. **Handle nicht, bevor der Nutzer
bestätigt hat, dass ihr dasselbe Verständnis habt.**

## Phase 3 — Umsetzen

Auf dem **Epic-Branch des Laufs**, solange sein Pull Request offen ist und die Nacharbeit denselben
Gegenstand betrifft. Das ist der Normalfall, und er ist der bequemere: der Pull Request wird
ohnehin von einem Menschen gelesen, und die Nacharbeit gehört in dieselbe Lesung.

Zwei Dinge dabei, und beide sind leicht zu vergessen:

- **Ein eigener Commit, erkennbar als Nacharbeit.** Er gehört zu keinem Kind-Ticket. Nenne im
  Betreff das Epic und nicht eine Ticketnummer, sonst schließt eine `Closes`-Zeile später ein
  Ticket mit, das damit nichts zu tun hatte.
- **Der Pull-Request-Body bekommt einen eigenen Abschnitt „Nacharbeit".** Die `Closes`-Zeilen
  bleiben unangetastet bei ihren Tickets. Wer den Pull Request liest, muss sehen können, was von
  den Kindern kam und was danach dazukam — sonst prüft er die Nacharbeit gegen Abnahmekriterien,
  die sie nie hatte.

Ist der Pull Request schon gemergt, oder betrifft die Nacharbeit einen anderen Gegenstand: eigener
Branch, eigener Pull Request, Namensschema `nacharbeit/<epic-nr>-<slug>`, als Ziel derselbe
Basis-Branch wie beim ursprünglichen Lauf (`base_branch` aus dem Adapter, bei bereits gemergtem
Pull Request dessen `base`). **Nie direkt auf den Basis-Branch committen**, auch nicht für einen
Einzeiler in einer Textdatei — der Merge dorthin kann deployen.

Nach jeder Änderung, die Code berührt: **den Testbefehl des Projekts fahren** und gegen den in
Phase 0 gemessenen Stand vergleichen. Auch dann, wenn du nur einen Kommentar geändert hast; eine
Kommentarzeile im falschen Block ist ein Syntaxfehler wie jeder andere.

## Phase 4 — Nachdokumentieren

Der Teil, der am leichtesten ausfällt, weil sich der Punkt nach dem Commit erledigt anfühlt.

- **Kommentar am Epic.** Je abgearbeiteter Punkt eine Zeile: was war offen, was wurde
  entschieden, **mit welcher Begründung**, wo steht das Ergebnis. Dazu: was weiterhin offen ist
  und warum. Dieser Kommentar ist die Fortsetzung des Abschlusskommentars und der Ort, an dem in
  einem halben Jahr steht, warum ein Fund nicht zum Ticket wurde.
- **Kommentar am betroffenen Kind-Ticket**, wenn ein Punkt aus dessen Review kam.
- **Das Epic schließen**, wenn der Pull Request gemergt ist, jedes Kind geschlossen ist und keine
  User Story mehr offen ist — `/epic` schließt es nie per `Closes` (`epic/SKILL.md`, Phase 6). Vorher
  die Kinder, deren `Closes` an HTTP 412 gescheitert ist, von Hand schließen, Vorgänger zuerst. Dazu
  ein Kommentar am Epic: die Kinder mit ihren Merge-Commits. Bleibt eine Story offen, bleibt das
  Epic offen, und der Kommentar sagt, welche und warum.
- **Statuslabels** (`epic/SKILL.md`, „Die Statuslabels"): Ein Ticket, dessen Glut-Punkt oder
  Zurücklassen-Grund jetzt erledigt ist, verliert `status/haengt`; ein Ticket, dessen Blocker jetzt
  geschlossen ist, verliert `status/blockiert`. Ein Kind, das nach dem Merge des Pull Requests
  offen bleibt (etwa weil `Closes` an HTTP 412 scheiterte und es noch nicht von Hand zu ist),
  verliert `status/in-arbeit`. Ein Punkt, der zum Ticket wird, ändert am alten Ticket nichts.
- **Neu angelegte Issues** — falls die Fragerunde welche verlangt hat — tragen das
  Triage-Label des Projekts, **nie** das Freigabe-Label, und im Body: der Fund, woher er kommt
  (Lauf, Ticket, Reviewer), was daran noch zu entscheiden ist, und die Fundstellen. Ein maschinell
  vorbereitetes Ticket, das aussieht wie ein triagiertes, ist schlimmer als keins.
- **Die Lauftafel des `/epic`-Laufs** (`references/lauftafel.md`), bei `plan_artifact: publish`
  (ein alter Wert `off` gilt als `file`): Diese Sitzung hat ein anderes Scratchpad als der
  ursprüngliche Lauf, ein lokaler `file_path` trägt hier also nicht mehr. Die URL steht im
  Eröffnungskommentar am Zielissue — die Tafel darüber lesen (Artifact-Werkzeug, `action: read`),
  ändern und mit derselben `url` erneut veröffentlichen, damit der Link bleibt. Ein Abschnitt
  „Nacharbeit" mit den Entscheidungen, und jeder abgearbeitete Glut-Punkt wird darin als erledigt
  markiert. Der Lauf ist damit nicht mehr „beendet", sondern „beendet, nachgearbeitet am
  <Datum>".

Prüfe nach, dass die Kommentare angekommen sind — ein `POST` kann fehlgeschlagen sein.

## Phase 5 — Bericht

- Je Punkt: erledigt / als Ticket angelegt / weiterhin offen, jeweils mit Beleg.
- Die Entscheidungen der Fragerunden in je einem Satz, mit ihrer Begründung.
- Der Teststand vorher/nachher.
- Was ein Mensch noch tun muss, und was beim Merge in der Produktion passiert.

---

## Abbruchbedingungen — anhalten und fragen

Gefragt wird nach `epic/SKILL.md` („Wie gefragt wird"): was vorliegt, die Wege weiter, deine
Empfehlung.

- Das Arbeitsverzeichnis war zu Beginn nicht sauber.
- Ein Punkt widerspricht einer Entscheidungsdokumentation oder einem Eintrag im Verzeichnis für
  bewusst Verworfenes. Dann ist entweder der Punkt falsch oder die Entscheidung überholt — beides
  entscheidet ein Mensch.
- Ein Punkt verlangt Zugriff, den es hier nicht gibt (Produktivdatenbank, Datei-Share,
  Identitätsanbieter, Deploy-Plattform).
- Ein Punkt würde Produktivdaten umschreiben.
- Ein Nachweis ist nicht fahrbar, und der Punkt hängt daran.
- Der Pull Request des Laufs ist inzwischen gemergt **und** der Epic-Branch gelöscht, während die
  Nacharbeit ihn noch als Arbeitsfläche annimmt.
- Ein Merge-Konflikt, der nicht mechanisch ist.

Bei Abbruch: nichts wegwerfen, den Stand berichten — **und zwar auch in der Forge**, am Epic.
Ein Abbruch, der nur im Chat steht, ist für den nächsten Leser nicht von „nie angefangen" zu
unterscheiden.
