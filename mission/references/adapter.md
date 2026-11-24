# Der Projektadapter

Alles Projektspezifische steht in `.claude/epic.md` des Zielrepositorys. Diese Datei legt fest,
**welche Schlüssel es gibt, was sie bedeuten und was gilt, wenn einer fehlt**. Sie ist der Vertrag
zwischen `SKILL.md`, den Referenzen und `mission-nacharbeit` / `mission-aufraeumen`: Ein Name, der hier
nicht steht, ist kein Adapterschlüssel.

## Form

**YAML-Frontmatter ist Pflichtform** für jeden maschinenlesbaren Schlüssel (#38): ein Block
zwischen zwei `---`-Zeilen am Anfang von `.claude/epic.md`. `scripts/worktree.ps1` (`Up`, `Down`,
`CleanupStale`) liest nur dort — während der Umstellung aus der Datei, die `-AdapterFile` nennt
(`references/worktree.md`, „Umstellung") — und endet ohne Frontmatter mit Exit 1; `scripts/ram.ps1` liest dort
nur die RAM-Schlüssel und nimmt ohne Frontmatter die Standards.
Gelesen werden flache Einträge — `key: value`, `key: [a, b]` oder eine Liste mit `- item`;
verschachtelte Maps wie `test_commands` überspringen die Skripte, sie brauchen sie nicht.
Unbekannte Schlüssel lassen sie durch. Die **Prosa** darunter bleibt für Begründungen und
Projektregeln.

Ein älterer Adapter mit Tabellen in Prosa (spill) wird vom Lauf noch gelesen: Maßgeblich ist die
**Bedeutung** des Eintrags, eine Tabellenzeile `Epic-Label | type/epic` ist dasselbe wie
`epic_label: type/epic`, und der Lauf legt seine Lesart im Plan offen, statt still zu raten. Die
Skripte lesen ihn nicht. Deshalb legt das Vorab-Tor dem Menschen eine aus der Prosa abgeleitete
Frontmatter-Fassung vor (`SKILL.md`, Phase 2c, Punkt 13) — für dieses Repository, keine
Sammelaktion über andere.

Der Fließtext des Adapters sind **Projektregeln**, zum Beispiel Doku-Pflicht, Migrationsverbote
oder Fachsprache. Sie gelten wie Regeln des Skills. Der Adapter darf den Skill **verschärfen, nie
lockern**. Ein Eintrag, der eine Regel des Skills aufheben würde, ist ein Punkt für das Vorab-Tor.
So kann ein Projekt auch Regel 14 („nur Software“, `SKILL.md`) schärfen, etwa mit Beispielen, was
dort als Inhalt gilt.

Ein Abschnitt **`## Entscheidungsregeln`** im Fließtext legt fest, wie der Admiral
der Flotte wiederkehrende Fragen in diesem Projekt entscheidet: je Regel ein Satz, mit Datum
und Anlass (meist ein Widerruf). Sie binden den Admiral und gehen der Empfehlung des Skills vor
(`flotte/references/entscheidungsrecht.md`, „Entscheidungsrecht"). Was dort beim Menschen liegt, können sie ihm nicht
übertragen. Fehlt der Abschnitt, gilt die Rangfolge des Skills.

## Fehlt der Adapter

Ableiten, was ableitbar ist: Forge aus `git remote get-url origin`, Testbefehle aus
`package.json` bzw. `pyproject.toml`, Commit-Stil aus `git log`. Die Ableitung wird im Plan
offengelegt, und der Lauf fragt nach dem Rest am Vorab-Tor, statt zu raten. Danach bietet er an,
das Ergebnis als `.claude/epic.md` abzulegen, mit Frontmatter.

**Alte Adapter bleiben lesbar.** Jeder Schlüssel unten hat einen Standardwert, und ein Adapter
aus der Zeit vor dieser Fassung wird vom Lauf ohne Änderung gelesen; die Skripte brauchen sein
Frontmatter (Abschnitt „Form").

**Alter Name.** Bis zur Umbenennung hieß die Datei `.claude/prd.md` und der Modus `tickets` hieß
`prd`. Fehlt `.claude/epic.md`, liest der Lauf `.claude/prd.md`; `issue_form: prd` gilt als
`tickets`. Beides nennt das Vorab-Tor als Hinweis „Adapter umbenennen“ — ein Hinweis, kein Halt.

## Vorlage

Ein neuer Adapter beginnt mit diesem Block; `flotte projekt hinzufuegen` legt ihn wortgleich an, wenn
`.claude/epic.md` fehlt, und meldet die Schlüssel, deren Wert (oder Eintrag) noch in `<…>` steht. Die
übrigen Werte sind die Standards unten; was fehlt, gilt wie in „Schlüssel“ beschrieben.

```markdown
---
forge: <github oder gitea>
api: <API-Basis des Repositorys, etwa https://api.github.com/repos/owner/name>
push_remote: origin
issue_form: tickets
main_branch: main
base_branch: main
merge: mensch
gate_command: <PowerShell-Befehl der ganzen Andockprüfung, etwa pwsh -NoProfile -File ./gate.ps1>
ready_label: ready-for-agent
skip_labels: [needs-triage, needs-info, wontfix]
epic_label: epic
glossary: CONTEXT.md
test_commands:
  <suite>: <Befehl je Paket, ohne vollen Stack>
commit_style: <conventional-with-scope oder conventional>
commit_language: <de oder en>
plan_artifact: publish
---

# Projektadapter für `/mission`

## Zugang

<Wo der Zugang zur Forge liegt; nie ein Token im Repository.>

## Was hier anders ist

<Projektregeln, die die Skills verschärfen.>
```

## Schlüssel

### Forge

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `forge` | `gitea`, `github`, `gitlab` | aus `origin` |
| `api` | API-Basis des Repositorys | aus `origin` |
| `token_env` / `token_file` | Variable und gitignorierte Datei mit dem Token. Alternativ Basic Auth über `git credential fill` (spill) | `GITEA_TOKEN`, keine Datei |
| `push_remote` | das einzige Remote, auf das gepusht wird | `origin` |
| `forbidden_remotes` | Remotes, auf die nie gepusht wird | keine |
| `issue_offset` | externe Nummer `n` (etwa `PRD 41`) ist Issue `#(offset+n)` | keine Umrechnung |

### Issues

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `issue_form` | `tickets` (Mission mit Missionsziele) oder `spec` (ein Issue mit sieben Abschnitten, der Orchestrator zerlegt) | **aus der Form abgeleitet**: hat das Issue Missionsziele → `tickets`; sieben Abschnitte ohne Missionsziele → `spec`; sonst Vorab-Tor |
| `ready_label` | Freigabelabel: nur Tickets damit werden bearbeitet | `ready-for-agent` |
| `prognose_ab` | Flotten-Treiber: so viele gemessene Missionen, bevor die Brücke eine Prognose zeigt | `5` |
| `prio_label` | Vorrang unter dem Flotten-Treiber: eine startbereite Mission mit diesem Label (an der Mission oder an einem Missionsziel) kommt in die nächste Belegung; harte Kanten und Kollisionsstufen gelten weiter | `prio/hoch` |
| `prototype_dir` | Holodeck der Flottenbrücke: Ordner der Prototypen, relativ zur Repo-Wurzel. Der Flotten-Treiber schickt jede HTML-Datei direkt darin an die Brücke (keine Unterordner, keine Verknüpfungen, höchstens 50 zu je 2 MB); ein Wert mit `..` oder ein absoluter liest nichts | `prototypen/` |
| `skip_labels` | Tickets damit werden übersprungen (mit Kommentar) | `needs-triage`, `needs-info`, `wontfix` |
| `epic_label` | kennzeichnet Missionen. Eine Kante zwischen zwei Missionen heißt **Reihenfolge**, eine Kante von einer Mission zu einem Nicht-Missions-Issue heißt **Missionsziel**. Der Lauf setzt es an ein Zielissue mit Missionszielen | `epic` |
| `dependency_source` | `api` (Gitea-Abhängigkeiten), `header` (Kopfzeile `> **Reihenfolge:** …`), `body` (Abschnitt `## Blocked by`). Mehrfachnennung erlaubt | `api` |
| `write_back_dependencies` | Kanten, die aus `header` oder `body` gelesen wurden, trägt der Lauf in die Gitea-Abhängigkeiten nach | `true` für Kanten aus `header`; für Kanten aus `body` nur, wenn der Adapter es setzt, sonst ein Tor-Punkt |
| `transitive` | hängen alle Missionsziele an Tickets einer anderen offenen Spec, werden diese im selben Lauf mitbearbeitet | `false` |
| `acceptance_section` | Abschnitt mit der Abnahmeliste. Fehlt er an einem Missionsziel, wird es übersprungen und kommentiert | `tickets`: der erste vorhandene von `## Abnahmekriterien`, `## Akzeptanzkriterien`, `## Acceptance criteria`; `spec`: `## User Stories` |
| `verification_section` | Abschnitt mit dem Verifikationsweg. Fehlt er an einem Missionsziel, wird es nicht bearbeitet | `tickets`: `## Verifikationsweg`; `spec`: `## Testing Decisions` |
| `modules_section` | Abschnitt mit den berührten Modulen. Das Wort `Exklusiv` darin heißt: läuft allein | `## Betroffene Module` |
| `base_branch` | Basis des Missions-Branches und Ziel des Pull Requests. `from-issue` = aus Kopfzeile oder Further Notes, sonst aus `git log --merges` | der Hauptzweig |
| `main_branch` | **Hauptzweig** des Repositorys: nie Ziel eines Andockens durch den Lauf (alter Name, KOKOS) | `git symbolic-ref refs/remotes/<push_remote>/HEAD`, ersatzweise `main` |

### Wissen des Projekts

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `glossary` | Vokabulardatei | `CONTEXT.md` |
| `glossary_forbidden_marker` | Marker der Verbotsliste | `_Avoid_` |
| `adr_dir` | Entscheidungen | `docs/adr` |
| `read_all_adrs` | alle ADRs lesen, nicht nur die im Issue genannten | `false` |
| `must_read` | Dateien, die jeder Lauf ganz liest | `AGENTS.md`, falls vorhanden |
| `out_of_scope_dir` | dokumentiert Verworfenes | keiner |

### Tests und Parallelität

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `test_commands` | Befehle je Suite: die Prüfungen **je Paket, ohne vollen Stack**. Der volle Stack läuft einmal in `acceptance_commands`. Eine Worker-Grenze steht als **feste Zahl**, nicht als Anteil der Kerne: Bis zu `window` Ingenieure und der Orchestrator fahren gleichzeitig, und `--maxWorkers=30%` sind auf 20 Kernen sechs Worker mit rund 4 GB je Lauf (BRIQNET client, gemessen 12.11.2026) | aus `package.json` / `pyproject.toml` |
| `known_red` | Tests, die auf der Basis bekannt rot sind, mit Namen | keine |
| `lint_commands` | Lint-Befehl je Modul; gezählt werden Fehler und Warnungen aus der Ausgabe, nicht der Exit-Code | keine — dann entfällt der Lint-Vergleich, und der Plan sagt das |
| `writers` | Pfade der Schreiber ohne Oberfläche (Migration, Import, Jobs), die der Erste Offizier bei jeder neuen Schreibsperre prüft | keine |
| `test_isolation_env` | Variable, die jedem Worktree ein eigenes Testbett gibt; `Up` setzt sie auf die Paketnummer. Auf einem geteilten Dienst (`shared_services`) heißt das **eine Datenbank oder ein Schema je Paket**, das das Projekt aus der Variable ableitet (etwa `app_test_<nr>`) | keine |
| `isolation` | `none-needed` mit **Begründung**, wenn parallele Läufe sich nachweislich nichts teilen | nicht gesetzt |
| `window` | Zahl der gleichzeitigen Plätze, höchstens 3 | **1**, außer `test_isolation_env` oder `isolation: none-needed` ist gesetzt, dann 3 |
| `max_rounds` | Ingenieur-Runden je Paket, bevor es zurückbleibt | `3` |
| `code_graph` | `off` schaltet den Code-Graphen ab (`SKILL.md`, Phase 0b; `scripts/graph.ps1`) — etwa für ein Repository, das zu klein ist oder dessen Sprache Graphify nicht liest | an, sobald `graphify` installiert ist |
| `min_package_class` | Untergrenze der Paketklasse: `mechanisch`, `standard` oder `urteil`. Hebt nur an; ein Paket, das der Lauf höher einstuft, bleibt höher | keine Untergrenze |
| `exclusive_paths` | Pfade, deren Änderung ein Paket exklusiv macht | Lockfiles, Abhängigkeitslisten, Migrationen |
| `always_collide` | Dateien, die fast jedes Paket berührt (Patch-Notes, Versionsnummer). Zwei Pakete damit laufen nie gleichzeitig | keine |
| `pre_commit_checks` | Prüfungen vor jedem Commit, etwa `core.hooksPath` gesetzt und Patch-Notes-Check | keine |

### Worktrees

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `worktree_root` | Ablage der Worktrees, **ohne Punktverzeichnis im Pfad** | `../<repo>-worktrees` |
| `env_files` | gitignorierte Dateien, die jeder Worktree braucht. Sie werden **kopiert**, nie verlinkt | keine |
| `link_dirs` | Abhängigkeitsverzeichnisse, die als Junction verlinkt statt installiert werden. `Up` verlinkt **alle** in jeden Worktree, ohne Unterscheidung nach Paket. Ein Paket, das das Lockfile ändert, braucht eine echte Installation und ist per `Up` nicht rüstbar (`SKILL.md`, Phase 3) | keine |
| `always_link` | Verzeichnisse, die jedes Paket braucht. `Up` behandelt sie wie `link_dirs` | keine |
| `port_env` | Variable für den Port eines Worktree-Servers; `Up` setzt einen freien Port | keine |

### Infrastruktur und Verifikation (#38)

Welche Dienste geteilt laufen und was ein Worktree starten darf, ist nicht ableitbares
Projektwissen: Fehlt es, erfindet jeder Agent seine eigene Lösung (ARGUS: dort startet jede Mission
eine eigene MariaDB). Die Schlüssel sind **Vertrag für den Orchestrator**; `Up` wertet sie nicht
aus. Sie stehen im Frontmatter (Abschnitt „Form").

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `shared_services` | Dienste, die im Projekt **einmal und geteilt** laufen, je Eintrag Name und Ort, etwa `MariaDB auf 3307`. Worktrees verbinden sich damit und starten sie nicht | keine |
| `service_start` | wie die geteilten Dienste gestartet werden: Befehl und Ort (etwa „in WSL"). Das tut der Orchestrator, nie ein Paket | keiner — fehlt er bei gesetzten `shared_services`, ist das ein Tor-Punkt |
| `worktree_may_start` | was ein Worktree selbst starten darf: `dev_server` (Entwicklungsserver auf dem `port_env` des Pakets), `compose` (ein Compose-Projekt des Pakets), `db_server` (ein eigener Datenbankserver) | `[dev_server]` — **keine eigenen DB-Server**, kein eigener Compose-Stack. Ein Paket, das mehr braucht, ist ein Tor-Punkt |
| `acceptance_commands` | Prüfungen **mit vollem Stack** (Sichtprüfung, E2E), die der Orchestrator **einmal** vor dem Pull Request fährt, im Missions-Worktree und im Slot (`SKILL.md`, „Gestufte Verifikation und der Slot") | keine — dann entfällt die Abnahmestufe, und der Plan sagt das |
| `ram_warn_percent` | ab dieser Belegung des Windows-Speichers ist die RAM-Bremse (`SKILL.md`, „Die RAM-Bremse") auf `warn` | `75` |
| `ram_hold_percent` | ab dieser Belegung auf `hold` | `85` |
| `ram_min_free_gb` | Boden: bei weniger freiem Speicher ist die Bremse mindestens `warn` | `4` |

Die Isolation läuft über `test_isolation_env` (Tabelle „Tests und Parallelität"). Die RAM-Werte
gelten, wenn `0 < ram_warn_percent < ram_hold_percent <= 100`, `ram_min_free_gb >= 0` und alle
endlich sind; eine Nicht-Zahl oder ein Verstoß beendet `scripts/ram.ps1` mit Exit 1. Ein fehlender
Schlüssel ist kein Fehler. Vorrang: Parameter vor Adapter vor Standard.

### Commits, Tafel, Tor

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `commit_style` | Conventional Commits mit Scope oder ohne | aus `git log` |
| `commit_language` | `de` / `en` | aus `git log` |
| `commit_umlauts` | `keep` / `transliterate` | aus `git log` |
| `plan_artifact` | `publish` (Lauftafel als Artifact veröffentlicht) oder `file` (Lauftafel nur als Datei, Pfad im Eröffnungskommentar) | `publish` |
| `gate_approvals` | zusätzliche Punkte fürs Vorab-Tor, etwa bezahlte Läufe oder Blindsatz | keine |
| `no_access` | Systeme, auf die ein Lauf keinen Zugriff hat. Ein Paket, das sie braucht, ist ein Tor-Punkt | keine |
| `lern_issue` | Nummer des Sammel-Issues „Lernvorschläge“. Nach jedem angedockten Missions-PR schreibt die Lernschleife (`flotte lernen`, billiges Modell) dort höchstens drei Vorschläge mit Beleg als einen Kommentar; umgesetzt wird nichts davon von selbst; jeden Vorschlag entscheidet `flotte triage` wie eine Sternzeit-Notiz (`flotte/README.md`, „Triage“). Eine übernommene Regel trägt die Herkunft `Lernschleife L<n>, <Datum>` | keines: keine Lernschleife |

### Andocken (#14)

Wer einen Missions-PR oder einen anderen Pull Request eines Laufs andockt, steht **nur hier**. Die
Regel 1 von `mission`, der Flotten-Treiber und `guard.ps1` verweisen auf diesen
Schlüssel. Ein Lauf dockt nie an, in keiner Einstellung.

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `merge` | `mensch`: ein Mensch dockt an. `nach_gate`: genau ein Akteur dockt nach grünem Andockblock an und, wo es Checks gibt, nach grünen Checks — der Flotten-Treiber mit `merge.ps1`. Immer mit Andock-Commit (`gh pr merge --merge`) | `mensch` |
| `gate_heading` | Überschrift des Abschnitts mit dem Andockblock in der PR-Beschreibung | `## Gate` |
| `gate_green` | Zeile, die eine grüne Andockprüfung abschließt | `Gate grün.` |
| `gate_base` | regulärer Ausdruck mit einer Gruppe: die Basis-SHA, gegen die die Andockprüfung lief | `Basis \S+ @ ([0-9a-f]{7,40})` |
| `gate_head` | regulärer Ausdruck mit einer Gruppe: die SHA, auf der die Andockprüfung lief | `\(HEAD ([0-9a-f]{7,40})\)` |
| `gate_command` | Befehl (PowerShell), der die ganze Andockprüfung im Worktree fährt und den Block ausgibt; mit ihm fährt der Flotten-Treiber die Andockprüfung in seiner Andockschlange selbst. Rot von außen meldet er in einer eigenen Zeile, die mit `Testsperre belegt` oder `Zeitgrenze des Gates` beginnt (Vertrag mit dem Treiber: einmal wiederholt, zählt nicht gegen den Lauf) | keiner |
| `gate_always_command` | Befehl für den Teil der Andockprüfung, der immer läuft, egal welche Bereiche sich bewegt haben (hexanite: `wurzel`) | keiner |
| `gate_areas` | Liste `<muster> = <name>`: welche Dateien zu welchem Bereich der Andockprüfung gehören. `**` geht über Ordner, `*` und `?` bleiben in einem, ein `/` am Ende meint den ganzen Ordner | keine |
| `gate_partial` | regulärer Ausdruck, der in der Kopfzeile einen Teil-Lauf (nur `gate_always_command`) erkennt | `Immer-Teil` |

**Der Andockblock** gilt bei `merge: nach_gate` immer, auch in Repositorys mit Checks: Ein Check
prüft oft etwas anderes (in hexanite baut er nur die Website) und ersetzt die Andockprüfung nie; ein roter
Check sperrt das Andocken trotzdem. Auf Checks wartet `merge.ps1` vorher (meldet die Forge zwei
Minuten lang keinen Check, hat das Repository keine; hat es weder Workflows noch Checks oder
Status auf der Basis, wartet es gar nicht). Den Adapter liest `merge.ps1` vom Standardzweig, nicht
von der Basis des PRs, und es dockt nur einen PR auf der erwarteten Basis an (`base_branch`, sonst
`main_branch`, sonst der Standardzweig; bei `from-issue` dockt ein Mensch an). Der Block steht in der PR-Beschreibung unter
`gate_heading`, bis zur nächsten Überschrift gleicher oder höherer Ebene; meist als Codeblock, so wie die Andockprüfung ihn
ausgibt:

```
== Gate: Basis origin/main @ a7d3a91, 3 geänderte Dateien (HEAD d9084a7c)
  hive-web grün            0:50
  wurzel   grün            0:24
Gate grün.
```

Stehen mehrere Läufe im Abschnitt (erst rot, nach einem Nachlauf grün), zählt der **letzte**: die
letzte Zeile, auf die `gate_base` passt, und was danach folgt. Angedockt wird nur, wenn

1. der Abschnitt da ist und `gate_base` und `gate_head` im letzten Lauf passen,
2. nach dieser Zeile `gate_green` steht (ganze Zeile),
3. die Basis-SHA des Blocks der **aktuelle** Stand der Basis ist (Präfix),
4. die HEAD-SHA des Blocks der aktuelle Head des Pull Requests ist (Präfix), und
5. der Head die aktuelle Basis enthält (Forge-Vergleich: 0 Commits hinter der Basis).

Fehlt etwas davon, wird nicht angedockt, und der Lauf fährt die Andockprüfung neu (`mission/SKILL.md`, Phase 6).
Ein Commit nach der Andockprüfung, auch nur Doku, verlangt eine neue Andockprüfung.

**Der Teil-Lauf.** Ist der letzte Lauf ein Teil-Lauf (`gate_partial` in der Kopfzeile, nur
`gate_always_command`), gelten 1 bis 5 auch für ihn, und dazu:

- Davor steht ein **voller** grüner Lauf mit Basis und Head.
- Die Basis hat sich seit diesem vollen Lauf **nur in Bereichen bewegt, die der Pull Request nicht
  berührt** (`gate_areas`). Eine Datei in keinem Bereich zählt als jeder Bereich.
- Der Head hat seit dem vollen Lauf nur Dateien der Basis dazubekommen (das Einmischen der Basis per `git merge`).

Ohne `gate_areas` im Adapter zählt ein Teil-Lauf nie: Jede Bewegung der Basis verlangt dann eine
volle Andockprüfung. `merge.ps1` prüft das selbst über die Forge; kann es den Vergleich nicht lesen,
dockt es nicht an.

### Werft (#88)

Was nach dem Andocken auf `main_branch` nachgezogen wird, liest die Werft (`flotte werft`,
agent-skills/ADR-0005) aus `origin/<main_branch>`. Fehlt der Schlüssel, zieht sie in diesem
Repository nichts nach. Ein Lauf liest ihn nicht.

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `deploy` | Map wie `test_commands`, je Eintrag `<stack>.<feld>: <wert>` (Stackname aus Buchstaben, Ziffern, `_`, `-`), dazu `abfrage_s`. Felder: `pfade` (Liste von Mustern wie `gate_areas`; eine geänderte Datei, die eines trifft, zieht den Stack nach), `nachziehen` (Befehl der System-Shell in der Repo-Wurzel, mit `WERFT_COMMIT` und `WERFT_STACK`; die Werft stellt die Arbeitskopie nicht um, der Befehl holt den Stand `WERFT_COMMIT` selbst; Exit ≠ 0 stellt den Stack auf rot), `migration_test` (Migration der Testdatenbank, läuft ohne Freigabe direkt nach `nachziehen`; Exit ≠ 0 stellt den Stack auf rot), `migration_arbeit` (Migration der Arbeitsdatenbank, nur nach geprüfter `sicherung` und Freigabe auf der Brücke), `sicherung` (Sicherungsbefehl vor `migration_arbeit`, Pflicht neben ihr). Alle mit `WERFT_COMMIT` und `WERFT_STACK`. `pfade` und `nachziehen` sind Pflicht; ein anderes Feld ist ein Fehler, den die Werft meldet, statt still nichts zu tun | keiner: keine Werft |
| `deploy.abfrage_s` | Abstand in Sekunden, in dem die Werft `origin/<main_branch>` holt; der Mensch kann ihn auf der Brücke überschreiben | `120` |

Berührt ist ein Stack, wenn eine Datei im Diff seit dem letzten Stand der Werft eines seiner `pfade`
trifft. Fehlt dieser Stand lokal (Force-Push und gc), gelten alle Stacks als berührt.

**Geprüfte Sicherung** (#89): Der Sicherungsbefehl endet mit Exit 0 und nennt in der letzten Zeile
seiner Ausgabe die Sicherungsdatei (absolut oder von der Repo-Wurzel aus). Die Werft prüft, dass sie
existiert, nicht leer ist und nach dem Start des Befehls geschrieben wurde (eine Sekunde Spielraum
für Dateisysteme mit ganzen Sekunden), und merkt sich ihren SHA-256. Eine Sicherung, die das nicht
erfüllt, stellt den Stack auf rot und sperrt die Freigabe, bis `nachziehen` eine neue nimmt. Die
Freigabe nennt Commit, Dateiname und Prüfsumme; vor der Migration rechnet die Werft die Prüfsumme
nach, eine geänderte oder fehlende Datei sperrt. Jedes `nachziehen` des Stacks nimmt eine neue
Sicherung, eine Freigabe der alten wirkt dann nicht mehr. Die Werft merkt sich auch
`migration_arbeit` zur Zeit der Sicherung und fährt genau diesen Befehl; nennt der Adapter
inzwischen einen anderen (etwa ein Andocken, das nur den Adapter ändert), wird die Freigabe abgelehnt
und die Migration gesperrt.

```yaml
deploy:
  abfrage_s: 120
  web.pfade: [apps/web/, packages/ui/**]
  web.nachziehen: pwsh -File scripts/nachziehen.ps1 web
  web.migration_test: bun run --cwd apps/web migrate:test
  web.sicherung: pwsh -File scripts/sichern.ps1
  web.migration_arbeit: bun run --cwd apps/web migrate
  api.pfade: [apps/api/]
  api.nachziehen: pwsh -File scripts/nachziehen.ps1 api
```

## Auslegung

Festgelegt am 23.09.2026 nach dem ersten Entwurf von Skill und Referenzen. Die Regeln gelten für
alle drei Skills.

- **Die Statuslabels** (`status/in-arbeit`, `status/blockiert`, `status/haengt`) sind kein
  Adapterschlüssel. Namen und Setzpunkte stehen im Skill („Die Statuslabels"), Farben und
  Beschreibungen in `forge.md` („Statuslabels"), damit KIBO sie in jedem Repository gleich liest. Ein Adapter kann sie weder umbenennen noch abschalten.
- **Das Zielissue ist immer die Mission**, auch wenn es `epic_label` nicht trägt. Trägt im Repository
  **kein** Issue das Label, gilt jede Kante vom Zielissue als Missionsziel, so wie vor dieser Fassung.
- **Kante Missionsziel → fremde Mission** (ein Missionsziel ist von einer Mission blockiert, die nicht das Zielissue ist):
  Das ist eine Kante aus der Mission hinaus. Aufgelöst wird nur mit `transitive: true` **und** wenn
  alle Pakete daran hängen (`SKILL.md`, Phase 1). Sonst wird das Missionsziel übersprungen und kommentiert.
- **`ready_label`** prüft im Modus `tickets` nur die Missionsziele, im Modus `spec` die Spec.
- **`window` > 1 ohne `test_isolation_env` und ohne `isolation: none-needed`** lockert die Regel und
  ist ein Punkt fürs Vorab-Tor.
- **`base_branch` nach einem Lauf:** Maßgeblich ist die `base` des Pull Requests, der Adapterwert
  ist nur der Standard für den nächsten Lauf. Das gilt für `mission-nacharbeit` und `mission-aufraeumen`.
- **`always_link` nennt nur Verzeichnisse.** Eine Datei, die jedes Paket braucht (etwa
  `server/.env`), steht in `env_files` und wird kopiert.
- **`write_back_dependencies`** gilt nur auf Forges mit Abhängigkeits-API (Gitea, GitLab). Auf
  GitHub wird nichts nachgetragen; die gelesenen Kanten stehen im Plan. Nachgetragen werden nur
  Kanten **innerhalb desselben Repositorys**. Ob die Instanz Kanten über Repositorys hinweg annimmt,
  ist nicht belegt; solche Kanten bleiben Text.
- **`plan_artifact`:** Die Tafel liegt immer im Scratchpad der Sitzung, nie im Repository (Werte:
  Tabelle oben). Ein alter Wert `off` wird als `file` gelesen.
- **Alte Schreibweisen:** „Abnahmeabschnitt" in einem alten Adapter meint `verification_section`,
  wenn dort ein Verifikationsweg steht (spill). `test_isolation_env` mit einem Wert wie „keine" oder
  „keine nötig" plus Begründung ist `isolation: none-needed`; die Begründung ist die Begründung.
  „Fensterbreite" ist `window`. „Abbruchbedingung" in Adapter-Prosa ist ein Tor-Punkt, wenn sie vor
  dem Lauf feststellbar ist, sonst ein Grund zum Zurücklassen. Im Lauf wird nie angehalten.
- **Ein neu abgelegter Adapter** wird über einen eigenen Branch und Pull Request eingecheckt,
  `token_file` vorher in `.gitignore`. Ein unversionierter Adapter macht `git status` unsauber, und
  der nächste Lauf hält in Phase 0 an.
- **Zwei Tokens:** Liegt im Repository auch das Token eines Dienstes (etwa ein Lesetoken in
  `.env`), benutzt der Lauf ausschließlich `token_env`. Der Lauf braucht Schreibrecht, und das prüft
  er in Phase 0.
- **Missionsziele aus der Kopfzeile** (`dependency_source: header`): In der Standardlesart sind die
  Aufzählung `Kinder: #a, #b` in `> **Reihenfolge:**` Kanten Mission → Missionsziel, alle übrigen Nummern der
  Zeile sind Reihenfolge. Ein Adapter darf in Prosa eine **eigene Lesart seiner Kopfzeilen**
  festlegen: weitere Wörter für Missionsziele, harte Kanten in den Kopfzeilen der Missionsziele, Wörter, die keine
  Kante sind. Das ist eine Lesart, keine Lockerung, und braucht keinen Schlüssel; der Plan legt sie
  offen. Mit `write_back_dependencies` gehen die Kanten in die API.
- **Rot nach einem Sofort-Andocken:** `SKILL.md`, Phase 5, Punkt 2; der Branch bleibt
  (`references/worktree.md`, „Abräumen"). Das ist kein Schlüssel.
- **`Closes` und die Mission:** `SKILL.md`, Phase 6, und `references/forge.md`, „Diese
  Gitea-Instanz". Das ist kein Schlüssel.
- **Der Missions-Branch** lebt in einem eigenen Worktree (`SKILL.md`, Regel 11 und Phase 3). Das ist
  kein Schlüssel und lässt sich nicht abschalten.
- **Branches:** Namensschema und `<nr>`: `SKILL.md`, Phase 3. Das ist kein Schlüssel.

## Referenzdateien des Skills

`SKILL.md` verweist auf genau diese Dateien. Ein Name, der hier nicht steht, existiert nicht.

| Datei | Inhalt |
|---|---|
| `references/adapter.md` | diese Datei |
| `references/forge.md` | Forge-Zugriff, Eigenheiten der Gitea-Instanz, Kommentare aus Dateien, Nachzählen, Pull Request |
| `references/lauftafel.md` | Aufbau und Fortschreiben der Lauftafel |
| `references/lauftafel.html` | die Vorlage der Lauftafel im Design „Konsole". Wird kopiert, nicht nachgebaut; ihr gemeinsamer Block steht wortgleich in `flotte/references/flottentafel.html` |
| `references/worktree.md` | Worktrees rüsten und abräumen, auch ohne Manifest und Reste auf der Platte |
| `scripts/worktree.ps1` | das Skript dazu; `Up`, `Down` und `CleanupStale` sind der einzige Weg, Worktrees zu rüsten und abzuräumen |
| `scripts/ram.ps1` | die RAM-Messung der RAM-Bremse (`SKILL.md`, Phase 4) |

`references/plan-artifact.md` entfällt und wird durch `lauftafel.md` ersetzt.
