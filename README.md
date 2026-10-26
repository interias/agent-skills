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

Vorgelagert sind die Skills aus dem Plugin `mattpocock-skills` (`grill-with-docs`, `grilling`,
`to-spec`, `to-tickets` …). Sie werden nicht hierher kopiert; [`mattpocock-skills/`](mattpocock-skills/README.md)
legt fest, wie sie für Gitea eingerichtet werden.

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

## Die Agent-Typen

Unter `agents/` liegt die Modellstaffel; `/epic` und `/epic-flotte` wählen den Typ nach Paketklasse
und Rolle.

| Agent-Typ | Modell, Denkstufe | Rolle |
|---|---|---|
| `epic-implementer-mechanisch` | Sonnet, niedrig | Implementer, Klasse mechanisch |
| `epic-implementer-standard` | Sonnet, mittel | Implementer, Klasse Standard |
| `epic-implementer-urteil` | Opus, mittel | Implementer, Klasse Urteil; erste Eskalation von Standard |
| `epic-implementer-urteil-hoch` | Opus, hoch | Implementer nach einer Eskalation, letzte Stufe |
| `epic-reviewer-standard` | Sonnet, hoch | Reviewer, Klassen mechanisch und Standard |
| `epic-reviewer-urteil` | Opus, mittel | Reviewer, Klasse Urteil |
| `epic-kundschafter` | Haiku, niedrig | liest und liefert Fundstellen, ändert nichts |
| `epic-lauf` | Opus, mittel | ein Lauf unter `/epic-flotte`, fragt den Admiral statt dich |

## Die Skripte

Unter `epic/scripts/`, jedes mit Pester-Tests daneben und Hilfe im Kopfkommentar
(`Get-Help <skript> -Detailed`):

- **`worktree.ps1`** rüstet und räumt die Worktrees der Pakete nach dem Adapter: `Up` legt
  Worktree, Env-Dateien, Links der Abhängigkeitsordner und Lock an, `Down` stoppt, was zum Worktree
  gehört, und entfernt ihn, `CleanupStale` räumt zu Beginn von `/epic` und `/epic-aufraeumen` ab,
  was tote Sitzungen hinterlassen haben.
- **`guard.ps1`** ist der PreToolUse-Hook, den `epic`, `epic-aufraeumen` und `epic-kundschafter`
  in ihrem Frontmatter einhängen. Er sperrt je Profil (`epic`, `aufraeumen`, `kundschafter`)
  verbotene Shell-Befehle, etwa Pushes auf den Hauptbranch oder `git branch -D`.
- **`ram.ps1`** misst den freien Speicher des Windows-Hosts und gibt `ok`, `warn` oder `hold`
  aus — die RAM-Bremse vor jedem Paketstart (`/epic`) und jeder Welle (`/epic-flotte`).

## Experimente

`experimente/` wird von `install.ps1` nicht installiert:

- **`epic-schlank/`** — eine gekürzte Fassung von `epic` mit eigenen Agent-Typen und Skripten,
  gestrichen nach [`STREICHLISTE.md`](experimente/epic-schlank/STREICHLISTE.md).
- **`scripts/spiegel.ps1`** spiegelt den Ausgangsstand eines Laufs in private Gitea-Repos
  (`exp-…`), damit zwei Skills dieselbe Aufgabe bearbeiten können; **`scripts/blind.ps1`** legt
  die Diffs zweier Branches für einen blinden Vergleich ab.
- [`STARTPROMPTS.md`](experimente/STARTPROMPTS.md) legt fest, wie beide Läufe gestartet werden.

Das Plugin `agentenflotte` liegt nicht mehr in diesem Repository; es wird unter
[interias/agentenflotte](https://github.com/interias/agentenflotte) gepflegt.

## Aufbau

```
epic/ epic-nacharbeit/ epic-aufraeumen/   die Epic-Skills (epic/references: Adapter, Forge, Tafeln;
                                          epic/scripts: worktree, guard, ram)
epic-flotte/ epic-lagebesprechung/        optional: Flotte und Lagebesprechung
mail-antwort/                             Skill mit Python-Skripten
agents/                                   Agent-Typen der Modellstaffel
mattpocock-skills/                        Einrichtung der vorgelagerten Skills für Gitea
experimente/                              nicht installiert: epic-schlank, spiegel, blind
assets/                                   Bilder dieses README, je mit HTML-Quelle; avatar/ mit Python
.claude/epic.md                           Adapter dieses Repositorys
install.ps1  INSTALL.md  CONTEXT.md
```

Änderungen nur über Branch und Pull Request, nie direkt in `~/.claude/skills`.
