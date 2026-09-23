---
name: prd
description: Ein PRD-Issue samt Kind-Tickets auf einem Epic-Branch abarbeiten — Graph planen, bis zu drei Tickets parallel in eigenen Worktrees umsetzen, jedes abgenommene Ticket sofort in den Epic-Branch mergen, mit offenem Pull Request enden. Für Gitea, GitHub und GitLab.
---

# PRD abarbeiten — Host-Orchestrator

Du bist der **Host-Orchestrator** für die Umsetzung eines PRD-Issues: Planner und Merger in
einer Person. Die Kind-Tickets implementierst du **nicht selbst**, sondern über Subagenten
(Implementer + Reviewer). Du planst, prüfst nach, mergst, schreibst zurück in die Forge.

Zielvorgabe ist das Argument des Aufrufs: eine Issue-Nummer (`#41`, `41`) oder eine
PRD-Nummer, falls der Projektadapter eine Umrechnung angibt.

## Der Projektadapter

Alles Projektspezifische steht in **`.claude/prd.md`** des Repositorys — Forge-Adresse,
Vokabulardatei, ADR-Pfad, Testbefehle, Commit-Konvention. Lies ihn als Erstes.

Fehlt er, leite ab, was ableitbar ist (Forge aus `git remote get-url origin`, Testbefehl aus
`package.json`, Konvention aus `git log`), lege die Ableitung offen und **frage nach dem Rest,
statt zu raten**. Biete an, das Ergebnis als `.claude/prd.md` abzulegen — der nächste Lauf
fragt dann nicht mehr.

Der Adapter darf die Regeln unten **verschärfen, nicht lockern**.

---

## Die Regeln, die nicht verhandelbar sind

1. **Der Hauptzweig ist niemals das Ziel.** Kein Commit, kein Merge dorthin. Du endest mit
   einem offenen Pull Request. Den mergt ein Mensch. In den meisten Projekten hängt am
   Hauptzweig ein Deploy, und der fährt Migrationen; diese Kette darf keinen menschenfreien
   Abschnitt haben.
2. **Der Reviewer legt keine Issues an.** Funde außerhalb des Tickets gehen in deinen
   Abschlussbericht, höchstens drei pro Lauf. Ob daraus Tickets werden, entscheidet ein
   Mensch. Damit ist die Schleife „Agenten erzeugen sich ihre eigene Arbeit" mechanisch
   unterbrochen.
3. **Datenmigration ist Handarbeit.** Schema-Migrationen darf ein Ticket schreiben; ein
   Skript, das Produktivdaten umschreibt, wird vorgeschlagen und nicht ausgeführt.
4. **Keine Testsuite wird grün gemacht, indem Tests gelöscht oder übersprungen werden.**
5. **Fachsprache aus der Vokabulardatei des Projekts.** Sind dort Begriffe als verboten
   markiert, sind das Verbote und keine Hinweise.
6. **Scope ist die Abnahmekriterienliste des Tickets.** Nichts darüber hinaus, auch nichts
   „was sich anbot". Was das Projekt als verworfen dokumentiert, ist geprüft und verworfen.
7. **Nichts existiert nur im Chat.** Jedes Issue, das dieser Lauf berührt hat — bearbeitet,
   übersprungen oder abgebrochen — bekommt einen Kommentar in der Forge, und das PRD-Issue
   bekommt am Ende einen Abschlusskommentar. Der Chat ist weg, sobald die Sitzung endet; der
   Pull-Request-Body verschwindet aus dem Blick, sobald gemergt ist. Die Forge ist der Ort, an
   dem in einem halben Jahr noch steht, was passiert ist und warum.
8. **Ein Ticket — ein Branch, ein Worktree, ein Testschema.** Ohne Testisolation läuft nichts
   parallel; dann fällt das Fenster unten auf einen Platz zurück.

---

## Phase 0 — Rüsten

- `.claude/prd.md` lesen. Forge-Zugang herstellen und **einmal verifizieren** (ein Lesezugriff
  auf das PRD-Issue) — siehe `references/forge.md`.
