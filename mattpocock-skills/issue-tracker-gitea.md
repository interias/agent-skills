# Issue tracker: Gitea

<!-- Vorlage aus Breuckmann/agent-skills (mattpocock-skills/issue-tracker-gitea.md).
     Beim Einrichten nach docs/agents/issue-tracker.md kopieren und <owner>/<repo> einsetzen. -->

Issues und Specs dieses Repositorys liegen in Gitea: `http://mb-vsv-cast:3003/<owner>/<repo>`.
Es gibt kein CLI; alles geht mit `curl` gegen die API.

## Zugang

- **API-Basis:** `API=http://mb-vsv-cast:3003/api/v1/repos/<owner>/<repo>`
- **Token:** die Variable aus `token_env` in `.claude/prd.md`, geladen aus dessen `token_file`
  (`set -a && . <token_file> && set +a`). Gibt es keinen Adapter, `GITEA_TOKEN` aus der `.env` des
  Repositorys. Header: `Authorization: token $TOKEN`.
- **Ohne Token antwortet Gitea mit 404**, auch für ein Issue, das es gibt. 404 heißt zuerst: Token
  fehlt.
- **Listen sind auf 50 gedeckelt:** mit `?page=` paginieren, bis eine Seite leer ist.
- **Bodys und Kommentare aus einer Datei schicken** (`-d @body.json`), nie als Shell-Zeichenkette:
  die Shell zerlegt Backticks und Code-Zäune still.

## Befehle

| Vorgang | Aufruf |
|---|---|
| Issue lesen | `GET $API/issues/<nr>` und `GET $API/issues/<nr>/comments` |
| Issues auflisten | `GET $API/issues?state=open&type=issues&labels=<name>&page=<n>&limit=50` |
| Issue anlegen | `POST $API/issues` mit `{"title","body","labels":[<id>,…]}` |
| Kommentieren | `POST $API/issues/<nr>/comments` mit `{"body"}` |
| Labels setzen | `POST $API/issues/<nr>/labels` mit `{"labels":["<name>",…]}` |
| Label entfernen | `DELETE $API/issues/<nr>/labels/<id>` |
| Schließen | `PATCH $API/issues/<nr>` mit `{"state":"closed"}` |

**Beim Anlegen nimmt Gitea Labels nur als IDs.** Die IDs stehen in `GET $API/labels`. Das
nachträgliche Setzen über `/labels` nimmt auch Namen.

## Abhängigkeiten

Gitea hat native Abhängigkeiten, sie sind die maßgebliche Form.

```
POST $API/issues/<nr>/dependencies
{"owner": "<owner>", "repo": "<repo>", "index": <blocker>}
```

Gelesen: **`<nr>` in der URL ist blockiert von `index`.** „#12 wartet auf #10" ist
`POST …/issues/12/dependencies` mit `"index": 10`. `GET …/issues/<nr>/dependencies` listet die
Blocker. Vorher prüfen, ob die Kante schon existiert.

- **Kind eines Epics:** Das Epic ist von jedem seiner Kinder blockiert, also
  `POST …/issues/<epic>/dependencies` mit `"index": <kind>`. So findet `/prd` die Kinder.
- **Vorgänger:** das Kind ist von seinem Vorgänger blockiert.
- Zusätzlich steht jede Kante als Text im Body (`## Parent`, `## Blocked by`), damit sie ein Mensch
  ohne API sieht.

**Schließen scheitert mit HTTP 412, solange ein Blocker offen ist**, auch für ein Epic mit offenen
Kindern.

## Wenn ein Skill „publish to the issue tracker" sagt

Ein Gitea-Issue anlegen.

- **Spec (`/to-spec`):** die sieben Abschnitte der Vorlage, Überschriften unverändert englisch. Das
  ist der Modus `spec` von `/prd`, er liest `## User Stories` und `## Testing Decisions`. Label
  `ready-for-agent`.
- **Tickets (`/to-tickets`):** Jedes Ticket bekommt die Abschnitte der Plugin-Vorlage **und** die
  drei, ohne die `/prd` ein Ticket überspringt. Maßgeblich sind die Namen aus `.claude/prd.md`
  (`acceptance_section`, `verification_section`, `modules_section`); ohne Adapter diese:

  ```markdown
  ## Parent
  #<epic> — <Titel des Epics>

  ## Was gebaut wird
  Das Verhalten von Ende zu Ende, aus Sicht des Nutzers.

  ## Betroffene Module
  Die berührten Module. `Exklusiv`, wenn das Ticket allein laufen muss.

  ## Verifikationsweg
  Wie ein Reviewer selbst prüft, dass es stimmt: Befehle, erwartete Zahlen, Vorbildtest.

  ## Abnahmekriterien
  - [ ] Kriterium 1

  ## Blocked by
  #<nr> oder „Keine — kann sofort starten".
  ```

  Ohne `## Verifikationsweg` fasst `/prd` das Ticket nicht an. Tickets in Abhängigkeitsreihenfolge
  anlegen, dann die Kanten eintragen (Kind → Vorgänger, Epic → Kind). Label `ready-for-agent`.
- **Epic:** ein Issue mit den sieben Abschnitten der Spec-Vorlage und der Kopfzeile
  `> **Reihenfolge:** … Kinder: #a, #b.`, Label `epic`. Die Kinder hängen per Abhängigkeit daran.

## Wenn ein Skill „fetch the relevant ticket" sagt

`GET $API/issues/<nr>` und die Kommentare dazu.

## Schließen über Pull Requests

Gitea schließt nur mit englischen Schlüsselwörtern: `Closes #<nr>`. `Schließt #<nr>` wirkt nicht.

## Pull Requests als Anfragen

**PRs as a request surface: no.**
