<h1><img src="assets/icon.svg" width="48" height="48" alt="" align="top"> agent-skills</h1>

Claude-Code-Skills, mit denen Agenten freigegebene Missionen aus der Forge (Gitea oder GitHub)
umsetzen: vom Issue bis zum Pull Request, in parallelen Paketen, jedes geprüft. Ein Programm, der
Flotten-Treiber, führt mehrere solcher Läufe gleichzeitig auf einem oder mehreren Claude-Konten;
die Flottenbrücke zeigt, was dich braucht, und nimmt deine Antworten an. Angedockt wird nur so, wie
der Adapter des Projekts es erlaubt.

**Worum es geht:** mehr Durchsatz bei gleicher Qualität und weniger Rauschen für den Menschen. Läufe
arbeiten selbstständig bis zum Pull Request; der Admiral entscheidet alles, was nicht bei dir liegt, und
du siehst nur, was dich wirklich braucht. Tests werden gezielt geschnitten statt wiederholt, Modelle nach
Schwierigkeit gewählt, und jede Regel steht so, dass ein Mensch sie lesen und ein Test sie halten kann.

## Wie eine Mission läuft

Vom freigegebenen Issue über parallele Pakete bis zum Andocken; wer startet und wer andockt, sind zwei getrennte Fragen.

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/ablauf-schmal.png">
  <img src="assets/readme/ablauf.png" width="880" alt="Von der Mission zum Andocken, in drei Bändern. Start, Frage 1, wer startet den Lauf: Eine Mission oder eine Spec mit dem Label ready-for-agent startet entweder über den Treiber als Regelweg (flotte fahren, ein claude -p je Mission, verteilt auf Konto 1, 2 und 3) oder durch dich im Chat mit /mission #nr. Die Flottenbrücke zeigt den Stand und nimmt deine Antworten und Handlungen an; nur der Treiber spricht mit ihr, er meldet jeden Takt und holt ab. Lauf, /mission als Orchestrator: Das Vorab-Tor schneidet die Mission in Pakete und fragt einmal; bis zu drei Pakete laufen gleichzeitig in eigenen Worktrees; Review, Verifikation und Sofort-Andocken je Paket auf den Missions-Branch; am Ende ein Pull Request mit Andockblock, der Lauf dockt nie an. Andocken, Frage 2, wer andockt, allein der Adapterschlüssel merge: bei merge: mensch dockst du an; bei merge: nach_gate ein Akteur außerhalb des Laufs, die Andock-Schlange des Treibers mit merge.ps1, nur mit gültigem Nachweis der Andockprüfung. Danach /mission-aufraeumen. Die beiden Fragen hängen nicht zusammen.">
</picture>

Mehr, auch die Implementierungsschleife und der Zuschnitt der Tests: [`docs/ablauf.md`](docs/ablauf.md).

## Wenn ein Lauf fragt

Fragen gehen erst an den Admiral; nur was bei dir liegt, kommt auf die Brücke.

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/rueckfrage-schmal.png">
  <img src="assets/readme/rueckfrage.png" width="880" alt="Wenn ein Lauf fragt, in acht Schritten zwischen Lauf, Treiber, Admiral, Brücke und Mensch. 1: Der Lauf schickt dem Treiber FLOTTE-FRAGE, den Frageblock. 2: Der Treiber gibt den Frageblock dem Admiral, einem eigenen claude -p. 3: Der Admiral entscheidet, was bis zum Andocken umkehrbar ist, mit Grund und Marke. 4: Den Rest legt der Treiber als Fragekarte in „Braucht dich“ auf die Brücke. 5: Der Mensch antwortet dort mit einem Tipp auf die Empfehlung, mit einer Option oder mit Freitext, mit PIN. 6: Der Treiber holt die Antwort im nächsten Takt ab und quittiert sie. 7: Der Lauf macht mit den Antworten weiter. 8: Mit „Zurücknehmen“ geht bis zum Andocken eine neue Entscheidung über Brücke und Treiber an den Lauf. Jede Entscheidung steht danach als Kommentar am Issue; bis zum Andocken nimmst du jede in der Detailansicht der Mission zurück.">
