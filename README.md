<h1><img src="assets/icon.svg" width="48" height="48" alt="" align="top"> agent-skills</h1>

Claude-Code-Skills, mit denen Agenten freigegebene Missionen aus der Forge (Gitea oder GitHub)
umsetzen: vom Issue bis zum Pull Request, in parallelen Paketen, jedes geprüft. Ein Programm, der
Flotten-Treiber, führt mehrere solcher Läufe gleichzeitig auf einem oder mehreren Claude-Konten;
die Flottenbrücke zeigt, was dich braucht, und nimmt deine Antworten an. Angedockt wird nur so, wie
der Adapter des Projekts es erlaubt.

## Wer entscheidet

Unter dem Treiber entscheidet der **Admiral** die Fragen der Läufe selbst; dafür ist er da. Du
bestätigst nichts vorab, du liest nach und nimmst zurück, was dir nicht passt. Bei dir liegt eine
Frage nur, wenn eine der sechs Prüffragen mit Ja beantwortet wird. Dieselben Fragen entscheiden in
der Nacharbeit und in der Triage, ob aus einem Punkt ein Ticket wird.

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/befugnisse-schmal.png">
  <img src="assets/readme/befugnisse.png" width="880" alt="Wer entscheidet, in drei Teilen. Erstens sechs Prüffragen, bei jedem Ja entscheidet der Mensch: 1 geht etwas nach außen, das sich nicht zurückholen lässt; 2 echtes Geld, das nicht freigegeben ist; 3 Produktivdaten ohne eindeutigen Beschluss; 4 Sicherheit oder Zugänge, die nicht abgestimmt und festgehalten sind; 5 ein Text oder Versprechen an Kunden, geprüft am PR; 6 ein Bruch mit einer Architekturentscheidung oder eine unübliche neue Abhängigkeit. Sechsmal nein: Der Admiral entscheidet selbst; eine Tatsache, die nur der Mensch kennt, hält nichts an. Zweitens, wird aus einem Punkt ein Ticket: braucht es den Menschen, eine der sechs Fragen oder eine Änderung am Ablauf des Projekts, dann needs-triage; klar und angemessen, dann in der Mission erledigen, zuerst Fehler; klar, aber zu groß, dann ein freigegebenes Issue; ein Wunsch ohne beobachteten Schaden wird verworfen. Drittens gilt immer: Admiral und Läufe docken nie an, keine Antwort lockert eine Regel, jede Entscheidung steht am Issue und ist bis zum Andocken widerrufbar.">
</picture>

### Prüffragen: Admiral oder Mensch

| # | Prüffrage | Ja | Nein |
|---|---|---|---|
| 1 | Geht etwas **nach außen**, das sich nicht zurückholen lässt — E-Mails, Nachrichten an Dritte, Daten an Stellen außerhalb? | Mensch | weiter |
| 2 | Kostet es **echtes Geld**, das nicht vorher freigegeben ist? | Mensch | weiter |
| 3 | Ändert es **Produktivdaten**, ohne dass das eindeutig beschlossen ist? | Mensch | weiter |
| 4 | Berührt es **Sicherheit oder Zugänge**, die nicht mit dir abgestimmt und in Mission, Ticket oder PR festgehalten sind? | Mensch | weiter |
| 5 | Entsteht ein **Text oder Versprechen an Kunden**? | Mensch (am PR) | weiter |
| 6 | Bricht es eine **Architekturentscheidung** (ADR), oder bringt es eine neue Abhängigkeit, die nicht üblich und nicht Best Practice ist? | Mensch | **Admiral** |

Sechsmal nein heißt: Der Admiral entscheidet, auch gegen die Empfehlung des Laufs — Umfang
(weglassen, dazunehmen, in ein Ticket verschieben), Reihenfolge und Kanten, ein neues Ticket, ein
ADR-Bezug ohne Bruch, ein Prüfweg, der hier nicht fahrbar ist, Handgriffe und Doku in der Nacharbeit,
einen abgebrochenen Lauf einmal fortsetzen. Kosten des Planlimits sind keine Frage für ihn; die
regeln die Bremsen des Treibers. Eine Tatsache, die nur du kennst, hält nichts an: Er nimmt einen
vorsichtigen Wert und fragt dich nebenher.

### Nacharbeit und Triage: wird aus einem Punkt ein Ticket?

