# agent-skills

Claude-Code-Skills, mit denen Agenten freigegebene Epics aus der Forge (Gitea oder GitHub)
umsetzen: vom Issue bis zum Pull Request, in parallelen Paketen, jedes geprüft. Ein Programm, der
Flotten-Treiber, führt mehrere solcher Läufe gleichzeitig auf einem oder mehreren Claude-Konten;
die Flottenbrücke zeigt, was dich braucht, nimmt deine Antworten an und reicht Handlungen bei
Blockaden an den Treiber. Gemergt wird nur so, wie der Adapter des Projekts es erlaubt.

## Das Bild

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/ablauf-schmal.png">
  <img src="assets/readme/ablauf.png" width="880" alt="Vom Epic zum Merge, in drei Bändern. Start, Frage 1, wer startet den Lauf: Ein Epic oder eine Spec mit dem Label ready-for-agent startet entweder über den Treiber als Regelweg (flotte fahren, ein claude -p je Epic, verteilt auf Konto 1, 2 und 3) oder durch dich im Chat mit /epic #nr. Die Flottenbrücke zeigt den Stand und nimmt deine Antworten und Handlungen an; nur der Treiber spricht mit ihr, er meldet jeden Takt und holt ab. Lauf, /epic als Orchestrator: Das Vorab-Tor schneidet das Epic in Pakete und fragt einmal; bis zu drei Pakete laufen gleichzeitig in eigenen Worktrees; Review, Verifikation und Sofortmerge je Paket auf den Epic-Branch; am Ende ein Pull Request mit Gate-Block, der Lauf mergt nie. Merge, Frage 2, wer mergt, allein der Adapterschlüssel merge: bei merge: mensch mergst du; bei merge: nach_gate ein Akteur außerhalb des Laufs, die Merge-Schlange des Treibers oder merge.ps1 des Leitstands, nur mit gültigem Gate-Nachweis. Danach /epic-aufraeumen. Die beiden Fragen hängen nicht zusammen.">
</picture>

Die beiden Fragen hängen nicht zusammen: Ob der Treiber oder du im Chat einen Lauf startet, ändert
nichts daran, wer mergt. **Welchen Weg wann:** Der Treiber ist der Regelweg, auch für ein einzelnes
Epic; er verteilt Läufe auf Konten, bremst und legt dir nur die Fragen vor, die bei dir liegen.
Einen Lauf im Chat startest du, wenn du ein Epic interaktiv begleiten willst, etwa das Vorab-Tor
selbst beantworten oder zuschauen. `/epic-nacharbeit` gehört vor den Merge, solange der PR offen
ist (danach braucht sie einen eigenen PR); unter dem Treiber läuft sie von selbst.

Ein **Lauf** (`/epic`) liest das Epic, schneidet es in Pakete, fragt einmal am Vorab-Tor und setzt
dann bis zu drei Pakete gleichzeitig um, jedes in eigenem Worktree mit Implementer, Reviewer und
Nachprüfung. Er endet mit einem offenen Pull Request. Der **Treiber** startet viele Läufe, verteilt
sie auf Konten, bremst bei vollem Speicher oder Limit und mergt nur bei `merge: nach_gate`.
Was ein Lauf fragt, geht so weiter:

<picture>
  <source media="(max-width: 600px)" srcset="assets/readme/rueckfrage-schmal.png">
  <img src="assets/readme/rueckfrage.png" width="880" alt="Wenn ein Lauf fragt, in acht Schritten zwischen Lauf, Treiber, Admiral, Brücke und Mensch. 1: Der Lauf schickt dem Treiber FLOTTE-FRAGE, den Frageblock. 2: Der Treiber gibt den Frageblock dem Admiral, einem eigenen claude -p. 3: Der Admiral entscheidet, was bis zum Merge umkehrbar ist, mit Grund und Marke. 4: Den Rest legt der Treiber als Fragekarte in „Braucht dich“ auf die Brücke. 5: Der Mensch antwortet dort mit einem Tipp auf die Empfehlung, mit einer Option oder mit Freitext, mit PIN. 6: Der Treiber holt die Antwort im nächsten Takt ab und quittiert sie. 7: Der Lauf macht mit den Antworten weiter. 8: Mit „Zurücknehmen“ geht bis zum Merge eine neue Entscheidung über Brücke und Treiber an den Lauf. Jede Entscheidung steht danach als Kommentar am Issue.">
</picture>

Jede Entscheidung, ob vom Admiral oder von dir, steht danach als Kommentar am Issue.

Die Brücke ordnet alles danach, was du tun musst: **Braucht dich** (Fragen und blockierte Epics,
mit „Neu einreihen“ und „Aufgeben“), **Unterwegs** (Läufe mit Lebenszeichen, Kind-Tickets und
Merge-Schlange) und **Erledigt heute** (Gemergtes und die Entscheidungen des Admirals, die du
zurücknehmen kannst). Auf dem Handy ist nur die erste Ebene offen.

