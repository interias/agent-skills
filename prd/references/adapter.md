# Der Projektadapter

Alles Projektspezifische steht in `.claude/prd.md` des Zielrepositorys. Diese Datei legt fest,
**welche Schlüssel es gibt, was sie bedeuten und was gilt, wenn einer fehlt**. Sie ist der Vertrag
zwischen `SKILL.md`, den Referenzen und `prd-nacharbeit` / `prd-aufraeumen`: Ein Name, der hier
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
das Ergebnis als `.claude/prd.md` abzulegen.

**Alte Adapter bleiben gültig.** Jeder Schlüssel unten hat einen Standardwert, und ein Adapter
aus der Zeit vor dieser Fassung wird ohne Änderung gelesen.

## Schlüssel

### Forge

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `forge` | `gitea`, `github`, `gitlab` | aus `origin` |
| `api` | API-Basis des Repositorys | aus `origin` |
| `token_env` / `token_file` | Variable und gitignorierte Datei mit dem Token. Alternativ Basic Auth über `git credential fill` (spill) | `GITEA_TOKEN`, keine Datei |
| `push_remote` | das einzige Remote, auf das gepusht wird | `origin` |
| `forbidden_remotes` | Remotes, auf die nie gepusht wird | keine |
| `issue_offset` | PRD `n` ist Issue `#(offset+n)` | keine Umrechnung |

### Issues

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `issue_form` | `prd` (Epic mit Kind-Tickets) oder `spec` (ein Issue mit sieben Abschnitten, der Orchestrator zerlegt) | **aus der Form abgeleitet**: hat das Issue Kinder → `prd`; sieben Abschnitte ohne Kinder → `spec`; sonst Vorab-Tor |
| `ready_label` | Freigabelabel: nur Tickets damit werden bearbeitet | `ready-for-agent` |
| `skip_labels` | Tickets damit werden übersprungen (mit Kommentar) | `needs-triage`, `needs-info`, `wontfix` |
| `epic_label` | kennzeichnet Epics. Eine Kante zwischen zwei Epics heißt **Reihenfolge**, eine Kante von einem Epic zu einem Nicht-Epic heißt **Kind** | `epic` |
| `dependency_source` | `api` (Gitea-Abhängigkeiten), `header` (Kopfzeile `> **Reihenfolge:** …`), `body` (Abschnitt `## Blocked by`). Mehrfachnennung erlaubt | `api` |
| `write_back_dependencies` | Kanten, die aus `header` oder `body` gelesen wurden, trägt der Lauf in die Gitea-Abhängigkeiten nach | `true`, wenn `dependency_source` nicht nur `api` ist |
| `transitive` | hängen alle Kinder an Tickets einer anderen offenen Spec, werden diese im selben Lauf mitbearbeitet | `false` |
| `acceptance_section` | Abschnitt mit der Abnahmeliste | `prd`: `## Abnahmekriterien`; `spec`: `## User Stories` |
| `verification_section` | Abschnitt mit dem Verifikationsweg. Fehlt er an einem Kind, wird es nicht bearbeitet | `prd`: `## Verifikationsweg`; `spec`: `## Testing Decisions` |
| `modules_section` | Abschnitt mit den berührten Modulen. Das Wort `Exklusiv` darin heißt: läuft allein | `## Betroffene Module` |
| `base_branch` | Basis des Epic-Branches und Ziel des Pull Requests. `from-issue` = aus Kopfzeile oder Further Notes, sonst aus `git log --merges` | `main` |

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
| `link_dirs` | Abhängigkeitsverzeichnisse, die als Junction verlinkt statt installiert werden. Nur für Pakete, die sie berühren | keine |
| `always_link` | Verzeichnisse, die jedes Paket braucht, auch wenn es sie nicht berührt | keine |
| `port_env` | Variable für den Port eines Worktree-Servers | keine |

### Commits, Tafel, Tor

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `commit_style` | Conventional Commits mit Scope oder ohne | aus `git log` |
| `commit_language` | `de` / `en` | aus `git log` |
| `commit_umlauts` | `keep` / `transliterate` | aus `git log` |
| `plan_artifact` | `publish` (Lauftafel als Artifact) oder `off` | `publish` |
| `gate_approvals` | zusätzliche Punkte fürs Vorab-Tor, etwa bezahlte Läufe oder Blindsatz | keine |
| `no_access` | Systeme, auf die ein Lauf keinen Zugriff hat. Ein Paket, das sie braucht, ist ein Tor-Punkt | keine |

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