Die erste Frage, die mit Ja beantwortet wird, entscheidet.

| # | Frage | Ja | Wo das gilt |
|---|---|---|---|
| 1 | Braucht es **dich** — eine der sechs Prüffragen oder eine Änderung am **Ablauf des Projekts**? | Ticket mit `needs-triage` und einem Satz zur Ursache | Lauf, Nacharbeit |
| 2 | Ist die Arbeit **klar und nach Zeit und Umfang angemessen**? | In der Mission erledigen, bevor sie andockt — zuerst gefundene Fehler und was zum Missionsziel gehört | Lauf, Nacharbeit |
| 3 | Klar, aber **zu groß** für diese Mission? | Eigenes Issue mit `epic` und Freigabelabel, ohne Triage | Lauf, Nacharbeit |
| 4 | Ein **Wunsch ohne beobachteten Schaden**? | Verworfen: eine Zeile unter „Verworfen“ im Missions-PR; in der Triage „not planned“ geschlossen, nie gelöscht | Nacharbeit, Triage |

Eine Ticketfrage geht nie an dich; der Missions-PR listet jedes angelegte Ticket.

### Was immer gilt

- Admiral und Läufe **docken nie an**. Wer andockt, sagt allein der Adapterschlüssel `merge`:
  `mensch` heißt du, `nach_gate` heißt der Andock-Akteur des Treibers nach grüner Andockprüfung.
- **Keine Antwort lockert eine Regel** der Skills.
- **Jede Entscheidung steht am Issue**, mit Herkunft (Projektregel, Skill-Empfehlung, Präzedenz mit
  Fundstelle oder eigenes Urteil mit Grund), und ist bis zum Andocken widerrufbar — auf der Brücke
  mit „Zurücknehmen“.

### Wo die Regeln stehen und wo die KI sie prüft

| Regel | Steht in | Benutzt von | Gehalten durch |
|---|---|---|---|
| Prüffragen 1–6 | `BEIM_MENSCHEN` in [`flotte/src/treiber/admiral.ts`](flotte/src/treiber/admiral.ts), wortgleich in [`flotte/references/entscheidungsrecht.md`](flotte/references/entscheidungsrecht.md) und [`mission/SKILL.md`](mission/SKILL.md) | dem Admiral bei jedem Frageblock eines Laufs (Tor, Nacharbeit, Abbruch), der Triage bei jeder Frage | [`flotte/test/entscheidungsrecht.test.ts`](flotte/test/entscheidungsrecht.test.ts), [`flotte/test/befugnisse.test.ts`](flotte/test/befugnisse.test.ts) |
| Ticketregel | `TICKET_REGEL` in `admiral.ts`, wortgleich in `mission/SKILL.md` (Regel 3) und [`mission-nacharbeit/SKILL.md`](mission-nacharbeit/SKILL.md) | dem Lauf bei jedem Fund außerhalb eines Pakets, der Nacharbeit in jeder Fragerunde („Sitzung, verworfen oder Ticket“), dem Admiral | [`flotte/test/tickets.test.ts`](flotte/test/tickets.test.ts), `befugnisse.test.ts` |
| Verwerfen in der Triage | Schnittplan-Auftrag in [`flotte/src/triage.ts`](flotte/src/triage.ts) | dem Triage-Lauf über alle Sternzeit-Notizen eines Projekts | `tickets.test.ts` |
| Herkunft jeder Entscheidung | `HERKUNFT_REGEL` in `admiral.ts` | Admiral und Triage, im Kommentar am Issue | `befugnisse.test.ts` |
| Nie andocken | Regel 1 in `mission/SKILL.md` und `entscheidungsrecht.md` | jedem Lauf, dem Admiral | Hook [`mission/scripts/guard.ps1`](mission/scripts/guard.ps1) sperrt `gh pr merge` im Lauf |

Diese Seite ist die lesbare Fassung; maßgeblich ist der Wortlaut im Code. `befugnisse.test.ts` prüft,
dass er hier unverändert steht:

<details>
<summary>Wortlaut, wie ihn der Admiral bekommt</summary>

**Beim Menschen liegt nur:**