<picture>
  <source media="(max-width: 600px)" srcset="assets/flottenbruecke/board-v2-handy.png">
  <img src="assets/flottenbruecke/board-v2.png" alt="Flottenbrücke v2 mit den Beispieldaten. Oben je Konto ein Tank mit dem Rest im 5-Stunden- und im Wochenfenster samt Reset-Zeit, dazu RAM und Platte. Ebene „Braucht dich“ mit zwei Karten: Epic #40 blockiert (Grund, Knöpfe Neu einreihen, Log ansehen, Aufgeben) und Frage 1 von #39 (Frage als Überschrift, Lage, Marke „nach außen sichtbar · bleibt“, warum sie bei dir liegt, Optionen A bis C mit ihrer Folge, Knopf „A nehmen · Empfehlung“, Freitext). Ebene „Unterwegs“ mit zwei Läufen (läuft seit, Paketleiste „1 von 3 fertig“, Lebenszeichen) und zwei Pull Requests in der Merge-Schlange; darunter die Zeile Bereit mit einem prio-Epic. Ebene „Erledigt heute“ mit zwei Entscheidungen des Admirals samt „Zurücknehmen“ und einem Merge. Unten das Logbuch als Laufband.">
</picture>

## Schnellstart

1. **Installieren** (Windows, PowerShell), Einzelheiten in [`INSTALL.md`](INSTALL.md):

   ```powershell
   powershell -File install.ps1 -DryRun
   powershell -File install.ps1
   ```

2. **Adapter anlegen:** `.claude/epic.md` im Zielprojekt. Die Skripte lesen nur das Frontmatter;
   alle Schlüssel und Standards stehen in [`epic/references/adapter.md`](epic/references/adapter.md).
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
   lässt drei Pakete gleichzeitig laufen. Mit `merge: nach_gate` mergt der Treiber nach grünem
   Gate; dafür braucht er `gate_command`.

   Labels im Repository: `ready-for-agent` (Freigabe), `epic` und für den Flotten-Treiber
   `prio/hoch` (Vorrang in der nächsten Belegung, Name über `prio_label` änderbar).

3. **Erster Lauf:** ein Epic mit `ready-for-agent` freigeben, in Claude Code im Projekt
   `/epic #<nr>` aufrufen, am Vorab-Tor antworten, am Ende den Pull Request prüfen und mergen.
   Danach `/epic-nacharbeit` und nach dem Merge `/epic-aufraeumen`.
4. **Flotte fahren:** aus einem Terminal im Projektordner, nicht aus einer Sitzung (Bun nötig):

   ```powershell
   bun "$HOME\.claude\skills\flotte\src\cli.ts" fahren --konten 1,2 --bruecke http://127.0.0.1:4747
   ```

   Ohne `--epics` nimmt der Treiber alle freigegebenen Epics. Das zweite Konto richtet
   [`arbeitspferd/einrichten.ps1`](arbeitspferd/README.md) ein, die Brücke startet mit
   `docker compose up -d` in [`flottenbruecke/`](flottenbruecke/README.md). Alle Schalter:
   [`flotte/SKILL.md`](flotte/SKILL.md).

## Die Teile