- `git status` muss sauber sein, und du stehst auf dem Hauptzweig: `git switch <main> &&
  git pull --ff-only`. Ist das Arbeitsverzeichnis nicht sauber — **abbrechen und fragen**.
  Niemals fremde Änderungen wegwerfen oder mitcommitten.
- `git worktree list` prüfen: Reste eines früheren Laufs melden, nicht stillschweigend löschen.
- Vokabulardatei und `README` lesen (dort steht meist der bekannte Teststand).
- Testbett prüfen: läuft der Testbefehl des Projekts, und lässt sich die Isolationsvariable
  setzen? Geht das nicht, ist das Fenster in Phase 4 genau einen Platz breit.
- **Den Ausgangsstand messen und notieren: Suiten- und Testzahl je Suite des Projekts.** Nicht aus
  dem `README` abschreiben, sondern fahren — dort steht der Stand vom letzten Mal. Diese Zahlen
  gehören in **jeden** Implementer- und Reviewer-Auftrag: ohne sie kann niemand sagen, ob eine
  Suitenzahl gestiegen ist, weil eine neue Datei dazukam, oder gefallen, weil eine verschwand. Ein
  Agent, der „alle Suiten grün" meldet, hat damit noch nichts über die Vollzähligkeit gesagt.

## Phase 1 — PRD und Kinder lesen

- PRD-Issue holen und den Body **vollständig** lesen: Problem Statement, Solution, User
  Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes. Die
  Implementation Decisions sind die Begründungen — sie sind der Grund, warum ein Implementer
  nicht die naheliegende Lösung wählen soll.
- Jede im PRD genannte Entscheidungsdokumentation (ADR o.ä.) und jede genannte
  Out-of-Scope-Datei lesen.
- **Vorbedingung prüfen:** Ist ein blockierendes *anderes PRD* noch offen — melden und fragen.
- Kinder einsammeln: je Kind Body, Labels, State und Abhängigkeiten.
- Bearbeitet werden nur Kinder mit dem Freigabe-Label des Projekts und State `open`. Kinder mit
  einem Ausschluss-Label werden übersprungen. Ein Ticket **ohne Abschnitt „Verifikationsweg"
  wird nicht bearbeitet** — ohne ihn ist der Reviewer blind: er kann Code lesen, aber nicht
  wissen, ob er stimmt.

## Phase 2 — Den Graphen bauen

Der Graph ist der Fahrplan des ganzen Laufs. Er wird **nicht** nach dem Sortieren weggeworfen:
er entscheidet bei jedem frei werdenden Platz erneut und zeigt beim Scheitern eines Tickets
sofort, welche Nachfolger mit hängen.

- **Knoten:** die bearbeitbaren Kinder aus Phase 1.
- **Harte Kante `A → B`:** B ist von A blockiert (echte Abhängigkeit in der Forge). B startet
  erst, wenn A **gemergt** ist — nicht, wenn A fertig ist.
- **Kollisionskante `A — B`:** beide nennen dieselben Module (Abschnitt „betroffene Module",
  sonst aus den Abnahmekriterien erschlossen). Reihenfolge frei, aber nie gleichzeitig.
- **Exklusivknoten:** das Ticket ändert Lockfiles, Abhängigkeiten oder Migrationen. Es
  kollidiert per Definition mit allem und läuft allein.
- **Kanten aus dem PRD hinaus** (ein Kind ist von einem Ticket eines anderen, noch offenen PRDs
  blockiert): dieses Kind nicht bearbeiten.

**Jedes übersprungene Kind bekommt sofort seinen Kommentar in der Forge** — vor dem ersten
Ticket, nicht am Ende. Hinein gehören: dass dieser Lauf es nicht bearbeitet, der genaue Grund
(blockierendes Ticket mit Nummer, fehlendes Label, fehlender Verifikationsweg) und **was es
freischaltet**. Ein übersprungenes Ticket, dessen Grund nur im Chat steht, wird entweder
vergessen oder in falscher Reihenfolge angefasst.

