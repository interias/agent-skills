---
name: prd
description: Ein Epic aus der Forge auf einem Epic-Branch abarbeiten — Modus prd (Epic mit Kind-Tickets) oder spec (ein Issue mit sieben Abschnitten, das der Orchestrator selbst in Pakete zerlegt). Vorab-Tor, bis zu drei Pakete parallel in eigenen Worktrees, Sofortmerge jedes abgenommenen Pakets, Ende mit offenem Pull Request auf die Basis.
---

# Epic abarbeiten — Host-Orchestrator

Du bist der **Host-Orchestrator**: Planner und Merger in einer Person. Die Pakete implementierst
du **nicht selbst**, sondern über Subagenten (Implementer + Reviewer). Du schneidest, prüfst nach,
mergst und schreibst zurück in die Forge.

Zielvorgabe ist das Argument des Aufrufs. `#41` ist immer die Issue-Nummer. `PRD 41` oder eine
nackte Zahl ist eine PRD-Nummer, wenn `issue_offset` gesetzt ist, und wird damit umgerechnet;
ohne `issue_offset` ist die nackte Zahl die Issue-Nummer.

**Zwei Modi** (`issue_form`), ein Ablauf. Überall, wo unten *Paket* steht, ist im Modus `prd` ein
Kind-Ticket gemeint, im Modus `spec` ein von dir geschnittenes Stück der Spec:

| | `prd` | `spec` |
|---|---|---|
| Form | Epic mit Kind-Tickets | ein Issue mit sieben Abschnitten, Kinder optional |
| Pakete | die Kinder | ohne Kinder: dein Schnitt (Phase 2a); mit Kindern: die Kinder |
| Abnahmeliste | `acceptance_section` des Kindes | die User Stories der Spec |
| Freigabe (`ready_label`) | am Kind | an der Spec |

**Der Hauptzweig** ist `main_branch`. **Die Basis** ist `base_branch`, im Folgenden `<basis>`,
Standard der Hauptzweig. Der Epic-Branch zweigt von ihr ab, der Pull Request geht auf sie zurück.

## Der Projektadapter

Alles Projektspezifische steht in **`.claude/prd.md`** des Zielrepositorys. Lies ihn als Erstes.
Welche Schlüssel es gibt, was sie bedeuten, was ohne Adapter gilt: **`references/adapter.md`** —
das ist der Vertrag, ein Name, der dort nicht steht, ist kein Schlüssel. Seine Lesart legst du im
Plan offen. Fehlt der Adapter, leitest du ab, was ableitbar ist, fragst den Rest am Vorab-Tor und
bietest danach an, das Ergebnis als `.claude/prd.md` abzulegen.

Der Fließtext des Adapters sind Projektregeln; sie gelten wie die Regeln unten. **Der Adapter darf
verschärfen, nie lockern.** Ein Eintrag, der eine Regel dieses Skills aufheben würde, ist ein
Punkt fürs Vorab-Tor.

**Herkunft mitnennen.** Zitierst du eine Regel in einem Auftrag oder in der Forge, nenne, woher sie
stammt: *Skill*, *Adapter* oder der ADR, in dem sie steht. Wer eine Regel anzweifelt, muss wissen,
wo er sie ändern kann.

---

## Die Regeln, die nicht verhandelbar sind

1. **Der Lauf mergt nie in den Hauptzweig und nie in `<basis>`.** Er endet mit einem offenen Pull
   Request, den ein Mensch mergt. Am Hauptzweig hängt meist ein Deploy, der Migrationen fährt;
   diese Kette darf keinen menschenfreien Abschnitt haben.
2. **Gepusht wird nur nach `push_remote`**, nie auf eines der `forbidden_remotes`.
3. **Der Reviewer legt keine Issues an.** Funde außerhalb des Pakets gehen in deinen
   Abschlussbericht, höchstens drei pro Lauf, als Vorschlag. Damit ist die Schleife „Agenten
   erzeugen sich ihre eigene Arbeit" mechanisch unterbrochen.
4. **Datenmigration ist Handarbeit.** Eine Schema-Migration darf ein Paket schreiben; ein Skript,
   das Produktiv- oder Stammdaten umschreibt, wird vorgeschlagen, nicht ausgeführt.
5. **Keine Testsuite wird grün gemacht, indem Tests gelöscht oder übersprungen werden.**
6. **Fachsprache aus `glossary`.** Einträge mit `glossary_forbidden_marker` sind Verbote.
7. **Scope ist die Abnahmeliste des Pakets.** Nichts darüber hinaus. Was „Out of Scope" oder
   `out_of_scope_dir` nennt, ist geprüft und verworfen — auch wenn es beim Lesen des Codes nötig
   erscheint.
8. **Nichts existiert nur im Chat.** Jedes Issue, das der Lauf berührt — bearbeitet,
   übersprungen, zurückgelassen, blockiert —, bekommt einen Kommentar in der Forge. Der Chat ist
   weg, sobald die Sitzung endet; die Forge ist der Ort, an dem in einem halben Jahr noch steht,
   was passiert ist und warum.
9. **Ein Paket — ein Branch, ein Worktree, ein Testbett.** Der Epic-Branch ist Merge-Ziel, nicht
   Arbeitsfläche.