</picture>

Mehr: [`docs/ablauf.md`](docs/ablauf.md#wenn-ein-lauf-fragt).

## Die Brücke

Ein Dienst im LAN, der zeigt, was dich braucht, und deine Antworten annimmt.

<picture>
  <source media="(max-width: 600px)" srcset="flottenbruecke/doku/v3-bruecke-390.png">
  <img src="flottenbruecke/doku/v3-bruecke-1440.png" alt="Flottenbrücke v3 mit den Beispieldaten. Oben das Logo, die Befehlszeile, der Zähler „Braucht dich 2“ und die fünf Bereiche als Pillen. Links die Schiffsliste mit den Läufen des Projekts und den Sitzungen. Rechts der Kopf mit Tanks je Konto, RAM und Platte, darunter die Ebene „Braucht dich“ mit Mission #40 blockiert (Neu einreihen, Log ansehen, Aufgeben) und Frage 1 von #39 mit den Optionen A bis C und dem Knopf „A nehmen · Empfehlung“. Darunter „Unterwegs“, unten das Logbuch als Laufband.">
</picture>

Alle Bereiche und Bilder: [README der Brücke](flottenbruecke/README.md).

## Wer entscheidet

Sechs Prüffragen trennen, was der Admiral entscheidet und was bei dir liegt; dieselben Fragen entscheiden, ob aus einem Punkt ein Ticket wird.

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/befugnisse-schmal.png">
  <img src="assets/readme/befugnisse.png" width="880" alt="Wer entscheidet, in drei Teilen. Erstens sechs Prüffragen, bei jedem Ja entscheidet der Mensch: 1 geht etwas nach außen, das sich nicht zurückholen lässt; 2 echtes Geld, das nicht freigegeben ist; 3 Produktivdaten ohne eindeutigen Beschluss; 4 Sicherheit oder Zugänge, die nicht abgestimmt und festgehalten sind; 5 ein Text oder Versprechen an Kunden, geprüft am PR; 6 ein Bruch mit einer Architekturentscheidung oder eine unübliche neue Abhängigkeit. Sechsmal nein: Der Admiral entscheidet selbst; eine Tatsache, die nur der Mensch kennt, hält nichts an. Zweitens, wird aus einem Punkt ein Ticket: braucht es den Menschen, eine der sechs Fragen oder eine Änderung am Ablauf des Projekts, dann needs-triage; klar und angemessen, dann in der Mission erledigen, zuerst Fehler; klar, aber zu groß, dann ein freigegebenes Issue; ein Wunsch ohne beobachteten Schaden wird verworfen. Drittens gilt immer: Admiral und Läufe docken nie an, keine Antwort lockert eine Regel, jede Entscheidung steht am Issue und ist bis zum Andocken widerrufbar.">
</picture>

Tabellen, Wortlaut, die Grenze „nur Software“ (Inhaltsziele bekommen `ready-for-human`) und wo die KI jede Regel prüft: [`docs/befugnisse.md`](docs/befugnisse.md).

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

## Loslegen

Installieren nach [`INSTALL.md`](INSTALL.md); Adapter, erster Lauf und Flotte in
[`docs/ablauf.md`](docs/ablauf.md#loslegen).

## Begriffe und Quellen

Die Fachsprache steht in [`CONTEXT.md`](CONTEXT.md), Entscheidungen in [`docs/adr/`](docs/adr/), Wissen
für Agenten in [`AGENTS.md`](AGENTS.md). Die Leiter „kleinste vollständige Änderung" des Ingenieurs und
die Befundform des Ersten Offiziers stammen aus [Ponytail](https://github.com/DietrichGebert/ponytail)
von Dietrich Gebert (MIT); alle Quellen in [`QUELLEN.md`](QUELLEN.md). Das Plugin `agentenflotte` wird
unter [interias/agentenflotte](https://github.com/interias/agentenflotte) gepflegt.
