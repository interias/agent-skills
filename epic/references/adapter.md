# Der Projektadapter

Alles Projektspezifische steht in `.claude/epic.md` des Zielrepositorys. Diese Datei legt fest,
**welche Schlüssel es gibt, was sie bedeuten und was gilt, wenn einer fehlt**. Sie ist der Vertrag
zwischen `SKILL.md`, den Referenzen und `epic-nacharbeit` / `epic-aufraeumen`: Ein Name, der hier
nicht steht, ist kein Adapterschlüssel.

## Form

Ein Adapter darf YAML-Frontmatter benutzen (KOKOS) oder Tabellen in Prosa (spill). Maßgeblich ist
die **Bedeutung** des Eintrags, nicht seine Schreibweise. Eine Tabellenzeile „Epic-Label |
`type/epic`" ist dasselbe wie `epic_label: type/epic`. Im Zweifel legt der Lauf seine Lesart im
Plan offen, statt still zu raten.

Der Fließtext des Adapters sind **Projektregeln**, zum Beispiel Doku-Pflicht, Migrationsverbote
oder Fachsprache. Sie gelten wie Regeln des Skills. Der Adapter darf den Skill **verschärfen, nie
lockern**. Ein Eintrag, der eine Regel des Skills aufheben würde, ist ein Punkt für das Vorab-Tor.

## Fehlt der Adapter

Ableiten, was ableitbar ist: Forge aus `git remote get-url origin`, Testbefehle aus
`package.json` bzw. `pyproject.toml`, Commit-Stil aus `git log`. Die Ableitung wird im Plan
offengelegt, und der Lauf fragt nach dem Rest am Vorab-Tor, statt zu raten. Danach bietet er an,
das Ergebnis als `.claude/epic.md` abzulegen.

**Alte Adapter bleiben gültig.** Jeder Schlüssel unten hat einen Standardwert, und ein Adapter
aus der Zeit vor dieser Fassung wird ohne Änderung gelesen.

**Alter Name.** Bis zur Umbenennung hieß die Datei `.claude/prd.md` und der Modus `tickets` hieß
`prd`. Fehlt `.claude/epic.md`, liest der Lauf `.claude/prd.md`; `issue_form: prd` gilt als
`tickets`. Beides nennt das Vorab-Tor als Hinweis „Adapter umbenennen“ — ein Hinweis, kein Halt.

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
| `issue_form` | `tickets` (Epic mit Kind-Tickets) oder `spec` (ein Issue mit sieben Abschnitten, der Orchestrator zerlegt) | **aus der Form abgeleitet**: hat das Issue Kinder → `tickets`; sieben Abschnitte ohne Kinder → `spec`; sonst Vorab-Tor |
| `ready_label` | Freigabelabel: nur Tickets damit werden bearbeitet | `ready-for-agent` |
| `skip_labels` | Tickets damit werden übersprungen (mit Kommentar) | `needs-triage`, `needs-info`, `wontfix` |
| `epic_label` | kennzeichnet Epics. Eine Kante zwischen zwei Epics heißt **Reihenfolge**, eine Kante von einem Epic zu einem Nicht-Epic heißt **Kind**. Der Lauf setzt es an ein Zielissue mit Kindern | `epic` |
| `dependency_source` | `api` (Gitea-Abhängigkeiten), `header` (Kopfzeile `> **Reihenfolge:** …`), `body` (Abschnitt `## Blocked by`). Mehrfachnennung erlaubt | `api` |
| `write_back_dependencies` | Kanten, die aus `header` oder `body` gelesen wurden, trägt der Lauf in die Gitea-Abhängigkeiten nach | `true` für Kanten aus `header`; für Kanten aus `body` nur, wenn der Adapter es setzt, sonst ein Tor-Punkt |
| `transitive` | hängen alle Kinder an Tickets einer anderen offenen Spec, werden diese im selben Lauf mitbearbeitet | `false` |
| `acceptance_section` | Abschnitt mit der Abnahmeliste. Fehlt er an einem Kind, wird es übersprungen und kommentiert | `tickets`: der erste vorhandene von `## Abnahmekriterien`, `## Akzeptanzkriterien`, `## Acceptance criteria`; `spec`: `## User Stories` |
| `verification_section` | Abschnitt mit dem Verifikationsweg. Fehlt er an einem Kind, wird es nicht bearbeitet | `tickets`: `## Verifikationsweg`; `spec`: `## Testing Decisions` |
| `modules_section` | Abschnitt mit den berührten Modulen. Das Wort `Exklusiv` darin heißt: läuft allein | `## Betroffene Module` |
| `base_branch` | Basis des Epic-Branches und Ziel des Pull Requests. `from-issue` = aus Kopfzeile oder Further Notes, sonst aus `git log --merges` | der Hauptzweig |
| `main_branch` | **Hauptzweig** des Repositorys: nie Ziel eines Merges durch den Lauf (alter Name, KOKOS) | `git symbolic-ref refs/remotes/<push_remote>/HEAD`, ersatzweise `main` |

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
| `test_commands` | Befehle je Suite | aus `package.json` / `pyproject.toml` |
| `known_red` | Tests, die auf der Basis bekannt rot sind, mit Namen | keine |
| `lint_commands` | Lint-Befehl je Modul; gezählt werden Fehler und Warnungen aus der Ausgabe, nicht der Exit-Code | keine — dann entfällt der Lint-Vergleich, und der Plan sagt das |
| `writers` | Pfade der Schreiber ohne Oberfläche (Migration, Import, Jobs), die der Reviewer bei jeder neuen Schreibsperre prüft | keine |
| `test_isolation_env` | Variable, die jedem Worktree ein eigenes Testbett gibt | keine |
| `isolation` | `none-needed` mit **Begründung**, wenn parallele Läufe sich nachweislich nichts teilen | nicht gesetzt |
| `window` | Zahl der gleichzeitigen Plätze, höchstens 3 | **1**, außer `test_isolation_env` oder `isolation: none-needed` ist gesetzt, dann 3 |
| `max_rounds` | Implementer-Runden je Paket, bevor es zurückbleibt | `3` |
| `exclusive_paths` | Pfade, deren Änderung ein Paket exklusiv macht | Lockfiles, Abhängigkeitslisten, Migrationen |
| `always_collide` | Dateien, die fast jedes Paket berührt (Patch-Notes, Versionsnummer). Zwei Pakete damit laufen nie gleichzeitig | keine |
| `pre_commit_checks` | Prüfungen vor jedem Commit, etwa `core.hooksPath` gesetzt und Patch-Notes-Check | keine |