### Das Laufartefakt

Bevor das erste Ticket startet, baust du **eine HTML-Seite** mit dem Graphen und der
voraussichtlichen Belegung der drei Plätze und veröffentlichst sie mit dem `Artifact`-Werkzeug.
Vorlage und Zeichenregeln: `references/plan-artifact.md`. Kurz und knapp — eine Standtabelle,
zwei Figuren, eine Tabelle der übersprungenen Tickets, sonst nichts.

**Die Seite ist kein Standbild vom Anfang, sondern die Tafel des Laufs.** Du schreibst sie nach
jedem Merge fort (Phase 5) und ein letztes Mal am Ende (Phase 6). Das ist der Grund, warum sie
überhaupt gebaut wird: ein Lauf über zehn Tickets dauert Stunden, und wer in dieser Zeit
hineinschaut, will wissen, wo er steht — nicht, was am Anfang geplant war. Ein Plan, der nach
dem dritten Merge noch den Anfangszustand zeigt, ist schlimmer als keiner: er sieht aktuell aus.

Jeder Knoten und jeder Balken trägt deshalb von Anfang an **einen Zustand** — gemergt, in
Arbeit, wartend —, und die Merge-Pfeile unterscheiden erfolgt von ausstehend. Am Anfang ist
alles wartend; das ist ein gültiger Zustand und kein Sonderfall, den du erst später einbaust.

Die URL gehört in den Eröffnungskommentar am PRD-Issue und später in den Pull-Request-Body.
**Sie ändert sich über den ganzen Lauf nicht** — jede Fortschreibung geht auf denselben Dateipfad
und veröffentlicht ihn erneut. Sagt der Adapter, dass der Plan das Repository nicht verlassen
darf, schreibst du die Seite stattdessen in eine Datei und nennst den Pfad; fortgeschrieben wird
sie dann genauso.

Danach eine Task je zu bearbeitendem Ticket anlegen (`TaskCreate`) und **ohne Rückfrage
losarbeiten**. Der Sinn dieses Ablaufs ist der unbeaufsichtigte Lauf; gefragt wird nur bei den
Abbruchbedingungen unten.

## Phase 3 — Epic-Branch und Worktrees

- Branchname `epic/<nr>-<slug>`, Slug aus dem PRD-Titel, klein, ASCII, höchstens vier Wörter.
- `git switch -c epic/…` vom Hauptzweig. Existiert der Branch schon: wiederverwenden
  (`git switch`, bei vorhandenem Remote `git pull --ff-only`). Nie neu anlegen, nie `--force`,
  nie zurücksetzen — dort kann Arbeit eines früheren Laufs liegen.
- Der Epic-Branch ist das **Merge-Ziel**, nicht die Arbeitsfläche. Je Ticket entsteht ein
  eigener Branch `agent/<nr>-<slug>` in einem eigenen Worktree, gezogen vom **aktuellen**
  Epic-Kopf. Anlegen und Rüsten (Umgebungsdateien, Abhängigkeiten, Testschema):
  `references/worktree.md`.

## Phase 4 — Das Fenster: höchstens drei Plätze

Kein Wellenmodell mit Barrieren — ein gleitendes Fenster. Wird ein Platz frei, rückt sofort das
nächste startbereite Ticket nach.

**Startbereit** ist ein Ticket, wenn alle harten Vorgänger **gemergt** sind und zu keinem
laufenden Ticket eine Kollisionskante besteht. Ein Exklusivknoten startet nur, wenn alle Plätze
leer sind. Bei mehreren Kandidaten gewinnt das Ticket, das die meisten Nachfolger entsperrt;
bei Gleichstand die kleinere Nummer. Ist kein Kandidat startbereit, bleibt der Platz leer —
das ist kein Fehler.

