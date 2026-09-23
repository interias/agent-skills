# mattpocock-skills in unseren Repositorys

Die Skills zum Klären und Zerlegen (`grill-with-docs`, `grill-me`, `grilling`, `to-spec`,
`to-tickets`, `triage` …) kommen aus dem offiziellen Plugin **`mattpocock-skills`** (MIT) und
werden **nicht** hierher kopiert. Eine Kopie hängt ab dem ersten Tag hinter den Updates des
Plugins her und kollidiert mit dessen Namen: Zwei `to-spec` bedeutet, dass unklar ist, welches
greift. Das Plugin ist über `docs/agents/*.md` im Zielrepository konfigurierbar. Dieser Ordner
legt fest, wie wir es konfigurieren.

Geprüft gegen Plugin-Version **1.2.3** (23.09.2026).

## Die Kette

```
grill-with-docs ─→ to-spec ──────────────→ /prd (Modus spec)
  (CONTEXT.md,      oder                     │
   ADRs)          to-tickets ─→ Epic+Kinder ─→ /prd (Modus prd)
                                             │
                                  PR gemergt ─→ /prd-nacharbeit, /prd-aufraeumen
```

- **`grill-with-docs`** klärt Plan und Fachsprache und schreibt `CONTEXT.md` und `docs/adr/`.
  `grill-me` und `grilling` sind dieselbe Befragung ohne Dokumente.
- **`to-spec`** schreibt eine Spec mit sieben Abschnitten, `/prd` zerlegt sie selbst.
- **`to-tickets`** zerlegt in Kind-Tickets, `/prd` arbeitet sie als Epic ab.

Welcher der beiden: `to-tickets`, wenn die Pakete schon beim Klären sichtbar sind und ein Mensch
sie einzeln freigeben will; `to-spec`, wenn der Schnitt Sache des Orchestrators bleiben soll.

## Einrichten eines Repositorys

`/setup-matt-pocock-skills` einmal je Repository, mit diesen Antworten:

| Abschnitt | Antwort |
|---|---|
| A — Issue tracker | **Other.** Statt einer Beschreibung [`issue-tracker-gitea.md`](issue-tracker-gitea.md) nach `docs/agents/issue-tracker.md` kopieren und `<owner>/<repo>` einsetzen. |
| B — Triage labels | **Standard behalten** (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). Das sind dieselben Namen wie `ready_label` und `skip_labels` im `/prd`-Adapter. |
| C — Domain docs | **single-context**: `CONTEXT.md` und `docs/adr/` im Wurzelverzeichnis. |

**Der Block `## Agent skills` gehört in `AGENTS.md`, nicht in `CLAUDE.md`.** Das Plugin bevorzugt
`CLAUDE.md`, sobald die Datei existiert. Bei uns ist `CLAUDE.md` höchstens ein Zeiger auf
`AGENTS.md` (BRIQNET ADR-0007). Beim Einrichten also ausdrücklich sagen: „`AGENTS.md` bearbeiten,
`CLAUDE.md` nicht anfassen".

## Warum die Gitea-Vorlage mehr verlangt als das Plugin

Die Ticketvorlage von `to-tickets` hat `Parent`, `What to build`, `Acceptance criteria` und
`Blocked by`. `/prd` braucht an jedem Kind zusätzlich einen **Verifikationsweg**, ohne ihn
überspringt es das Ticket, weil der Reviewer sonst nichts hat, woran er prüft
(`prd/SKILL.md`, Phase 1). Die Abschnittsnamen kommen aus dem Adapter (`acceptance_section`,
`verification_section`, `modules_section`). Die Vorlage schreibt sie deshalb vor, statt dass
`/prd` sie später vermisst. Vorbild sind die Kinder von Breuckmann/KIBO#1.

Auch die Kanten schreibt die Vorlage vor: Gitea führt die Kinder eines Epics als dessen Blocker. Legt
`to-tickets` die Kante Epic → Kind nicht an, findet `/prd` die Kinder nicht.

## Bei einem Plugin-Update

Die Vorlagen von `to-spec` und `to-tickets` mit dieser Datei vergleichen. Die Stellen im Plugin
sind `skills/engineering/to-tickets/SKILL.md` (`<issue-template>`) und
`skills/engineering/to-spec/SKILL.md` (`<spec-template>`). Weicht eine ab, die geprüfte Version
oben und gegebenenfalls `issue-tracker-gitea.md` nachziehen.