### Worktrees

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `worktree_root` | Ablage der Worktrees, **ohne Punktverzeichnis im Pfad** | `../<repo>-worktrees` |
| `env_files` | gitignorierte Dateien, die jeder Worktree braucht. Sie werden **kopiert**, nie verlinkt | keine |
| `link_dirs` | Abhängigkeitsverzeichnisse, die als Junction verlinkt statt installiert werden. Nur für Pakete, die sie berühren: berührt heißt, ein Modul des Pakets liegt unter dem Elternpfad des Verzeichnisses. Im Zweifel verlinken | keine |
| `always_link` | Verzeichnisse, die jedes Paket braucht, auch wenn es sie nicht berührt | keine |
| `port_env` | Variable für den Port eines Worktree-Servers | keine |

### Commits, Tafel, Tor

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `commit_style` | Conventional Commits mit Scope oder ohne | aus `git log` |
| `commit_language` | `de` / `en` | aus `git log` |
| `commit_umlauts` | `keep` / `transliterate` | aus `git log` |
| `plan_artifact` | `publish` (Lauftafel als Artifact veröffentlicht) oder `file` (Lauftafel nur als Datei, Pfad im Eröffnungskommentar) | `publish` |
| `gate_approvals` | zusätzliche Punkte fürs Vorab-Tor, etwa bezahlte Läufe oder Blindsatz | keine |
| `no_access` | Systeme, auf die ein Lauf keinen Zugriff hat. Ein Paket, das sie braucht, ist ein Tor-Punkt | keine |

## Auslegung

Festgelegt am 23.09.2026 nach dem ersten Entwurf von Skill und Referenzen. Die Regeln gelten für
alle drei Skills.