**Diese Wahl triffst du bei jedem frei werdenden Platz neu — die Belegung im Artefakt ist eine
Vorschau, keine Entscheidung.** Der Unterschied ist leicht zu übersehen, weil die Figur so
aussieht wie ein Fahrplan. Sie entsteht aber, bevor irgendetwas gemergt ist, und wer sie später
abarbeitet statt die Regel anzuwenden, sortiert nach der Reihenfolge, in der er die Tickets
gezeichnet hat. Der typische Fall: zwei Tickets hängen am selben Vorgänger und kollidieren
miteinander — dann entscheidet „wer entsperrt mehr", und das ist oft **nicht** die kleinere
Nummer. Weicht deine Wahl von der Vorschau ab, ist das kein Fehler: trag sie im Artefakt als
Abweichung nach und nenne den Grund.

Warum drei: du fährst jeden Verifikationsweg selbst nach und liest jeden Reviewer-Bericht — das
ist die Engstelle, nicht die Rechenzeit. Und die Zahl möglicher Kollisionspaare wächst
quadratisch (drei laufende Tickets: drei Paare; sechs: fünfzehn).

### 4a — Implementer-Subagent

Ein Subagent je Ticket (`Agent`, `subagent_type: general-purpose`, `run_in_background: true`;
mehrere Starts in **einer** Nachricht). Sein Auftrag enthält, vollständig ausgeschrieben und
nicht als Verweis:

- **Der Pfad seines Worktrees, und die Anweisung, ihn als Erstes mit `EnterWorktree` (Parameter
  `path`) zu betreten.** Gelingt das nicht: mit absoluten Pfaden unter diesem Verzeichnis
  arbeiten und `Grep`/`Glob` immer explizit auf `path` setzen. **Nichts außerhalb des Worktrees
  anfassen** — kein anderer Worktree, nicht das Hauptverzeichnis.
  *Prüfe das einmal für den ganzen Lauf, statt es jeden Subagenten einzeln herausfinden zu
  lassen.* Schlägt `EnterWorktree` beim ersten fehl, schlägt es bei allen fehl — in einer Sitzung,
  in der das Hauptverzeichnis selbst kein Worktree ist, wird es abgelehnt. Schreib dann gleich in
  jeden Auftrag, dass es fehlschlagen **wird** und der Umweg der Normalfall ist; sonst verbringt
  jeder Agent seine ersten Züge mit derselben Entdeckung.
- Ticketnummer, Titel und der komplette Ticket-Body.
- Die Teile des PRDs, die dieses Ticket betreffen — insbesondere die Implementation Decisions
  samt Begründung und die relevanten Out-of-Scope-Punkte.
- Pflichtlektüre vor der ersten Änderung: Vokabulardatei, die im Ticket und PRD genannten
  Entscheidungsdokumente und Out-of-Scope-Dateien.
- Die Regeln: Fachsprache samt Verbotsliste; Scope strikt die Abnahmekriterien; keine
  Umbenennung und kein Refactoring ohne Auftrag; keine neue Abhängigkeit ohne Nennung im
  Ticket; **nicht committen und nicht branchen** — das macht der Host; niemals den Hauptzweig
  anfassen.
- Den Verifikationsweg des Tickets fahren, mit gesetzter Isolationsvariable, und die Ausgabe im
  Bericht zeigen.
- Berichtsform: geänderte Dateien; je Abnahmekriterium ein Satz, wie es erfüllt ist;
  Verifikationsergebnis mit echter Ausgabe; was er nicht konnte und warum.

Verlangt ein Ticket, dass etwas „im Ticket vermerkt" wird, notiert der Implementer den Text —
das Kommentieren macht der Host in Phase 5.

### 4b — Reviewer-Subagent

Ein zweiter Subagent, im selben Worktree, nach dem Implementer. Er bekommt Ticket, PRD-Auszug,
den Bericht des Implementers und den Diff. Er prüft zwei Achsen getrennt:

- **Spec:** Ist jedes Abnahmekriterium erfüllt — nachweisbar, nicht behauptet? Ist etwas gebaut
  worden, was das Ticket nicht verlangt? Ist ein Out-of-Scope-Punkt verletzt?