1. was nach außen geht und sich nicht zurückholen lässt: E-Mails und Nachrichten an Dritte, Daten an Stellen außerhalb
2. echtes Geld, das nicht vorher freigegeben ist
3. Produktivdaten ändern, wenn das nicht eindeutig beschlossen ist
4. Sicherheit und Zugänge, außer sie sind mit dem Menschen abgestimmt und in der Mission, im Ticket oder PR verankert
5. Texte und Versprechen an Kunden, die erst in der Mission entstehen (Prüfung am PR)
6. Architektur: eine neue Abhängigkeit, die nicht üblich und nicht Best Practice ist, oder ein Bruch mit einer Architekturentscheidung (ADR)

**Ticketregel:**

Ein neues Ticket nur, wenn der Mensch gebraucht wird: ein Befund, der eine Entscheidung von der Liste „Beim Menschen“ verlangt (Sicherheit und Zugänge, ein Bruch mit einer Architekturentscheidung, was nach außen geht) oder den Ablauf des Projekts ändert. Arbeit, die klar ist und nach Zeit und Umfang angemessen ist, wird in der Mission erledigt, bevor sie andockt: zuerst gefundene Fehler und was zum Missionsziel gehört. Klare Arbeit, die dafür zu groß ist, wird ein Issue mit `epic` und dem Freigabelabel, nicht `needs-triage`. Ein Wunsch ohne beobachteten Schaden wird verworfen: eine Zeile unter „Verworfen“ im Missions-PR, kein Ticket. Jedes Ticket für den Menschen trägt `needs-triage` und einen Satz zur Ursache, und der Missions-PR listet die angelegten Tickets. Eine Ticketfrage geht nicht an den Menschen.

</details>


## Das Bild

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/ablauf-schmal.png">
  <img src="assets/readme/ablauf.png" width="880" alt="Von der Mission zum Andocken, in drei Bändern. Start, Frage 1, wer startet den Lauf: Eine Mission oder eine Spec mit dem Label ready-for-agent startet entweder über den Treiber als Regelweg (flotte fahren, ein claude -p je Mission, verteilt auf Konto 1, 2 und 3) oder durch dich im Chat mit /mission #nr. Die Flottenbrücke zeigt den Stand und nimmt deine Antworten und Handlungen an; nur der Treiber spricht mit ihr, er meldet jeden Takt und holt ab. Lauf, /mission als Orchestrator: Das Vorab-Tor schneidet die Mission in Pakete und fragt einmal; bis zu drei Pakete laufen gleichzeitig in eigenen Worktrees; Review, Verifikation und Sofort-Andocken je Paket auf den Missions-Branch; am Ende ein Pull Request mit Andockblock, der Lauf dockt nie an. Andocken, Frage 2, wer andockt, allein der Adapterschlüssel merge: bei merge: mensch dockst du an; bei merge: nach_gate ein Akteur außerhalb des Laufs, die Andock-Schlange des Treibers mit merge.ps1, nur mit gültigem Nachweis der Andockprüfung. Danach /mission-aufraeumen. Die beiden Fragen hängen nicht zusammen.">
</picture>

Ob der Treiber oder du im Chat einen Lauf startet, ändert nichts daran, wer andockt. **Welchen Weg
wann:** Der Treiber ist der Regelweg, auch für eine einzelne Mission; er verteilt Läufe auf Konten,
bremst bei vollem Speicher oder Limit, legt dir nur die Fragen vor, die bei dir liegen, und fährt
`/mission-nacharbeit` von selbst. Einen Lauf im Chat startest du, wenn du eine Mission begleiten willst,
etwa das Vorab-Tor selbst beantworten; dann gehört `/mission-nacharbeit` vor das Andocken, solange der PR
offen ist.

