# agent-skills

Die versionierte Quelle unserer Claude-Code-Skills: Agenten setzen damit freigegebene Epics aus
Gitea um, von der Freigabe bis zum Pull Request. Einrichten: [`INSTALL.md`](INSTALL.md).
Begriffe: [`CONTEXT.md`](CONTEXT.md).

## Der Ablauf

![Schienenplan: grill-with-docs klärt Plan und Fachsprache; to-spec oder to-tickets schneiden daraus ein Epic; du gibst es mit ready-for-agent frei, beantwortest am Vorab-Tor einmal alle Fragen und mergst am Ende den Pull Request; dazwischen setzt /epic die Pakete um; danach schließen /epic-nacharbeit und /epic-aufraeumen ab. Darunter die Spuren in Gitea und KIBO: Labels, Statuslabels, Kommentare, Lauftafel, erledigte Tickets.](assets/prozess/prozess.png)

Die orangen Halte sind die Stellen, an denen du entscheidest. Dazwischen läuft alles ohne
Rückfrage; den Stand zeigen Gitea und KIBO.

## Die Skills

| Skill | Wofür |
|---|---|
| `epic` | Ein Epic (Kind-Tickets oder Spec) auf einem Epic-Branch umsetzen, endet mit offenem PR |
| `epic-nacharbeit` | Die offenen Punkte eines abgeschlossenen Laufs in Fragerunden klären und erledigen |
| `epic-aufraeumen` | Nach dem Merge Worktrees und Branches abräumen, nur was nachweislich gemergt ist |
| `epic-flotte` | Optional: mehrere Epics gleichzeitig, geführt von einem Admiral |
| `epic-lagebesprechung` | Optional: im laufenden Chat alles abholen, was bei dir liegt |
| `mail-antwort` | Eine Anwender-Mail recherchieren, bei Bedarf umsetzen, Antwort entwerfen |

Alle Epic-Skills lesen im Zielprojekt die Adapterdatei `.claude/epic.md`
([Vertrag](epic/references/adapter.md)) und fragen mit Antwortmöglichkeiten und Empfehlung. Bis
Oktober 2026 hießen sie `prd…`; alte Adapter werden weiter gelesen.

## `/epic` — ein Lauf

![Paketbild: /epic liest, schneidet Pakete und fragt einmal am Vorab-Tor. Höchstens drei Pakete laufen gleichzeitig, je Implementer, Reviewer und Prüfung durch den Orchestrator; jedes abgenommene Paket geht sofort in den Epic-Branch, ein frei werdender Platz wird sofort neu belegt. Eine Eskalation wiederholt die Runde eine Paketklasse höher, ein zurückgelassenes Paket blockiert nur seine Nachfolger. Darunter die Modellstaffel je Paketklasse.](assets/epic/epic.png)

Opus macht nicht alles: Die Paketklasse wählt Modell und Denkstufe, Opus hoch gibt es nur nach
einer Eskalation. Am Ende stehen je Ticket Fundstellen, Verifikation und offene Punkte in Gitea.

Den Stand zeigt die **Lauftafel** im Browser — hier mit den Musterdaten der Vorlage:

![Lauftafel mit Musterdaten: Kennzahlen links, der Fortschritt der Pakete als Leiste, darunter der Stand jedes Pakets mit Modul, Zustand, Runden und Merge, die Belegung der drei Plätze als Zeitleiste und unten die offenen Punkte, die bei dir liegen.](assets/epic/lauftafel.png)

## `/epic-flotte` — mehrere Epics gleichzeitig

![Flottenbild: /epic-flotte, der Admiral mit Zufallsnamen, startet drei /epic-Läufe A bis C nebeneinander; ein vierter wartet, bis ein Platz frei wird. Jeder Lauf fragt am Vorab-Tor den Admiral, endet mit offenem Pull Request, durchläuft /epic-nacharbeit, wartet auf deinen Merge und endet mit /epic-aufraeumen. Darunter die Kollisionsstufen (keine 4, klein 3–4, mittel 2, groß 1 gleichzeitig) und das Entscheidungsrecht des Admirals (selbst, mit Präzedenz, immer du).](assets/flotte/flotte.png)