| Teil | Was es tut | Doku |
|---|---|---|
| `epic` | Ein Epic auf einem Epic-Branch umsetzen, endet mit offenem PR | [für Menschen](epic/README.md), [Skill](epic/SKILL.md), [Skripte](epic/scripts/README.md) |
| `epic-nacharbeit` | Offene Punkte eines Laufs in Fragerunden klären und erledigen | [für Menschen](epic-nacharbeit/README.md), [Skill](epic-nacharbeit/SKILL.md) |
| `epic-aufraeumen` | Nach dem Merge Worktrees und Branches abräumen, nur nachweislich Gemergtes | [für Menschen](epic-aufraeumen/README.md), [Skill](epic-aufraeumen/SKILL.md) |
| `flotte` | Treiber: mehrere Läufe als `claude -p` auf mehreren Konten, Bremsen, Merge-Schlange, Logbuch | [für Menschen](flotte/README.md), [Skill](flotte/SKILL.md), [Umschalten](flotte/references/umschalten.md) |
| `flottenbruecke/` | Dauerdienst im LAN: Board aller Einsätze, Antworten per PIN; steuert sonst nichts | [README](flottenbruecke/README.md), [Schnittstelle](flottenbruecke/SCHNITTSTELLE.md) |
| `epic-flotte` | Dasselbe wie `flotte`, aber als Admiral-Chat | [für Menschen](epic-flotte/README.md), [Skill](epic-flotte/SKILL.md) |
| `epic-lagebesprechung` | Im laufenden Chat abholen, was bei dir liegt | [für Menschen](epic-lagebesprechung/README.md) |
| `arbeitspferd/` mit `leitstand` | Weitere Konten einrichten; aus der Hauptsitzung Aufträge an Konto 2 geben, überwachen, PRs nach `merge` mergen | [README](arbeitspferd/README.md), [Leitstand für Menschen](arbeitspferd/leitstand/README.md), [Skill](arbeitspferd/leitstand/SKILL.md) |
| `agents/` | Agent-Typen der Modellstaffel (Kundschafter, Implementer, Reviewer, Lauf) | [Staffel](epic/README.md#modelle-und-denkstufen) |
| `mail-antwort` | Anwender-Mail recherchieren, bei Bedarf umsetzen, Antwort entwerfen | [für Menschen](mail-antwort/README.md) |
| `persona-review` | Bedienung mit Persona-Agenten über Runden messen | [für Menschen](persona-review/README.md) |
| `mattpocock-skills/` | Einrichtung der vorgelagerten Skills (`grill-with-docs`, `to-spec`, `to-tickets` …) für Gitea | [README](mattpocock-skills/README.md) |
| `assets/` | Bilder der Doku, je mit Quelle und Anleitung zum Neurendern | — |

## Begriffe

Kurz; die verbindliche Fachsprache steht in [`CONTEXT.md`](CONTEXT.md).

- **Epic:** das Zielissue eines Laufs, mit **Kindern** (Tickets) oder als **Spec** mit sieben
  festen Abschnitten, die der Lauf selbst in Pakete schneidet.
- **Paket** und **Paketklasse:** ein Stück Arbeit mit eigenem Branch und Worktree; die Klasse
  (*mechanisch*, *Standard*, *Urteil*) wählt Modell und Denkstufe. **Eskalation** wiederholt eine
  Runde eine Klasse höher.
- **Orchestrator:** die Sitzung, die `/epic` fährt; schneidet, prüft nach, mergt Pakete in den
  Epic-Branch. **Kundschafter** lesen nur.
- **Vorab-Tor:** die eine Fragerunde zu Beginn eines Laufs.
- **Admiral:** das Sprachmodell, das Fragen der Läufe im Rahmen seines Entscheidungsrechts
  beantwortet, als Chat (`/epic-flotte`) oder je Frageblock unter dem **Treiber** (`flotte`).
- **Adapter:** `.claude/epic.md` des Projekts; darf die Regeln der Skills verschärfen, nie lockern.
- **Gate-Block:** die Ausgabe des Projekt-Gates in der PR-Beschreibung, mit Basis- und Head-SHA.
  **Gate-Nachweis:** der Treiber prüft im Log des Laufs, dass dieser Block aus einem echten
  Gate-Aufruf stammt.
- **Konto:** ein Claude-Konfigordner (`~/.claude`, `~/.claude-arbeitspferd`, …); ein Epic bleibt
  bei seinem Konto.

## Grenzen

- **Kein Lauf mergt**, auch `gh pr merge` ist gesperrt. Wer mergt, sagt allein der Adapterschlüssel
  `merge`: Standard `mensch`; bei `nach_gate` genau ein Akteur (Treiber oder `merge.ps1` des
  Leitstands), nur mit gültigem Gate-Block auf aktueller Basis und Head, grünen Checks und immer
  mit Merge-Commit. Der Admiral mergt nie.
- **Kein Push auf Hauptzweig oder Basis**, nur auf das Remote des Adapters; das Hauptverzeichnis
  wird nie auf einen anderen Branch umgeschaltet. `guard.ps1` sperrt das als Hook.
- **Keine Datenmigration, keine gelöschten oder übersprungenen Tests**, nichts über die
  Abnahmeliste hinaus.
- **Was sich nach dem Merge nicht widerrufen lässt, liegt bei dir:** Produktivdaten, Zugriffe,
  Freigaben aus `gate_approvals`, gelockerte Regeln, gelöschte Remote-Branches.
- **Bremsen:** Ab der RAM-Schwelle startet kein neues Paket; der Treiber hält bei gelbem Limit
  Neues und bei rotem auch Fortsetzungen an.
- **Aufräumen löscht nur**, was nachweislich im Basiszweig liegt, nie mit `-D` oder `--force`.
- **Die Brücke steuert nichts:** kein Starten, Stoppen oder Mergen; nur im LAN, Antworten nur mit
  PIN.
- **Nichts nur im Chat:** Jede Entscheidung und jeder Abschluss steht als Kommentar in der Forge.

## Ändern

Änderungen nur über Branch und Pull Request, nie direkt in `~/.claude/skills`. Wirksam werden sie
nach `install.ps1` in einer neuen Sitzung.

Die Leiter „kleinste vollständige Änderung" der Implementer und die Befundform der Reviewer
stammen aus [Ponytail](https://github.com/DietrichGebert/ponytail) von Dietrich Gebert (MIT), die
vorgelagerten Skills aus dem Plugin `mattpocock-skills`. Das Plugin `agentenflotte` wird unter
[interias/agentenflotte](https://github.com/interias/agentenflotte) gepflegt.