- **Die Statuslabels** (`status/in-arbeit`, `status/blockiert`, `status/haengt`) sind kein
  Adapterschlüssel. Namen, Farben und Setzpunkte stehen im Skill („Die Statuslabels"), damit KIBO
  sie in jedem Repository gleich liest. Ein Adapter kann sie weder umbenennen noch abschalten.
- **Das Zielissue ist immer das Epic**, auch wenn es `epic_label` nicht trägt. Trägt im Repository
  **kein** Issue das Label, gilt jede Kante vom Zielissue als Kind, so wie vor dieser Fassung.
- **Kante Kind → fremdes Epic** (ein Kind ist von einem Epic blockiert, das nicht das Zielissue ist):
  Das ist eine Kante aus dem Epic hinaus. Aufgelöst wird nur mit `transitive: true` **und** wenn
  alle Pakete daran hängen (`SKILL.md`, Phase 1). Sonst wird das Kind übersprungen und kommentiert.
- **`ready_label`** prüft im Modus `tickets` nur die Kinder, im Modus `spec` die Spec.
- **`window` > 1 ohne `test_isolation_env` und ohne `isolation: none-needed`** lockert die Regel und
  ist ein Punkt fürs Vorab-Tor.
- **`base_branch` nach einem Lauf:** Maßgeblich ist die `base` des Pull Requests, der Adapterwert
  ist nur der Standard für den nächsten Lauf. Das gilt für `epic-nacharbeit` und `epic-aufraeumen`.
- **`always_link` nennt nur Verzeichnisse.** Eine Datei, die jedes Paket braucht (etwa
  `server/.env`), steht in `env_files` und wird kopiert.
- **`write_back_dependencies`** gilt nur auf Forges mit Abhängigkeits-API (Gitea, GitLab). Auf
  GitHub wird nichts nachgetragen; die gelesenen Kanten stehen im Plan. Nachgetragen werden nur
  Kanten **innerhalb desselben Repositorys**. Ob die Instanz Kanten über Repositorys hinweg annimmt,
  ist nicht belegt; solche Kanten bleiben Text.
- **`plan_artifact`:** Die Tafel liegt immer im Scratchpad der Sitzung, nie im Repository. Bei
  `publish` wird sie als Artifact veröffentlicht, bei `file` nur geschrieben. Ein alter Wert `off`
  wird als `file` gelesen.
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
- **Kinder aus der Kopfzeile** (`dependency_source: header`): In der Standardlesart sind die
  Aufzählung `Kinder: #a, #b` in `> **Reihenfolge:**` Kanten Epic → Kind, alle übrigen Nummern der
  Zeile sind Reihenfolge. Ein Adapter darf in Prosa eine **eigene Lesart seiner Kopfzeilen**
  festlegen: weitere Wörter für Kinder, harte Kanten in den Kopfzeilen der Kinder, Wörter, die keine
  Kante sind. Das ist eine Lesart, keine Lockerung, und braucht keinen Schlüssel; der Plan legt sie
  offen. Mit `write_back_dependencies` gehen die Kanten in die API.
- **Rot nach einem Sofortmerge:** Der Merge wird mit `git revert -m 1` als eigener Commit
  zurückgenommen, das Paket bleibt zurück, der Lauf geht weiter. So bleibt der Epic-Branch grün, und
  der Lauf hält nicht an.
- **`Closes` und das Epic:** `Closes #<kind>` je vollständig abgenommenem Kind. Ein Zielissue mit
  Kindern bekommt nie `Closes`, in keinem Modus: Gitea führt die Kinder als Blocker und antwortet
  beim Merge mit HTTP 412. Es schließt `/epic-nacharbeit`. `Closes #<spec>` nur bei einer Spec ohne
  Kinder, wenn alle User Stories abgenommen sind.
- **Der Epic-Branch** lebt im Worktree `<worktree_root>/epic-<nr>`, das Hauptverzeichnis wird nie
  umgeschaltet (`SKILL.md`, Regel 11). Das ist kein Schlüssel und lässt sich nicht abschalten.
- **Branches:** Epic-Branch `epic/<nr>-<slug>`, Paket-Branch `agent/<nr>-<slug>`. `<nr>` ist die
  Kindnummer, im Modus `spec` ohne Kinder `<spec>-p<k>`. Slug klein, ASCII, ä→ae, ö→oe, ü→ue, ß→ss.

## Referenzdateien des Skills

`SKILL.md` verweist auf genau diese Dateien. Ein Name, der hier nicht steht, existiert nicht.

| Datei | Inhalt |
|---|---|
| `references/adapter.md` | diese Datei |
| `references/forge.md` | Forge-Zugriff, Eigenheiten der Gitea-Instanz, Kommentare aus Dateien, Nachzählen, Pull Request |
| `references/lauftafel.md` | Aufbau und Fortschreiben der Lauftafel |
| `references/lauftafel.html` | die Vorlage der Lauftafel im Design „Stahlblau Thermik". Wird kopiert, nicht nachgebaut |
| `references/worktree.md` | Worktrees rüsten und abräumen |

`references/plan-artifact.md` entfällt und wird durch `lauftafel.md` ersetzt.