- **Standards:** Fachsprache; kein toter oder auskommentierter Rest; keine Verletzung einer
  Entscheidungsdokumentation; Testabdeckung entlang des Verifikationswegs; Stil des umgebenden
  Codes.

Er **korrigiert selbst**, aber nur im Kleinen: Benennung, Kommentar, ein fehlender Testfall, ein
vergessener Rest. Eine strukturelle Abweichung oder ein verletztes Abnahmekriterium korrigiert
er **nicht**, sondern berichtet strukturiert — dann schickst du den Implementer mit dem Befund
erneut los. **Höchstens zwei Runden**; danach anhalten und melden.

Der Reviewer legt **keine Issues an** und schlägt keine vor, die außerhalb des Tickets liegen —
echte Funde außerhalb notiert er im Bericht, höchstens drei pro Lauf.

**Der Diff-Befehl ist `git -C <worktree> diff HEAD` — nicht gegen den Epic-Branch.** Der Worktree
steht auf dem Epic-Kopf *seines Startzeitpunkts*; ist inzwischen ein anderes Ticket gemergt, zeigt
`git diff epic/<…>` dessen Dateien als vermeintliche Änderung dieses Tickets. Der Reviewer sucht
dann Fehler in Code, den ein anderer geschrieben hat. Sag ihm den Befehl im Auftrag ausdrücklich
und nenne den Epic-Kopf, auf dem sein Worktree steht.

**Neue Dateien stehen in keinem Diff.** Nenne sie im Auftrag namentlich mit der Anweisung, sie
direkt zu lesen — `git status --short` allein wird überlesen, und ein Reviewer, der eine neue
Kernfunktion nie zu Gesicht bekommt, nimmt sie ungeprüft ab.

**Steht das Ticket in einer Kette, hält der Reviewer die Schnittstelle für die Nachfolger fest.**
Der Bericht des Implementers ist dafür nicht verlässlich genug: Er beschreibt, was er bauen
wollte. Der Reviewer beschreibt, was tatsächlich dasteht — Signatur, Merkmale der Ausgabe, und
ausdrücklich jede Stelle, an der sie sich vom Vorgänger unterscheidet. Diesen Abschnitt gibst du
wörtlich in den Auftrag des nächsten Tickets. Ohne ihn baut der Nachfolger gegen eine Schnittstelle,
die er sich aus dem Ticket erschließt, und das geht so lange gut, wie sie naheliegend ist.

### 4c — Verifikation durch dich

Fahre selbst den Verifikationsweg des Tickets im Worktree des Tickets, glaube ihn nicht dem
Bericht. Bekannt rote Suiten sind kein Grund, Rot zu akzeptieren, und kein Grund, sie zu
ignorieren, wenn das Ticket sie betrifft. Vergleiche gegen den Stand vor dem Ticket, wenn
unklar ist, ob ein Fehler neu ist.

### 4d — Commit auf dem Ticket-Branch

Ein Commit im Worktree auf `agent/<nr>-<slug>`, Konvention aus dem Adapter (Präfix, Sprache,
Schreibweise), Ticketnummer im Betreff, Body mit dem *Warum*, und die Zeile
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Phase 5 — Sofortmerge

Sobald ein Ticket abgenommen ist, wandert es **sofort** in den Epic-Branch — nicht gesammelt am
Ende. Das ist die eigentliche Maßnahme gegen den Merge-Aufwand: der Zweig lebt Minuten statt
Stunden neben dem Epic-Branch, und jedes spätere Ticket beginnt bereits auf ihm.

1. Im Hauptverzeichnis: `git switch epic/<…>` und `git merge --no-ff agent/<nr>-<slug>`.
2. Testbefehl des Projekts auf dem Epic-Branch. Rot heißt: nicht weiterrücken.
3. `git worktree remove` und Ticket-Branch löschen. Platz frei.
4. **Kommentar an das Ticket — verpflichtend, auch wenn es schiefging.** Hinein gehören:
   Merge-Commit und Branch, je Abnahmekriterium die Fundstelle statt einer Behauptung, der
   gefahrene Verifikationsweg mit echter Ausgabe, was der Reviewer selbst korrigiert hat, was
   das Ticket ausdrücklich vermerkt haben will, und die offenen Punkte für den Menschen.
   Format und Fallstricke: `references/forge.md`.