Ein **Lauf** (`/mission`) liest die Mission, schneidet sie in Pakete, fragt einmal am Vorab-Tor und setzt
dann bis zu drei Pakete gleichzeitig um, jedes in eigenem Worktree mit Ingenieur, Erstem Offizier und
Nachprüfung. Er endet mit einem offenen Pull Request. Den Stand zeigt im Einzellauf die
**Lauftafel** im Browser; unter dem Treiber gibt es keine, dort zeigt ihn die Brücke. Was ein Lauf
fragt, geht so weiter:

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/rueckfrage-schmal.png">
  <img src="assets/readme/rueckfrage.png" width="880" alt="Wenn ein Lauf fragt, in acht Schritten zwischen Lauf, Treiber, Admiral, Brücke und Mensch. 1: Der Lauf schickt dem Treiber FLOTTE-FRAGE, den Frageblock. 2: Der Treiber gibt den Frageblock dem Admiral, einem eigenen claude -p. 3: Der Admiral entscheidet, was bis zum Andocken umkehrbar ist, mit Grund und Marke. 4: Den Rest legt der Treiber als Fragekarte in „Braucht dich“ auf die Brücke. 5: Der Mensch antwortet dort mit einem Tipp auf die Empfehlung, mit einer Option oder mit Freitext, mit PIN. 6: Der Treiber holt die Antwort im nächsten Takt ab und quittiert sie. 7: Der Lauf macht mit den Antworten weiter. 8: Mit „Zurücknehmen“ geht bis zum Andocken eine neue Entscheidung über Brücke und Treiber an den Lauf. Jede Entscheidung steht danach als Kommentar am Issue; bis zum Andocken nimmst du jede in der Detailansicht der Mission zurück.">
</picture>

## Die Brücke

Fünf Bereiche, oben als Pillen, auf dem Handy unten in Daumenreichweite; der Zähler „Braucht dich“
steht auf jeder Seite, die Schiffsliste links zeigt alle Läufe und Sitzungen.

- **Brücke:** was du tun musst, in drei Ebenen: **Braucht dich** (Fragen und blockierte Missionen, mit
  „Neu einreihen“ und „Aufgeben“), **Unterwegs** (Läufe mit Lebenszeichen und Andock-Schlange),
  **Erledigt heute**. Die **Detailansicht** einer Mission zeigt je Paket Phase, Runde und Stufe und
  darunter die **Entscheidungen bis zum Andocken**: deine und die des Admirals, jede bis zum Andocken
  zurücknehmbar.
- **Holodeck:** die Prototypen der Projekte zum Ansehen, als Schreibtisch oder Telefon.
- **Sternenkarte:** Projekte mit ihrem Backlog und der Reihenfolge der Missionen.
- **Maschinenraum:** Tanks je Konto, RAM und Platte je Rechner, Bremsstufe und ihr Grund.
- **Logbuch:** Ereignisse, Entscheidungen des Admirals und deine Handlungen.

<picture>
  <source media="(max-width: 600px)" srcset="flottenbruecke/doku/v3-bruecke-390.png">
  <img src="flottenbruecke/doku/v3-bruecke-1440.png" alt="Flottenbrücke v3 mit den Beispieldaten. Oben das Logo, die Befehlszeile, der Zähler „Braucht dich 2“ und die fünf Bereiche als Pillen. Links die Schiffsliste mit den Läufen des Projekts und den Sitzungen. Rechts der Kopf mit Tanks je Konto, RAM und Platte, darunter die Ebene „Braucht dich“ mit Mission #40 blockiert (Neu einreihen, Log ansehen, Aufgeben) und Frage 1 von #39 mit den Optionen A bis C und dem Knopf „A nehmen · Empfehlung“. Darunter „Unterwegs“, unten das Logbuch als Laufband.">
</picture>

Bilder aller Bereiche und der Detailansicht, je 1440 und 390 px breit: [`flottenbruecke/doku/`](flottenbruecke/doku/);
alles Weitere im [README der Brücke](flottenbruecke/README.md).

## Schnellstart

1. **Installieren** (Windows, PowerShell), Einzelheiten in [`INSTALL.md`](INSTALL.md):

   ```powershell
   powershell -File install.ps1 -DryRun
   powershell -File install.ps1
   ```

2. **Adapter anlegen:** `.claude/epic.md` im Zielprojekt. Die Skripte lesen nur das Frontmatter;
   alle Schlüssel und Standards stehen in [`mission/references/adapter.md`](mission/references/adapter.md).
   Fehlt der Adapter, leitet der erste Lauf ab, was geht, fragt den Rest am Vorab-Tor und bietet an,
   die Datei abzulegen.

   ```yaml
   ---
   forge: github
   push_remote: origin
   main_branch: main
   ready_label: ready-for-agent
   epic_label: epic
   test_commands:
     unit: npm test
   lint_commands:
     web: npm run lint
   isolation: none-needed
   merge: mensch
   ---
   ```

   Erst `isolation: none-needed` (mit Begründung in der Prosa darunter) oder `test_isolation_env`
   lässt drei Pakete gleichzeitig laufen. Mit `merge: nach_gate` dockt der Treiber nach grüner
   Andockprüfung an; dafür braucht er `gate_command`.

   Labels im Repository: `ready-for-agent` (Freigabe), `epic` und für den Flotten-Treiber
   `prio/hoch` (Vorrang in der nächsten Belegung, Name über `prio_label` änderbar).