- Läufe sind Subagenten; ihre Fragen beantwortet der Admiral, soweit sein Entscheidungsrecht
  reicht, jede Entscheidung mit Herkunft in Gitea. Was bis zum Merge umkehrbar ist, entscheidet er
  **vorläufig** — du bestätigst oder kippst, bis dahin trägt der PR `WIP:`.
- Eine **Verbrauchsbremse** liest 5-Stunden- und Wochenlimit: bei Gelb nichts Neues, bei Rot Pause
  bis zum Reset. Den Stand schreibt der Admiral ins Issue `Flottenlogbuch`, das KIBO anzeigt.

Die **Flottentafel** zeigt dir im Browser, wo jeder Lauf steht und was bei dir liegt — hier mit
den Musterdaten der Vorlage:

![Flottentafel mit Musterdaten: Kennzahlen links, oben die Läufe als Schiffe in Formation hinter dem Admiral, darunter die Verbrauchsbremse, der Stand der Läufe mit Zustand und Paketen, rechts was beim Menschen liegt, unten die Belegung der drei Plätze als Zeitleiste.](assets/flotte/flottentafel.png)

## `/epic-lagebesprechung` — wenn du Zeit hast

![Lagebesprechung: Im Chat des Admirals oder Orchestrators staut sich, was nur du entscheidest. Der optionale Einschub sammelt in Rangfolge wartende Fragen, vorläufige Entscheidungen, Triage-Tickets und eigene Entscheidungen, klärt sie in Fragerunden mit Empfehlung, gibt Antworten sofort an die Läufe und schreibt danach die Tickets fort, bis sie ready-for-agent sind. Dann läuft der Chat weiter wie vorher.](assets/lagebesprechung/lagebesprechung.png)

Ein Einschub, kein eigener Lauf: Aufgerufen im Chat des Admirals oder Orchestrators, ändert sie
deren Ablauf nicht.

## `mail-antwort` — Anwender-Mail beantworten

![Mailbild: Die .eml wird zerlegt, eingeordnet und recherchiert; am Halt wählst du den Weg — B Spec-Issue und /epic bis zum PR, C Kommentar am vorhandenen Issue, A nur Antwort, D Issue mit needs-triage. Danach markierte Ist- und Soll-Bilder und ein Antwortentwurf neben der Mail; abschicken nur du. Darunter die Arten der Mail und ihr Weg.](assets/mail-antwort/mail-antwort.png)

## Plugin `agentenflotte`

![Brückenbild: links die Desktop-App mit farbigen Stationsetiketten vor den Werkzeugzeilen, Brücken-Spinner, einer Freigabe unter Alarmstufe Gelb, der Zeile Unter Warp und in der Fußleiste Alarm-Etikett und Statuszeile mit Sternzeit, Warp, Schilden und Flotte; rechts das taktische Display als Radar mit der Hauptsitzung in der Mitte und den Subagenten als Kontakte. Darunter Alarmstufen und Warpfaktoren.](assets/agentenflotte/agentenflotte.png)

Ein Mod, der die Sitzung zur Schiffsbrücke macht: Subagenten sind Schiffe, Warpfaktor ist die
Denkstufe, Alarmstufen zeigen, was auf dich wartet (Gelb Freigabe, Rot Fehler, Blau Kontext knapp).
Dazu Statuszeile, `/logbuch`, `/taktik` (Radar der Flotte) und ein optionaler Bordcomputer.
`/flotte` schaltet den Mod, `/flotte status` zeigt die Teile. Übernommen aus
[interias/agentenflotte](https://github.com/interias/agentenflotte).

## Aufbau

```
epic/ epic-nacharbeit/ epic-aufraeumen/   die Epic-Skills (epic/references: Adapter, Forge, Tafeln)
epic-flotte/ epic-lagebesprechung/        optional: Flotte und Lagebesprechung
mail-antwort/                             Skill mit Python-Skripten
agents/                                   Agent-Typen der Modellstaffel
agentenflotte/  .claude-plugin/           Plugin und Marketplace breuckmann-agent-skills
mattpocock-skills/                        Einrichtung der vorgelagerten Skills für Gitea
assets/                                   Bilder dieses README, je mit HTML-Quelle
install.ps1  INSTALL.md
```

Änderungen nur über Branch und Pull Request, nie direkt in `~/.claude/skills`.