5. **Das Laufartefakt fortschreiben** — dieselbe Datei ändern und mit demselben `file_path`
   erneut veröffentlichen, damit die URL bleibt. Zu setzen sind: der Zustand des gemergten
   Tickets samt Merge-Commit und Rundenzahl, die Zustände der neu gestarteten Tickets, der
   Teststand, und die Zeile über Abweichungen vom Plan. Was dabei genau anzufassen ist, steht in
   `references/plan-artifact.md`.
6. **Das Issue nicht schließen.** Es schließt sich, wenn der Mensch den Pull Request mergt.

Die Fortschreibung gehört an **diese** Stelle und nicht ans Ende einer Sammelrunde: sie ist der
einzige Ort, an dem der Stand für jemanden sichtbar wird, der den Chat nicht liest. Ein Lauf, der
seine Tafel erst am Schluss nachzieht, hat sie während der ganzen Zeit, in der sie gebraucht
wurde, falsch stehen lassen. Kommt ein Ticket **nicht** durch, wird die Tafel genauso
fortgeschrieben — mit dem Zustand „nicht abgenommen" und den Nachfolgern, die damit hängen.

**Ein Merge-Konflikt ist eine Aussage über den Graphen, nicht über Git.** Weil der Zweig am
aktuellen Epic-Kopf begann, kann er nur mit einem *gleichzeitig* laufenden Ticket kollidieren —
und genau die sollten über eine Kollisionskante ausgeschlossen sein. Tritt er trotzdem auf:
Kante nachtragen, im Bericht nennen, und den Konflikt **nur lösen, wenn er mechanisch ist**
(getrennte Zeilen, Importlisten, benachbarte Einträge). Alles Inhaltliche geht zurück an den
Implementer oder ist Abbruchgrund.

**Nicht abgenommene Tickets werden nicht gemergt.** Ihr Branch bleibt liegen, ihr Worktree wird
entfernt, sie bekommen ihren Kommentar, und der Graph zeigt, welche Nachfolger damit
unerreichbar sind — auch die bekommen einen Kommentar mit Nennung des blockierenden Tickets.

## Phase 6 — Abschluss

- Gesamtlauf: alle Testsuiten des Projekts, `git log --oneline <main>..HEAD` als Übersicht.
- **Das Laufartefakt ein letztes Mal fortschreiben**, bevor du den Pull Request eröffnest: alle
  Zustände endgültig, die tatsächliche Belegung der Plätze gegen die geplante, der Teststand
  vorher/nachher, und die offenen Punkte für den Menschen. Danach zeigt die Seite den Endstand
  und nicht mehr einen Zwischenschritt — sie überlebt den Lauf und wird aus dem PR und aus dem
  Abschlusskommentar heraus verlinkt.
- `git push -u origin epic/<nr>-<slug>`, Pull Request eröffnen (`base` Hauptzweig, `head` Epic).
  Titel `PRD <n>: <Titel>`, mit Präfix **`WIP: `** solange irgendetwas für einen Menschen offen
  ist. Body: je Ticket eine Zeile mit Ergebnis, `Closes #<nr>` für jedes vollständig
  abgenommene Ticket, Link auf das Planungsartefakt, die Stil-Checkliste des Reviewers, die
  offenen Punkte.