3. **Erster Lauf:** eine Mission mit `ready-for-agent` freigeben, in Claude Code im Projekt
   `/mission #<nr>` aufrufen, am Vorab-Tor antworten, am Ende den Pull Request prüfen und andocken.
   Danach `/mission-nacharbeit` und nach dem Andocken `/mission-aufraeumen`.
4. **Flotte fahren:** aus einem Terminal im Projektordner, nicht aus einer Sitzung (Bun nötig):

   ```powershell
   bun "$HOME\.claude\skills\flotte\src\cli.ts" fahren --konten 1,2 --bruecke http://127.0.0.1:4747
   ```

   Ohne `--epics` nimmt der Treiber alle freigegebenen Missionen. Das zweite Konto richtet
   [`arbeitspferd/einrichten.ps1`](arbeitspferd/README.md) ein, die Brücke startet mit
   `docker compose up -d` in [`flottenbruecke/`](flottenbruecke/README.md). Alle Schalter:
   [`flotte/SKILL.md`](flotte/SKILL.md).

## Die Teile

| Teil | Was es tut | Doku |
|---|---|---|
| `mission` | Eine Mission auf einem Missions-Branch umsetzen, endet mit offenem PR | [für Menschen](mission/README.md), [Skill](mission/SKILL.md), [Skripte](mission/scripts/README.md) |
| `mission-nacharbeit` | Offene Punkte eines Laufs in Fragerunden klären und erledigen | [für Menschen](mission-nacharbeit/README.md), [Skill](mission-nacharbeit/SKILL.md) |
| `mission-aufraeumen` | Nach dem Andocken Worktrees und Branches abräumen, nur nachweislich Angedocktes | [für Menschen](mission-aufraeumen/README.md), [Skill](mission-aufraeumen/SKILL.md) |
| `flotte` | Treiber: mehrere Läufe als `claude -p` auf mehreren Konten, Bremsen, Andock-Schlange, Logbuch | [für Menschen](flotte/README.md), [Skill](flotte/SKILL.md) |
| `flottenbruecke/` | Dauerdienst im LAN: fünf Bereiche über alle Einsätze, Antworten per PIN; steuert sonst nichts | [README](flottenbruecke/README.md), [Schnittstelle](flottenbruecke/SCHNITTSTELLE.md) |
| `bereitschaftsraum` | Gespräch in Fragerunden, aus dem eine Mission, ein Missionsziel oder nichts entsteht; angelegt wird über `flotte auftrag` | [Skill](bereitschaftsraum/SKILL.md) |
| `codebase-design` | Wortschatz für tiefe Module: Schnittstelle, Naht, Tiefe, Löschprobe | [Skill](codebase-design/SKILL.md) |
| `research` | Eine Frage aus Primärquellen beantworten, als Markdown-Datei mit Fundstellen festhalten | [Skill](research/SKILL.md) |
| `prototype` | Wegwerf-Prototyp für eine Entwurfsfrage; HTML-Prototypen liegen im `prototype_dir` (Holodeck) | [Skill](prototype/SKILL.md) |
| `tdd` | Test zuerst, je Abnahmepunkt eine Runde; Tests am Rand des Bausteins | [Skill](tdd/SKILL.md) |
| `diagnosing-bugs` | Fehler erst mit einer Probe eingrenzen, dann vermuten, messen, beheben | [Skill](diagnosing-bugs/SKILL.md) |
| `code-inspektion` | Änderung seit einem festen Punkt prüfen: Spec und Standards getrennt, Befunde als Muss, Sollte, Kann | [Skill](code-inspektion/SKILL.md) |
| `arbeitspferd/` | Weitere Konten einrichten | [README](arbeitspferd/README.md) |
| `agents/` | Agent-Typen der Modellstaffel (Kundschafter, Ingenieur, Erster Offizier) | [Staffel](mission/README.md#modelle-und-denkstufen) |
| `mail-antwort` | Anwender-Mail recherchieren, bei Bedarf umsetzen, Antwort entwerfen | [für Menschen](mail-antwort/README.md) |
| `persona-review` | Bedienung mit Persona-Agenten über Runden messen | [für Menschen](persona-review/README.md) |
| `assets/` | Bilder der Doku, je mit Quelle und Anleitung zum Neurendern | — |

## Begriffe

Kurz; die verbindliche Fachsprache steht in [`CONTEXT.md`](CONTEXT.md).

- **Mission:** das Zielissue eines Laufs, mit **Missionszielen** (Tickets) oder als **Spec** mit sieben
  festen Abschnitten, die der Lauf selbst in Pakete schneidet.
- **Paket** und **Paketklasse:** ein Stück Arbeit mit eigenem Branch und Worktree; die Klasse
  (*mechanisch*, *Standard*, *Urteil*) wählt Modell und Denkstufe. **Eskalation** wiederholt eine
  Runde eine Klasse höher.
- **Orchestrator:** die Sitzung, die `/mission` fährt; schneidet, prüft nach, dockt Pakete an den
  Missions-Branch an. **Kundschafter** lesen nur.
- **Vorab-Tor:** die eine Fragerunde zu Beginn eines Laufs.
- **Admiral:** das Sprachmodell, das Fragen der Läufe im Rahmen seines Entscheidungsrechts
  beantwortet, je Frageblock unter dem **Treiber** (`flotte`).
- **Adapter:** `.claude/epic.md` des Projekts; darf die Regeln der Skills verschärfen, nie lockern.
- **Andockblock:** die Ausgabe der Projekt-Andockprüfung in der PR-Beschreibung, mit Basis- und Head-SHA.
  **Nachweis der Andockprüfung:** der Treiber prüft im Log des Laufs, dass dieser Block aus einem echten
  Aufruf der Andockprüfung stammt.
- **Konto:** ein Claude-Konfigordner (`~/.claude`, `~/.claude-arbeitspferd`, …); eine Mission bleibt
  bei seinem Konto.

## Grenzen

- **Kein Lauf dockt an**, auch `gh pr merge` ist gesperrt. Wer andockt, sagt allein der Adapterschlüssel
  `merge`: Standard `mensch`; bei `nach_gate` genau ein Akteur (der Treiber, mit `merge.ps1`), nur mit gültigem
  Andockblock auf aktueller Basis und Head, grünen Checks und immer mit Andock-Commit. Der Admiral dockt nie an.
- **Kein Push auf Hauptzweig oder Basis**, nur auf das Remote des Adapters; das Hauptverzeichnis
  wird nie auf einen anderen Branch umgeschaltet. `guard.ps1` sperrt das als Hook.
- **Keine Datenmigration, keine gelöschten oder übersprungenen Tests**, nichts über die
  Abnahmeliste hinaus.
- **Bei dir liegt nur die Liste „Beim Menschen"** (`flotte/references/entscheidungsrecht.md`):
  was nach außen geht, echtes Geld, Produktivdaten und Zugänge ohne Beschluss, neue Kundentexte,
  eine unübliche neue Abhängigkeit oder ein ADR-Bruch. Keine Antwort lockert eine Regel.
- **Bremsen:** Ab der RAM-Schwelle startet kein neues Paket; der Treiber hält bei gelbem Limit
  Neues und bei rotem auch Fortsetzungen an.
- **Aufräumen löscht nur**, was nachweislich im Basiszweig liegt, nie mit `-D` oder `--force`.
- **Die Brücke steuert nichts:** kein Starten, Stoppen oder Andocken; nur im LAN, Antworten nur mit
  PIN.
- **Nichts nur im Chat:** Jede Entscheidung und jeder Abschluss steht als Kommentar in der Forge.

## Ändern

Wie Änderungen ins Repository und auf den Rechner kommen, steht in [`INSTALL.md`](INSTALL.md#ändern).

Die Leiter „kleinste vollständige Änderung" des Ingenieurs und die Befundform des Ersten Offiziers
stammen aus [Ponytail](https://github.com/DietrichGebert/ponytail) von Dietrich Gebert (MIT);
alle Quellen, Lizenzen und was übernommen wurde, stehen in [`QUELLEN.md`](QUELLEN.md). Das Plugin
`agentenflotte` wird unter [interias/agentenflotte](https://github.com/interias/agentenflotte)
gepflegt.
