# AGENTS.md — agent-skills

Wissen für Agenten, die in diesem Repository arbeiten. Für Menschen ist die [README](README.md); die
Fachsprache steht in [`CONTEXT.md`](CONTEXT.md), Entscheidungen in [`docs/adr/`](docs/adr/), der
Adapter für `/mission` in [`.claude/epic.md`](.claude/epic.md).

## Bevor du etwas änderst

- **Öffentliches Repository.** Keine lokalen Pfade mit Benutzernamen, keine IPs, keine
  Transkriptinhalte, keine Verbrauchs- oder Limitwerte in Issues, Kommentaren, Commits und PRs.
- **Nur in Worktrees arbeiten**, unter `../agent-skills-worktrees/<name>` auf eigenem Branch ab
  `origin/main`. Im Hauptverzeichnis kein Branch-Wechsel, kein `stash`, keine Edits.
- **Sprachraum** (agent-skills/ADR-0003): Texte, Oberfläche und Doku sprechen den Wortschatz aus
  `CONTEXT.md` (Mission, Missionsziel, Ingenieur, Erster Offizier, Andocken …). Labels,
  Adapter-Schlüssel, Branch-Präfixe und Skriptnamen bleiben technisch. Der Wächter
  `flotte/test/waechter.test.ts` prüft das.
- **Wo was hingehört:** README nur Überschrift, ein Satz, Grafik, Link. Ausführliches in `docs/`
  (eine neue Datei nur, wenn kein bestehender Ort passt), Wissen für Agenten hier. Nichts doppelt.

## Prüfen

| Was | Befehl | Hinweis |
|---|---|---|
| Treiber | `cd flotte && bun test test/<datei>` | voll: `bun test` (~7–9 min) |
| Brücke | `cd flottenbruecke && python -m pytest -q -p no:cacheprovider --basetemp=<eigener Ordner> tests/<datei>` | |
| Skripte | `Invoke-Pester -Path <datei>.Tests.ps1 -PassThru`, dann `FailedCount` prüfen | auf dem Rechner kann Pester 3.4 aktiv sein |
| Andockprüfung | `pwsh -NoProfile -File gate.ps1` | alle Suiten, druckt den Andockblock für PR und Treiber |

Während der Arbeit nur gezielte Tests; die volle Suite einmal am Ende. Ein Befehl über zehn Minuten
läuft im Hintergrund mit Logdatei, nie im Vordergrund. Keine Tests löschen oder überspringen.

## Texte, die gleich bleiben müssen

Einige Regeln stehen an mehreren Stellen wortgleich; Tests halten sie zusammen. Wer eine ändert,
ändert alle und lässt die Tests laufen:

- `BEIM_MENSCHEN` (Liste „Beim Menschen“) in `flotte/src/treiber/admiral.ts`,
  `flotte/references/entscheidungsrecht.md`, `mission/SKILL.md`, `docs/befugnisse.md` —
  `flotte/test/entscheidungsrecht.test.ts`, `flotte/test/befugnisse.test.ts`.
- `TICKET_REGEL` in `admiral.ts`, `mission/SKILL.md`, `mission-nacharbeit/SKILL.md`,
  `docs/befugnisse.md` — `flotte/test/tickets.test.ts`, `befugnisse.test.ts`.
- Die Grafiken unter `assets/readme/` haben HTML-Quellen; ändert sich ein Text darin, neu rendern
  ([`assets/readme/README.md`](assets/readme/README.md)).

## Commits, PRs, Andocken

- Commits: englische Conventional Commits mit Scope und Ticket, `fix(flotte): … (#133)`, im Body
  `Closes #133`. PR-Titel deutsch, Andockblock in die Beschreibung.
- Angedockt wird nach grünem `gate.ps1` (`merge: nach_gate` im Adapter); Remote-Branches erst
  löschen, wenn der PR `merged` ist.
- Nach dem Andocken bringt `install.ps1` den Stand nach `~/.claude/skills` ([`INSTALL.md`](INSTALL.md)).

## Tickets

Ein neues Ticket nur, wenn der Mensch gebraucht wird (`needs-triage`, ein Satz Ursache). Klare,
angemessene Arbeit wird erledigt, Wünsche ohne beobachteten Schaden werden verworfen. Die ganze Regel
und die Prüffragen: [`docs/befugnisse.md`](docs/befugnisse.md).