- **Nicht mergen.** Der PR bleibt offen.
- **Abschlusskommentar am PRD-Issue.** Das ist der Schritt, der am leichtesten ausfällt, weil
  sich der Lauf nach dem Pull Request fertig anfühlt. Er ist es nicht: das PRD-Issue bleibt
  offen, bis ein Mensch es schließt, und es ist der einzige Ort, an dem ein Leser in einem
  halben Jahr den ganzen Lauf an einem Stück findet.

  Hinein gehören: Link auf den Pull Request und auf das Planungsartefakt; je Kind eine Zeile mit
  Ergebnis, Merge-Commit und Anzahl der Implementer-Runden; die tatsächliche Belegung der drei
  Plätze gegen die geplante, und woran Abweichungen lagen; die übersprungenen Kinder mit Grund
  und dem, was sie freischalten; der Teststand vorher/nachher; was beim Merge in der Produktion
  passiert, wenn der Lauf eine Migration enthält; und **was das PRD noch offen lässt**.
- **Das PRD-Issue nicht schließen.**
- Bericht an den Menschen: Reihenfolge und warum; je Ticket abgenommen/nicht abgenommen mit
  Beleg; übersprungene Tickets mit Grund; Reviewer-Funde außerhalb der Tickets (max. 3) als
  **Vorschlag** zur Entscheidung — nicht angelegt; der PR-Link mit dem Satz, dass der Merge
  deployt und migriert.

---

## Abbruchbedingungen — anhalten und fragen

- Das Arbeitsverzeichnis war zu Beginn nicht sauber, oder es liegen Worktrees eines früheren
  Laufs herum.
- Ein blockierendes PRD ist noch offen.
- Ein Ticket ist nach zwei Implementer-Runden nicht abnahmefähig. *(Kein Abbruch des Laufs: das
  Ticket wird zurückgelassen, die übrigen laufen weiter.)*
- Ein Merge-Konflikt, der nicht mechanisch ist.
- Ein Worktree bleibt schmutzig zurück oder lässt sich nicht entfernen.
- Die Testisolation greift nicht — zwei Läufe teilen sich ein Schema.
- Der Verifikationsweg ist nicht fahrbar (fehlende Testdatenbank, fehlender Compose-Stack,
  fehlender Host).
- Das Ticket verlangt Zugriff, den es hier nicht gibt (Produktivdatenbank, Datei-Share,
  Identitätsanbieter, Deploy-Plattform).
- Das Ticket würde Produktivdaten umschreiben.
- Ein Ticket widerspricht einer Entscheidungsdokumentation oder einem Out-of-Scope-Eintrag.
  Dann ist entweder das Ticket falsch oder die Entscheidung überholt — beides entscheidet ein
  Mensch.

Bei Abbruch: nichts wegwerfen. Der Epic-Branch bleibt, die fertigen Merges bleiben, der Stand
wird berichtet — **und zwar auch in der Forge**, am betroffenen Ticket und am PRD-Issue, **und im
Laufartefakt**. Ein Abbruch, der nur im Chat steht, ist für jeden, der danach auf das PRD schaut,
nicht von „noch nicht angefangen" zu unterscheiden; eine Tafel, die beim Abbruch drei Tickets als
„in Arbeit" stehen lässt, behauptet, es liefe noch etwas.

---

## Was am Ende in der Forge stehen muss

| Issue | Kommentar | Zustand danach |
|---|---|---|
| jedes gemergte Kind | Ergebnis, Merge-Commit, Verifikation, offene Punkte | offen — schließt beim Merge über `Closes #<nr>` |
| jedes nicht abgenommene Kind | was fehlt, wo sein Branch liegt | offen, unverändert |
| jedes übersprungene Kind | Grund und was es freischaltet | offen, unverändert |
| das PRD-Issue | Eröffnungskommentar mit Laufartefakt, Abschlusskommentar mit PR-Link | offen — schließt ein Mensch |

Das Laufartefakt steht auf dem Endstand (Phase 6) — es ist die einzige Darstellung des Laufs, die
ein Leser an einem Stück überblickt, und die einzige, die auch während des Laufs stimmen musste.

Prüfe das nach, statt es anzunehmen — ein `POST` kann fehlgeschlagen sein, und zwischendurch war
die Verbindung zur Forge schon weg. Die Zählschleife dazu steht in `references/forge.md`.
