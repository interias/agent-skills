# Der Projektadapter

Alles Projektspezifische steht in `.claude/persona-review.md` des Zielprojekts: YAML-Frontmatter
für die Werte, Fließtext für Projektregeln (Fachsprache, was als vertraulich gilt, Eigenheiten der
lokalen Instanz). Der Adapter darf den Skill verschärfen, nie lockern; eine Basis-URL außer einem
lokalen Host nimmt das Kit nicht an.

Forge, Labels und Ticketform liest der Skill aus `.claude/epic.md` (Vertrag:
`references/adapter.md` des Skills `epic`).

## Schlüssel

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `start` | wie die lokale Instanz startet: Befehl, `.claude/launch.json`-Name oder Verweis aufs README | aus `.claude/launch.json` |
| `local_db` | Name der Datenbankkopie und wie man prüft, dass die Instanz sie nutzt | — Pflicht |
| `api_url` | lokale API, falls Personas lesend nachsehen dürfen; muss ebenfalls lokal sein | — |
| `case_setup` | Befehl, der die synthetischen Fälle anlegt und `cases.json` schreibt; `{out}` steht für den Zielpfad | — fehlt er, schreibt der Host ein Skript im Rundenordner |
| `case_marker` | Kennzeichen im Namen jedes synthetischen Falls | `(synthetisch)` |
| `case_lock` | was tun, wenn ein Fall gesperrt oder belegt ist (nur der eigene Fall) | warten, dann melden |
| `forbidden_patterns` | reguläre Ausdrücke für Werte, die in keinem Bericht stehen dürfen | `[]` — Prozentangaben werden immer geprüft |
| `forbidden_in_report` | dieselben Werte in Worten, für den Auftrag an die Personas | — |
| `code_roots` | wo der Host Befunde nachprüft | das Repository |
| `tool_budget` | Werkzeugaufrufe je Persona | `60` |
| `archive_dir` | Ablage der Runden, außerhalb jedes öffentlichen Repositorys | — Pflicht |
| `python` | Interpreter mit Playwright | `python` |
| `kit` | wird 1:1 zu `kit.json` (unten) | — Pflicht |

## Der Block `kit`

Ihn liest `scripts/personakit.py`, und `scripts/probe.py` liest `kit.probe`.

| Schlüssel | Bedeutung | Standard |
|---|---|---|
| `base_url` | Oberfläche der lokalen Instanz | — Pflicht |
| `case_path` | Pfad eines Falls, `{id}` wird ersetzt | — Pflicht |
| `login.mode` | `none`, `url` (Entwickler-Login über eine URL) oder `form` (Testkonto) | `none` |
| `login.path` | Login-Pfad, `{next}` wird durch den Zielpfad ersetzt | — |
| `login.wait_url` | Regex der URL, an der der Login fertig ist | — |
| `login.user_env`, `login.password_env` | Umgebungsvariablen eines **Testkontos** (nur `form`) | — |
| `login.user_selector`, `login.password_selector`, `login.submit_selector` | Felder des Formulars (nur `form`) | — |
| `overlay_buttons` | Beschriftungen von Knöpfen, die Erinnerungen und Einblendungen schließen | `[]` |
| `viewport`, `locale` | Fenstergröße, Sprache | `[1600, 1000]`, `en-US` |
| `settle_ms`, `timeout_ms` | Wartezeit nach dem Laden, Standard-Timeout | `1500`, `15000` |
| `browser_executable` | fester Chromium-Pfad, wenn Playwrights eigener fehlt | — |
| `probe.leave` | Element zum Verlassen: Selektor oder `{role, name}` (Name als Regex) | — |
| `probe.guard_selector` | Warnung vor ungespeicherten Änderungen | `[role=alertdialog]` |
| `probe.change_selector` | Feld für die Gegenprobe, in einem synthetischen Fall | — |
| `probe.wait_ms` | Wartezeit nach dem Öffnen, bevor verlassen wird | `10000` |

Ein Selektor ist ein Playwright-Selektor (CSS oder `role=…`) oder `{role, name}`.

## Beispiel

```markdown
---
start: launch.json "web"
local_db: "orders_review — Port 5433; prüfen mit: GET http://localhost:8000/health → db"
case_setup: python -P tools/review_cases.py {out}
case_marker: (synthetisch)
forbidden_patterns: ['Einkaufspreis\w*\s+\d', 'Rabatt\w*\s+\d']
forbidden_in_report: Einkaufspreise, Rabatte und Margen, auch Demo-Werte
archive_dir: C:/Users/<du>/review-archiv/bestellungen
kit:
  base_url: http://localhost:3000
  case_path: /de/orders/{id}
  login: {mode: url, path: '/api/dev-login?next={next}', wait_url: '/de/'}
  overlay_buttons: [Später, Schließen]
  locale: de-DE
  probe:
    leave: {role: link, name: '^Übersicht$'}
    change_selector: 'input[name=reference]'
---

# Persona-Review — Bestellverwaltung

Fachsprache: CONTEXT.md. Das Entwicklungs-Overlay unten links gibt es nur lokal.
```