10. **Im Lauf wird nicht angehalten.** Gefragt wird am Vorab-Tor, eine zweite Runde nur für Punkte, die
    aus den Antworten der ersten entstehen. Was danach schiefgeht,
    lässt ein Paket zurück, nicht den Lauf (siehe „Wann angehalten wird").

---

## Die Statuslabels

KIBO zeigt den Zustand eines offenen Tickets aus drei Labels (KIBO ADR-0002). Der Lauf setzt und
entfernt sie **an den Stellen, an denen er ohnehin schreibt**, damit kein eigener Weg entsteht, der
vergessen werden kann. Die Namen sind fest und stehen hier, nicht im Adapter: KIBO liest sie über alle
Repositorys hinweg.

| Label | heißt |
|---|---|
| `status/in-arbeit` | ein Lauf hat das Ticket angefasst und ist noch nicht fertig |
| `status/blockiert` | das Ticket wartet auf ein anderes Ticket |
| `status/haengt` | ein Lauf hat es aufgegeben; ohne einen Menschen geht es nicht weiter |

- **Sie steuern nichts.** Ob der Lauf ein Ticket nimmt, entscheidet allein das Freigabelabel. Ein
  Statuslabel wird nie als Sperre gelesen, auch nicht ein fremdes.
- **Höchstens eines je Ticket.** Wer eines setzt, nimmt die beiden anderen ab.
- **Wann:**

  | Stelle | an | Label |
  |---|---|---|
  | Eröffnung (2d), Modus `spec` ohne Kinder | die Spec | `+ in-arbeit` |
  | Übersprungenes Kind (2d), **wenn der Grund ein blockierendes Ticket ist** | das Kind | `+ blockiert` |
  | Implementer startet (4a) | das Paket-Ticket | `+ in-arbeit` |
  | Kommentar nach dem Merge (5, Punkt 4) | das Kind | `− in-arbeit`; ab jetzt trägt der offene Pull Request den Stand |
  | Zurücklassen (5) | das Ticket | `+ haengt` |
  | Nachfolger eines zurückgelassenen Pakets (5) | der Nachfolger | `+ blockiert` |
  | Glut-Punkt der Lauftafel, der zu einem Ticket gehört | das Ticket | `+ haengt` |
  | Abschluss (6), Modus `spec` ohne Kinder | die Spec | `− in-arbeit` |
  | Abbruch | jedes laufende Paket | `− in-arbeit` |

  Ein Kind, das wegen eines fehlenden Labels, einer fehlenden Abnahmeliste oder eines fehlenden
  Verifikationswegs übersprungen wird, bekommt **kein** Statuslabel: es wartet auf keinen anderen,
  sondern auf eine Klärung — das zeigt KIBO über das Freigabelabel.
- **Beim Start (0a) aufräumen:** `status/in-arbeit` an Tickets dieses Epics, das ein früherer,
  abgebrochener Lauf hinterlassen hat, nimmt der Lauf ab; `status/blockiert` an Kindern, deren
  Blocker inzwischen geschlossen ist, ebenso. Ein Ticket, das der Lauf wieder aufgreift, verliert
  `status/haengt` beim Start seines Implementers.
- **Fehlt ein Label im Repository**, legt der Lauf es an — mit den Farben und Beschreibungen aus
  `references/forge.md`, damit KIBO in allen Projekten gleich aussieht.
- Jede Label-Änderung zählt in der Forge als Änderung und setzt den Stillstand des Tickets auf null.
  Das ist gewollt: am Ticket ist etwas geschehen.
- Befehle je Forge: `references/forge.md`, „Statuslabels".

---

## Phase 0 — Rüsten

### 0a — Zugang und Adapter

- Adapter lesen. Forge-Zugang herstellen und **einmal verifizieren** (`references/forge.md`): ein
  Lesezugriff auf das Zielissue und `GET /repos/{owner}/{repo}` mit `permissions.push == true`.
  Fehlt das Schreibrecht, ist es ein Tor-Punkt — es zeigt sich sonst erst beim
  Eröffnungskommentar, nach dem Tor. Der Lauf benutzt **ausschließlich** das Token aus
  `token_env` (geladen aus `token_file`), nie ein anderes, das im Repository liegt.
- `git status` muss **leer** sein. Jede Änderung ist fremde Arbeit — anhalten und fragen, nie
  wegwerfen, nie mitcommitten.
- `git worktree list`: nur das Hauptverzeichnis. Reste eines früheren Laufs melden, nicht
  entfernen — dort kann Arbeit liegen.
- **Statuslabels aufräumen**, die ein früherer Lauf an Tickets dieses Epics hinterlassen hat
  („Die Statuslabels"); fehlende Labels im Repository anlegen.

### 0b — Basis und Messung

Steht `base_branch` auf `from-issue`, läuft 0b erst, nachdem Phase 1 die Basis bestimmt hat.

- `git switch <basis> && git pull --ff-only <push_remote> <basis>`.
- **Leseprotokoll:** `must_read` ganz, `glossary` ganz, aus `adr_dir` alle Dateien bei
  `read_all_adrs`, sonst die im Issue genannten; das README der betroffenen Module.
- `pre_commit_checks` prüfen (etwa `git config core.hooksPath`): was nicht von allein läuft, fährst
  du in 4d selbst.
- **Den Ausgangsstand messen:** alle `test_commands` fahren und je Suite **Suiten- und Testzahl**
  notieren, `known_red` mit Namen. Nicht aus dem README abschreiben — dort steht der Stand vom
  letzten Mal. Die Messung liefert die Vergleichszahlen für jeden Auftrag und beantwortet vorab,
  ob der Verifikationsweg fahrbar ist; ein fehlendes Abhängigkeitsverzeichnis fällt hier auf und
  nicht beim dritten Paket. Legt ein Paket eine Suite erst an, ist ihr Ausgangsstand 0 Suiten; ab
  dem Merge dieses Pakets wird sie gefahren und verglichen.
- **Das Fenster bestimmen:** `window`, Standard 1. Drei Plätze nur mit `test_isolation_env` oder
  `isolation: none-needed` samt Begründung. Setzt der Adapter mehr Plätze ohne beides, ist das
  eine Lockerung und ein Tor-Punkt.

## Phase 1 — Lesen

- Zielissue holen und den Body **vollständig** lesen. Die sieben Abschnitte haben je eine Rolle:
  **Problem Statement** (der Schaden, der die naheliegende Lösung ausschließt), **Solution**,
  **User Stories** (Abnahmeliste im Modus `spec`), **Implementation Decisions** (Vorgaben *samt
  Begründung* — der Grund, warum ein Implementer nicht frei wählt), **Testing Decisions**
  (Verifikationsweg, benanntes Vorbild), **Out of Scope** (Verbote), **Further Notes**.
- **Kanten lesen** nach `dependency_source` (`api`, `header`, `body`; mehrere möglich), Befehle in
  `references/forge.md`. `epic_label` trennt die Bedeutung: eine Kante vom Zielissue zu einem
  anderen **Epic** heißt *Reihenfolge* (Vorbedingung), eine Kante zu einem **Nicht-Epic** heißt
  *Kind*. Das Zielissue gilt als Epic, auch wenn es das Label nicht trägt. Bei `header` nennt die
  Aufzählung `Kinder: #a, #b` in der Kopfzeile `> **Reihenfolge:**` die Kinder, alle übrigen
  Nummern dort sind Reihenfolge.
- **Modus bestimmen** — erst jetzt, weil er die Kinder braucht: `issue_form` aus dem Adapter; fehlt
  er, aus der Form — Kinder → `prd`, sieben Abschnitte ohne Kinder → `spec`, sonst Vorab-Tor. Die
  Ableitung steht im Plan.
- **Vorbedingung prüfen:** Ist ein vorausgesetztes Epic offen, gilt:
  - Hängen **alle** Pakete an noch nicht gemergten Tickets dieses Epics und steht `transitive:
    true`, werden diese Tickets im selben Lauf mitbearbeitet — ein Epic-Branch, ein Pull Request.
    Das fremde Epic bekommt Eröffnungs- und Abschlusskommentar, wird aber **nie per `Closes`
    geschlossen**.
  - Hängen nur **einzelne** Kinder daran, werden diese übersprungen (Phase 2d).
  - Sonst: Vorab-Tor.
- **Basis bestimmen**, wenn `base_branch: from-issue`: aus der Kopfzeile oder den Further Notes,
  sonst der Branch, von dem die vorausgesetzten Epics abgezweigt sind (`git log --merges`). Nicht
  raten.
- **Kinder einsammeln** (Modus `prd`, und `spec` mit Kindern): je Kind Body, Labels, State,
  Kanten. Bearbeitet wird nur, was offen ist und die Freigabe trägt. Übersprungen wird ein Kind
  mit einem der `skip_labels`, ohne `ready_label`, mit Kante in ein fremdes offenes Epic (ohne
  transitive Auflösung) oder im Modus `prd` ohne `acceptance_section` oder ohne
  `verification_section` — ohne Abnahmeliste gibt es keinen Scope, ohne Verifikationsweg ist der
  Reviewer blind.
- **Behauptungen im Body gegen den Arbeitsbaum prüfen**, bevor du planst: nennt das Issue eine
  Datei, ein Skript, einen Test als Vorbild — nachsehen, ob es existiert und noch so heißt. Bodys
  altern. Eine nicht haltbare Behauptung, an der ein Paket hängt, ist ein Tor-Punkt.
- Widerspricht das Issue einem ADR oder einem Out-of-Scope-Eintrag, ist eines von beiden falsch —
  das entscheidet ein Mensch (Vorab-Tor).

## Phase 2 — Schneiden, Graph, Vorab-Tor

### 2a — Die Pakete

**Modus `prd`:** die bearbeitbaren Kinder. Berührte Module aus `modules_section`, sonst aus der
Abnahmeliste erschlossen.

**Modus `spec` ohne Kinder:** Ein Implementer, der das ganze Issue bekommt, liefert Matsch. Du
schneidest nach diesen Regeln:

- **Entlang der Implementation Decisions, nicht der Verzeichnisse.** Sind die Decisions eine Folge,
  ist die Folge der Schnitt und die Reihenfolge Teil der Vorgabe. **Schneide nicht für
  Parallelität** — ein Schnitt, der Decisions zerlegt, damit mehr gleichzeitig läuft, tauscht
  Korrektheit gegen Minuten.
- **Jedes Paket ist für sich verifizierbar.** Kannst du keinen Weg benennen, wie du selbst prüfst,
  dass es stimmt, ist es falsch geschnitten.
- **Mechanisches und Urteilsbehaftetes trennen.** Ein Massenumschreiben ist als Verschiebung
  lesbar, ein inhaltlicher Eingriff braucht Gegenlesung; sie gehören nicht in denselben Commit.
- **Löschungen zuletzt**, als eigenes Paket ohne inhaltliche Änderung — erst wenn jeder Anschluss
  überführt und jeder Beleg gesichert ist.
- **Eine Datenwurzel kann mehrere Erzeuger haben.** Bevor ein Paket eine Zählregel über ein
  Verzeichnis bekommt, sieh nach, wer alles dort hineinschreibt.
- **Ein Schema-Versionssprung ist querschnittlich:** Wächter, die an Zahlen des alten Schemas
  hängen, reißen still — der Test bleibt grün und prüft weniger.
- **Je Paket die berührten Dateien und Module notieren.** Ohne sie gibt es keine Kollisionskante.
- **Zuordnungstabelle Story → Paket:** jede User Story genau einem Paket. Eine Story ohne Paket ist
  eine Lücke im Plan, ein Paket ohne Story Arbeit, die niemand verlangt hat.

**Modus `spec` mit Kindern:** die Kinder sind die Pakete; die Zuordnungstabelle ordnet jede Story
einem Kind zu.

### 2b — Der Graph

Der Graph wird nach dem Sortieren **nicht weggeworfen**: er entscheidet bei jedem frei werdenden
Platz neu und zeigt beim Scheitern eines Pakets sofort, welche Nachfolger mit hängen.

- **Harte Kante `A → B`:** B setzt A voraus (Kante aus Phase 1 oder Reihenfolge der Decisions). B
  startet erst, wenn A **gemergt** ist.
- **Kollisionskante `A — B`:** beide berühren dieselben Module oder Dateien. Reihenfolge frei, nie
  gleichzeitig. Zwischen allen Paketen, die eine Datei aus `always_collide` berühren, zieht sie
  sich immer — sonst entsteht etwa derselbe Versionssprung zweimal.
- **Exklusivknoten** — läuft allein, alle Plätze leer: ein Paket, das einen Pfad aus
  `exclusive_paths` ändert, das Wort `Exklusiv` in `modules_section` trägt, in eine Datenwurzel
  mit mehreren Erzeugern schreibt oder einen Punkt aus `gate_approvals` braucht.

Ist der Graph so dicht, dass nie zwei Pakete gleichzeitig laufen, ist das eine Eigenschaft des
Epics, kein Fehler. Sag es im Plan in einem Satz, statt Parallelität vorzutäuschen.

### 2c — Das Vorab-Tor

Der Sinn dieses Ablaufs ist der unbeaufsichtigte Lauf. Deshalb wird **alles Fragwürdige hier
gefragt, einmal, als nummerierte Liste mit je einer Empfehlung** — danach keine Rückfrage mehr.
Vorzulegen ist:

1. Ein vorausgesetztes Epic ist offen, und die transitive Auflösung greift nicht.
2. Das Zielissue ist nicht offen, trägt im Modus `spec` nicht das `ready_label`, oder der Modus
   ist nicht ableitbar.
3. Ein Adapterwert fehlt und ist nicht ableitbar, oder ein Adaptereintrag würde eine Regel dieses
   Skills lockern.
4. Ein Paket braucht Zugriff auf ein System aus `no_access` oder einen anderen, den es hier nicht
   gibt.
5. Ein Paket würde Produktiv- oder Stammdaten verändern (Regel 4).
6. Das Issue widerspricht einem ADR oder einem Out-of-Scope-Eintrag.
7. Eine Behauptung im Body ist gegen den Arbeitsbaum nicht haltbar, und ein Paket hängt daran.
8. Die Ausgangsmessung aus Phase 0 ist nicht fahrbar, oder die Testisolation greift nicht.
9. Der Verifikationsweg eines Pakets ist nicht fahrbar: Werkzeug, Zugang oder Ablage fehlt (etwa
   kein Docker, kein Lesetoken im Worktree, keine Ablage für Bildschirmfotos). Empfehlung dazu,
   wie mit dem nicht fahrbaren Teil umgegangen wird — etwa: er wird offener Punkt, der Pull
   Request bekommt `WIP:`.
10. Der Forge-Zugang hat kein Schreibrecht (Phase 0a).
11. Kanten wurden aus `body` gelesen, und der Adapter setzt `write_back_dependencies` für sie
    nicht: nachtragen oder nicht.
12. Jeder Punkt aus `gate_approvals`, den ein Paket berührt. Vorzulegen: was es beantwortet, was es
    kostet, was die harte Grenze ist.

**Fehlt der Adapter,** legt das Tor die abgeleiteten Werte immer als eigene Liste vor, auch wenn
sonst nichts zu melden ist.

Ist nichts zu melden, sag das in einem Satz und lauf los. Sonst Liste vorlegen und **einmal**
warten. Ergeben die Antworten neue Punkte, werden nur diese in einer zweiten Runde gefragt.

### 2d — Plan, Lauftafel, Eröffnung

- **Plan einmal ausgeben:** Modus und seine Herleitung, Basis, Pakete mit Modulen, Graph,
  Reihenfolge samt Begründung, im Modus `spec` die Zuordnungstabelle, was bewusst nicht angefasst
  wird, die Lesart des Adapters.
- Je Paket eine Task anlegen (Task-Werkzeug der Sitzung, falls vorhanden), in Reihenfolge.
- **Lauftafel** bauen, bevor das erste Paket startet; bei `plan_artifact: publish` veröffentlichen,
  bei `file` nur schreiben (ein alter Wert `off` gilt als `file`). Sie wird **kopiert, nicht
  entworfen**: Vorlage `references/lauftafel.html`, Aufbau, Zustände, offene Punkte und Prüfung
  vor der Veröffentlichung in `references/lauftafel.md`. Die
  Datei liegt in deinem Scratchpad, nicht im Repository. Bei `publish` ändert sich ihre URL über den
  ganzen Lauf nicht — jede Fortschreibung geht auf denselben Dateipfad. Den Graphen zeigt die Pakettabelle
  mit den Modulen je Paket als Spalte, keine Figur. Am Anfang stehen alle Pakete auf „wartend";
  das ist ein gültiger Zustand.
- **Übersprungene Kinder sofort kommentieren** — jetzt, vor dem ersten Paket: dass dieser Lauf es
  nicht bearbeitet, der genaue Grund (blockierendes Ticket mit Nummer, fehlendes Label, fehlende
  Abnahmeliste, fehlender Verifikationsweg) und **was es freischaltet**. Ist der Grund ein
  blockierendes Ticket, bekommt das Kind im selben Zug `status/blockiert`. Ein Grund, der nur im
  Chat steht, führt zu einem vergessenen Ticket oder einem in falscher Reihenfolge.
- **Kanten nachtragen:** bei `write_back_dependencies` jede aus `header` gelesene Kante, aus `body`
  nur nach Adapter oder Antwort am Tor, in die Abhängigkeiten der Forge eintragen
  (`references/forge.md`), damit andere Werkzeuge sie sehen. Nur innerhalb desselben Repositorys,
  auf GitHub nichts (`references/adapter.md`, „Auslegung").
- Im Modus `spec` ohne Kinder bekommt die Spec mit dem Eröffnungskommentar `status/in-arbeit`.
- **Eröffnungskommentar** am Zielissue (bei transitiver Auflösung auch am fremden Epic): dass der
  Lauf beginnt, Modus, Basis, Epic-Branch, Paketliste, die geplante Belegung, im Modus `spec` die
  Zuordnungstabelle, der Link auf die Lauftafel (bei `file` ihr Pfad). Kommentare gehen **aus
  einer Datei**, nie aus einer Shell-Zeichenkette (`references/forge.md`).

Danach **ohne Rückfrage** losarbeiten.

## Phase 3 — Epic-Branch und Worktrees

- Branchname `epic/<nr>-<slug>`. Slug aus dem Issue-Titel ohne Präfixe wie `Epic:` oder `Spec:`:
  klein, ASCII, höchstens vier Wörter, Umlaute transliteriert (ä→ae, ö→oe, ü→ue, ß→ss).
- `git switch -c epic/… <basis>`. Existiert der Branch schon: wiederverwenden (`git switch`, bei
  vorhandenem Remote `git pull --ff-only`). Nie neu anlegen, nie `--force`, nie zurücksetzen —
  dort kann Arbeit eines früheren Laufs liegen.
- Je laufendem Paket ein eigener Branch `agent/<nr>-<slug>` in einem eigenen Worktree unter
  `worktree_root`, gezogen vom **aktuellen** Epic-Kopf. `<nr>` ist die Kindnummer, im Modus `spec`
  ohne Kinder `<spec>-p<k>`. Dadurch enthält jedes spätere Paket alles Gemergte, und ein Konflikt
  kann nur noch von einem gleichzeitig laufenden Paket kommen.
- Anlegen und Rüsten (`env_files` kopieren, `link_dirs` nur für berührte Module, `always_link`
  immer, `test_isolation_env`, `port_env`) und Abräumen: **`references/worktree.md`**. Lies die
  Datei, bevor du den ersten Worktree anlegst.

## Phase 4 — Das Fenster

Kein Wellenmodell mit Barrieren — ein gleitendes Fenster mit `window` Plätzen (Phase 0). Wird ein
Platz frei, rückt sofort das nächste startbereite Paket nach.

**Startbereit** ist ein Paket, wenn alle harten Vorgänger **gemergt** sind und zu keinem laufenden
Paket eine Kollisionskante besteht. Ein Exklusivknoten startet nur bei leeren Plätzen. Bei mehreren
Kandidaten gewinnt, wer die meisten Nachfolger entsperrt; bei Gleichstand die kleinere Nummer. Ist
keiner startbereit, bleibt der Platz leer — das ist kein Fehler.

**Diese Wahl triffst du bei jedem frei werdenden Platz neu.** Die Belegung auf der Tafel ist eine
Vorschau, keine Entscheidung. Hängen zwei Pakete am selben Vorgänger und kollidieren miteinander,
entscheidet „wer entsperrt mehr" — oft **nicht** die kleinere Nummer. Eine Abweichung von der
Vorschau trägst du auf der Tafel nach, mit Grund.

Warum höchstens drei: du fährst jeden Verifikationsweg selbst nach und liest jeden
Reviewer-Bericht — das ist die Engstelle, nicht die Rechenzeit. Und die Kollisionspaare wachsen
quadratisch.

### 4a — Implementer-Subagent

Ein Subagent je Paket (`Agent`, `subagent_type: general-purpose`, `run_in_background: true`;
mehrere Starts in **einer** Nachricht). Mit dem Start bekommt das Paket-Ticket `status/in-arbeit`
(im Modus `spec` ohne Kinder trägt es die Spec schon). Er hat deinen Kontext nicht; sein Auftrag enthält alles
**ausgeschrieben**:

- Den absoluten Pfad seines Worktrees und die Arbeitsweise darin nach „Der Subagent im Worktree"
  in `references/worktree.md` — einschließlich dessen, ob `EnterWorktree` in dieser Sitzung
  gelingt. Prüf das einmal für den Lauf und schreib das Ergebnis in jeden Auftrag, statt jeden
  Agenten dieselbe Entdeckung machen zu lassen. Nichts außerhalb des eigenen Worktrees anfassen.
- Paketnummer, Titel bzw. Zielsatz, die Abnahmeliste **im Wortlaut** (Kind-Body oder zugeordnete
  User Stories).
- Die betreffenden Implementation Decisions **samt Begründung** — ohne sie wählt er die
  naheliegende Lösung, gegen die die Decision geschrieben wurde. Dazu die relevanten
  Out-of-Scope-Punkte und die Testing Decisions mit benanntem Vorbild.
- Die **Ausgangszahlen** der betroffenen Suiten aus Phase 0.
- Steht das Paket in einer Kette: den **Schnittstellenabschnitt des Reviewers** des Vorgängers,
  wörtlich (4b).
- Pflichtlektüre vor der ersten Änderung: `must_read`, `glossary`, die genannten ADRs, das README
  des betroffenen Moduls.
- Die Regeln, je mit Herkunft: Fachsprache samt Verboten; Scope strikt die Abnahmeliste; keine
  Umbenennung und kein Refactoring ohne Auftrag; keine neue Abhängigkeit ohne Nennung im Issue;
  keine Tests löschen oder überspringen; die Projektregeln des Adapters; **nicht committen, nicht
  branchen** — das macht der Host.
- Den Verifikationsweg im eigenen Worktree fahren, mit gesetzter Isolationsvariable.
- Berichtsform: geänderte und **neue** Dateien; je Abnahmepunkt ein Satz, wie er erfüllt ist;
  Verifikation mit echter Ausgabe; was er nicht konnte und warum.

Verlangt ein Paket, dass etwas „im Issue vermerkt" wird, notiert der Implementer den Text — das
Kommentieren machst du in Phase 5.

### 4b — Reviewer-Subagent

Ein zweiter Subagent, im selben Worktree, nach dem Implementer. Er bekommt Paket, Issue-Auszug,
den Bericht des Implementers und den Diff, und prüft zwei Achsen getrennt:

- **Spec:** Ist jeder Abnahmepunkt erfüllt — nachweisbar, nicht behauptet? Ist etwas gebaut, was
  niemand verlangt hat? Ist ein Out-of-Scope-Punkt verletzt, eine Decision umgangen, weil die
  naheliegende Lösung bequemer war?
- **Standards:** Fachsprache; kein toter oder auskommentierter Rest; keine ADR-Verletzung; Tests
  entlang des Verifikationswegs in der Form des Vorbilds; Stil des umgebenden Codes; die
  Projektregeln des Adapters.

**Ein Wächter oder ein Tor wird gegen sich selbst geprüft: Positivprobe und Gegenprobe.** Ein
Wächter ohne Nachweis, dass er feuern kann, ist schlimmer als keiner.

Drei Dinge schreibst du ihm ausdrücklich in den Auftrag:

- **Den Diff-Befehl `git -C <worktree> diff HEAD`** und den Epic-Kopf, auf dem sein Worktree steht.
  Ein Diff gegen den Epic-Branch zeigt inzwischen gemergte Pakete als vermeintliche Änderung, und
  der Reviewer sucht Fehler in fremdem Code.
- **Die neuen Dateien namentlich**, mit der Anweisung, sie direkt zu lesen. Sie stehen in keinem
  Diff; eine neue Kernfunktion, die er nie sieht, nimmt er ungeprüft ab.
- **Steht das Paket in einer Kette, hält er die Schnittstelle fest**: was tatsächlich dasteht —
  Signatur, Merkmale der Ausgabe, jede Abweichung vom Vorgänger. Der Implementer beschreibt, was
  er bauen wollte; dieser Abschnitt geht wörtlich in den Auftrag des Nachfolgers.

Er **korrigiert selbst, aber nur im Kleinen**: Benennung, Kommentar, ein fehlender Testfall, ein
vergessener Rest. Eine strukturelle Abweichung oder einen verletzten Abnahmepunkt berichtet er
strukturiert — dann schickst du den Implementer mit dem Befund erneut los. Nach **`max_rounds`**
Runden (Standard 3) wird das Paket zurückgelassen (Phase 5). Funde außerhalb des Pakets notiert er
im Bericht, ohne Issues anzulegen oder vorzuschlagen (Regel 3).

### 4c — Verifikation durch dich

Fahre den Verifikationsweg selbst im Worktree des Pakets; glaub ihn nicht dem Bericht. Bei einem
Wächter oder Tor fährst du auch die Gegenprobe. Bekannt rote Suiten (`known_red`) sind kein Grund,
neues Rot zu akzeptieren, und eine bekannt rote Suite, die das Paket berührt, wird nicht
ignoriert.

**Vergleiche gegen die Ausgangszahlen aus Phase 0.** Grün allein genügt nicht: **eine gesunkene
Suiten- oder Testzahl ist ein Befund, auch wenn alles grün ist.** Ein Agent, der „alle Suiten
grün" meldet, hat nichts über die Vollzähligkeit gesagt.

### 4d — Commit auf dem Paket-Branch

- `pre_commit_checks` fahren, soweit sie nicht von allein laufen, und die Projektregeln des
  Adapters für Commits erfüllen (etwa eine Pflichtdatei bei nutzersichtbarer Änderung).
- Ein Commit im Worktree auf `agent/<nr>-<slug>` nach `commit_style`, `commit_language`,
  `commit_umlauts`; Issue-Nummer im Betreff, Body mit dem *Warum*, am Ende die
  `Co-Authored-By`-Zeile, die deine Sitzung vorgibt.

## Phase 5 — Sofortmerge

Sobald ein Paket abgenommen ist, wandert es **sofort** in den Epic-Branch, nicht gesammelt am Ende.
Der Paket-Branch lebt Minuten statt Stunden neben dem Epic-Branch, und jedes spätere Paket beginnt
bereits auf ihm.

1. Im Hauptverzeichnis: `git switch epic/<…>` und `git merge --no-ff agent/<nr>-<slug>`.
2. Die betroffenen Suiten auf dem Epic-Branch fahren. Rot heißt: nicht weiterrücken — den Merge
   mit `git revert -m 1` als eigenen Commit zurücknehmen und das Paket zurücklassen (unten). Dann
   wird nur der Worktree abgeräumt, der Branch bleibt: er gilt als gemergt, `git branch -d`
   gelänge, und ein erneuter Merge brächte die Änderung nicht zurück.
3. Sonst Worktree und Paket-Branch abräumen (`references/worktree.md`), nie `--force`. Platz frei.
4. **Kommentar an das gemergte Ticket** — im Modus `prd` und `spec` mit Kindern das Kind, im Modus
   `spec` ohne Kinder die Spec. Hinein: Paket, Merge-Commit und Branch, **je Abnahmepunkt die
   Fundstelle** (Datei, Zeile, Test) statt einer Behauptung, der gefahrene Verifikationsweg mit
   echter Ausgabe und den Zahlen gegen Phase 0, was der Reviewer selbst korrigiert hat, was das
   Issue vermerkt haben will, die offenen Punkte. Mit dem Kommentar verliert das Kind
   `status/in-arbeit`.
5. **Lauftafel fortschreiben** nach `references/lauftafel.md`: Zustand, Merge-Commit und Runden
   des Pakets, neu gestartete Pakete, Teststand, Abweichungen vom Plan, offene Punkte. Die
   Fortschreibung gehört an **diese** Stelle — die Tafel ist der einzige Ort, an dem der Stand für
   jemanden sichtbar wird, der den Chat nicht liest; eine Tafel, die nach dem dritten Merge den
   Anfang zeigt, sieht aktuell aus und ist falsch.
6. **Kein Issue schließen.** Es schließt sich beim Merge des Pull Requests über `Closes`.

**Ein Merge-Konflikt ist eine Aussage über den Graphen, nicht über Git.** Er kann nur von einem
gleichzeitig laufenden Paket kommen, und genau die sollte eine Kollisionskante ausschließen. Tritt
er auf: Kante nachtragen, im Bericht nennen, und den Konflikt **nur lösen, wenn er mechanisch ist**
(getrennte Zeilen, Importlisten, benachbarte Einträge). Alles Inhaltliche macht das Paket zu einem
nicht abgenommenen.

### Zurücklassen

Ein Paket wird **zurückgelassen**, wenn es nach `max_rounds` nicht abnahmefähig ist, ein Konflikt
nicht mechanisch ist, sein Worktree schmutzig bleibt, der Epic-Branch nach dem Merge rot wird, oder
sich im Lauf zeigt, dass es einen Zugriff oder eine Freigabe braucht, die am Tor nicht vorlag. Der
Lauf hält deswegen **nicht** an — nichts davon ist gemergt, alles ist folgenlos aufhebbar:

- Branch bleibt stehen; der Worktree wird entfernt, ein schmutziger bleibt stehen und wird
  gemeldet.
- Kommentar an das Ticket (wie Punkt 4): was fehlt, wo sein Branch liegt. Nach einem Revert
  zusätzlich der Revert-Commit und der Hinweis „zurückholen = Revert des Reverts". Das Ticket
  bekommt `status/haengt` statt `status/in-arbeit`.
- Tafel: Zustand „nicht abgenommen", der Grund als Glut-Punkt beim Menschen.
- Jeder Nachfolger im Graphen wird **blockiert**, auf der Tafel so markiert, sofort
  kommentiert, mit Nennung des blockierenden Pakets, und bekommt `status/blockiert`.

## Phase 6 — Abschluss

- Gesamtlauf über alle `test_commands`, gegen Phase 0 gestellt; `git log --oneline
  <basis>..HEAD` als Übersicht.
- **Lauftafel ein letztes Mal fortschreiben**, bevor du den Pull Request eröffnest: alle Zustände
  endgültig, tatsächliche Belegung gegen geplante, Teststand vorher/nachher, offene Punkte.
- `git push -u <push_remote> epic/<nr>-<slug>`.
- **Pull Request** eröffnen (`references/forge.md`), `base: <basis>`, `head: epic/…`:
  - **Titel = Issue-Titel**, mit Präfix `WIP: `, solange etwas beim Menschen liegt: ein Paket
    zurückgelassen oder blockiert, ein Verifikationsweg nicht fahrbar, eine Freigabe offen.
  - **Body:** je Paket eine Zeile mit Ergebnis; Link auf die Lauftafel; die Stil-Checkliste des
    Reviewers; die offenen Punkte; je Kind mit offenem Blocker der Satz „schließt sich ggf. nicht
    automatisch (412), dann von Hand".
  - **`Closes`, nur englische Schließwörter, in der Reihenfolge des Graphen:** Modus `prd` →
    `Closes #<kind>` je vollständig abgenommenem Kind; Modus `spec` → `Closes #<spec>` nur, wenn
    **alle** User Stories abgenommen sind, und hat die Spec Kinder, zusätzlich `Closes #<kind>` je
    vollständig abgenommenem Kind. Ein fremdes Epic aus transitiver Auflösung nie.
- **Nicht mergen.**
- **Abschlusskommentar am Zielissue** (und am fremden Epic). Das ist der Schritt, der am
  leichtesten ausfällt, weil sich der Lauf nach dem Pull Request fertig anfühlt. Hinein: Link auf
  Pull Request und Lauftafel; je Paket Ergebnis, Merge-Commit, Runden; tatsächliche gegen geplante
  Belegung und woran Abweichungen lagen; übersprungene und blockierte Tickets mit Grund und dem,
  was sie freischalten; Teststand vorher/nachher; was beim Merge passiert, wenn der Lauf eine
  Migration enthält; und unter der festen Überschrift `### Was das Epic offen lässt`, was das
  Epic noch offen lässt.
- Im Modus `spec` ohne Kinder verliert die Spec mit dem Abschlusskommentar `status/in-arbeit`.
- **Nachzählen:** für **jede** berührte Nummer — Zielissue, fremdes Epic, jedes Kind, jedes
  übersprungene und blockierte Ticket — prüfen, dass der Kommentar wirklich steht **und das
  Statuslabel dem Endstand entspricht**: kein `status/in-arbeit` mehr im ganzen Lauf, `status/haengt`
  an jedem zurückgelassenen, `status/blockiert` an jedem blockierten Ticket (`references/forge.md`).
  Ein `POST` kann fehlgeschlagen sein.
- `git worktree list`: nur das Hauptverzeichnis, plus gemeldete schmutzige Worktrees.
- **Bericht an den Menschen:** Reihenfolge und warum; je Paket bzw. Story abgenommen oder nicht,
  mit Beleg; zurückgelassene Pakete mit Branch; übersprungene Tickets mit Grund; Reviewer-Funde
  außerhalb (höchstens drei) als Vorschlag zur Entscheidung; Links auf Pull Request und Tafel, mit
  dem Satz, was der Merge auf `<basis>` auslöst.

---

## Wann angehalten wird

**Vor dem Lauf** — und nur dort:

- Das Arbeitsverzeichnis ist nicht sauber, oder es liegen Worktrees eines früheren Laufs herum
  (Phase 0).
- Das Vorab-Tor hat Punkte (2c). Einmal, als eine Liste; nur neue Punkte aus den Antworten in
  einer zweiten Runde.

**Im Lauf wird nicht angehalten.** Was schiefgeht, lässt ein Paket zurück (Phase 5), die übrigen
laufen weiter.

**Wird der Lauf trotzdem abgebrochen** — durch den Menschen, die Sitzung, den Verlust der Forge —,
wird **nichts weggeworfen**: der Epic-Branch bleibt, die fertigen Merges bleiben, zurückgelassene
Branches bleiben. Der Stand kommt in die Forge (Kommentar am Zielissue und an den laufenden Paketen)
und auf die Tafel: laufende Pakete verlieren „in Arbeit" **auf der Tafel und als Label**, der
Abbruchgrund steht als Glut-Punkt beim Menschen. Ein `status/in-arbeit`, das nach einem Abbruch
stehen bleibt, lügt wie eine Tafel, die stehen bleibt. Ein Abbruch, der nur im Chat steht, ist von „noch nicht angefangen" nicht zu
unterscheiden; eine Tafel, die drei Pakete als „in Arbeit" stehen lässt, behauptet, es liefe noch
etwas.

---

## Was am Ende in der Forge stehen muss

| Issue | Kommentar | Zustand danach |
|---|---|---|
| jedes gemergte Paket-Ticket (Kind, in beiden Modi) | Merge-Commit, Fundstelle je Abnahmepunkt, Verifikation, offene Punkte | offen, ohne Statuslabel — schließt über `Closes` |
| jedes zurückgelassene Ticket | was fehlt, wo sein Branch liegt | offen, `status/haengt` |
| jedes blockierte Ticket | das blockierende Paket | offen, `status/blockiert` |
| jedes übersprungene Kind | Grund und was es freischaltet | offen; `status/blockiert` nur, wenn ein Ticket der Grund ist |
| das Zielissue | Eröffnung mit Tafel-Link; im Modus `spec` ohne Kinder je Merge; Abschluss mit PR-Link | offen — schließt über `Closes` (nur `spec`, nur bei allen Stories) oder ein Mensch |
| ein fremdes Epic (transitiv) | Eröffnung und Abschluss mit Begründung | offen — schließt ein Mensch |

Die Lauftafel steht auf dem Endstand. Prüfe die Tabelle nach, statt sie anzunehmen.
