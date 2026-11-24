# Wer entscheidet

Unter dem Treiber entscheidet der **Admiral** die Fragen der Läufe selbst; dafür ist er da. Du
bestätigst nichts vorab, du liest nach und nimmst zurück, was dir nicht passt. Bei dir liegt eine
Frage nur, wenn eine der sechs Prüffragen mit Ja beantwortet wird. Dieselben Fragen entscheiden in
der Nacharbeit und in der Triage, ob aus einem Punkt ein Ticket wird.

## Prüffragen: Admiral oder Mensch

| # | Prüffrage | Ja | Nein |
|---|---|---|---|
| 1 | Geht etwas **nach außen**, das sich nicht zurückholen lässt — E-Mails, Nachrichten an Dritte, Daten an Stellen außerhalb? | Mensch | weiter |
| 2 | Kostet es **echtes Geld**, das nicht vorher freigegeben ist? | Mensch | weiter |
| 3 | Ändert es **Produktivdaten**, ohne dass das eindeutig beschlossen ist? | Mensch | weiter |
| 4 | Berührt es **Sicherheit oder Zugänge**, die nicht mit dir abgestimmt und in Mission, Ticket oder PR festgehalten sind? | Mensch | weiter |
| 5 | Entsteht ein **Text oder Versprechen an Kunden**? | Mensch (am PR) | weiter |
| 6 | Bricht es eine **Architekturentscheidung** (ADR), oder bringt es eine neue Abhängigkeit, die nicht üblich und nicht Best Practice ist? | Mensch | **Admiral** |

Sechsmal nein heißt: Der Admiral entscheidet, auch gegen die Empfehlung des Laufs — Umfang
(weglassen, dazunehmen, in ein Ticket verschieben), Reihenfolge und Kanten, ein neues Ticket, ein
ADR-Bezug ohne Bruch, ein Prüfweg, der hier nicht fahrbar ist, Handgriffe und Doku in der Nacharbeit,
einen abgebrochenen Lauf einmal fortsetzen. Kosten des Planlimits sind keine Frage für ihn; die
regeln die Bremsen des Treibers. Eine Tatsache, die nur du kennst, hält nichts an: Er nimmt einen
vorsichtigen Wert und fragt dich nebenher.

## Nacharbeit und Triage: wird aus einem Punkt ein Ticket?

Die erste Frage, die mit Ja beantwortet wird, entscheidet.

| # | Frage | Ja | Wo das gilt |
|---|---|---|---|
| 1 | Braucht es **dich** — eine der sechs Prüffragen oder eine Änderung am **Ablauf des Projekts**? | Ticket mit `needs-triage` und einem Satz zur Ursache | Lauf, Nacharbeit |
| 2 | Ist die Arbeit **klar und nach Zeit und Umfang angemessen**? | In der Mission erledigen, bevor sie andockt — zuerst gefundene Fehler und was zum Missionsziel gehört | Lauf, Nacharbeit |
| 3 | Klar, aber **zu groß** für diese Mission? | Eigenes Issue mit `epic` und Freigabelabel, ohne Triage | Lauf, Nacharbeit |
| 4 | Ein **Wunsch ohne beobachteten Schaden**? | Verworfen: eine Zeile unter „Verworfen“ im Missions-PR; in der Triage „not planned“ geschlossen, nie gelöscht | Nacharbeit, Triage |

Eine Ticketfrage geht nie an dich; der Missions-PR listet jedes angelegte Ticket.

## Was immer gilt

- Admiral und Läufe **docken nie an**. Wer andockt, sagt allein der Adapterschlüssel `merge`:
  `mensch` heißt du, `nach_gate` heißt der Andock-Akteur des Treibers nach grüner Andockprüfung.
- **Keine Antwort lockert eine Regel** der Skills.
- **Jede Entscheidung steht am Issue**, mit Herkunft (Projektregel, Skill-Empfehlung, Präzedenz mit
  Fundstelle oder eigenes Urteil mit Grund), und ist bis zum Andocken widerrufbar — auf der Brücke
  mit „Zurücknehmen“.

## Wo die Regeln stehen und wo die KI sie prüft

| Regel | Steht in | Benutzt von | Gehalten durch |
|---|---|---|---|
| Prüffragen 1–6 | `BEIM_MENSCHEN` in [`flotte/src/treiber/admiral.ts`](../flotte/src/treiber/admiral.ts), wortgleich in [`flotte/references/entscheidungsrecht.md`](../flotte/references/entscheidungsrecht.md) und [`mission/SKILL.md`](../mission/SKILL.md) | dem Admiral bei jedem Frageblock eines Laufs (Tor, Nacharbeit, Abbruch), der Triage bei jeder Frage | [`flotte/test/entscheidungsrecht.test.ts`](../flotte/test/entscheidungsrecht.test.ts), [`flotte/test/befugnisse.test.ts`](../flotte/test/befugnisse.test.ts) |
| Ticketregel | `TICKET_REGEL` in `admiral.ts`, wortgleich in `mission/SKILL.md` (Regel 3) und [`mission-nacharbeit/SKILL.md`](../mission-nacharbeit/SKILL.md) | dem Lauf bei jedem Fund außerhalb eines Pakets, der Nacharbeit in jeder Fragerunde („Sitzung, verworfen oder Ticket“), dem Admiral | [`flotte/test/tickets.test.ts`](../flotte/test/tickets.test.ts), `befugnisse.test.ts` |
| Verwerfen in der Triage | Schnittplan-Auftrag in [`flotte/src/triage.ts`](../flotte/src/triage.ts) | dem Triage-Lauf über alle Sternzeit-Notizen eines Projekts | `tickets.test.ts` |
| Herkunft jeder Entscheidung | `HERKUNFT_REGEL` in `admiral.ts` | Admiral und Triage, im Kommentar am Issue | `befugnisse.test.ts` |
| Nie andocken | Regel 1 in `mission/SKILL.md` und `entscheidungsrecht.md` | jedem Lauf, dem Admiral | Hook [`mission/scripts/guard.ps1`](../mission/scripts/guard.ps1) sperrt `gh pr merge` im Lauf |

Diese Seite ist die lesbare Fassung; maßgeblich ist der Wortlaut im Code. `befugnisse.test.ts` prüft,
dass er hier unverändert steht:

<details>
<summary>Wortlaut, wie ihn der Admiral bekommt</summary>

**Beim Menschen liegt nur:**

1. was nach außen geht und sich nicht zurückholen lässt: E-Mails und Nachrichten an Dritte, Daten an Stellen außerhalb
2. echtes Geld, das nicht vorher freigegeben ist
3. Produktivdaten ändern, wenn das nicht eindeutig beschlossen ist
4. Sicherheit und Zugänge, außer sie sind mit dem Menschen abgestimmt und in der Mission, im Ticket oder PR verankert
5. Texte und Versprechen an Kunden, die erst in der Mission entstehen (Prüfung am PR)
6. Architektur: eine neue Abhängigkeit, die nicht üblich und nicht Best Practice ist, oder ein Bruch mit einer Architekturentscheidung (ADR)

**Ticketregel:**

Ein neues Ticket nur, wenn der Mensch gebraucht wird: ein Befund, der eine Entscheidung von der Liste „Beim Menschen“ verlangt (Sicherheit und Zugänge, ein Bruch mit einer Architekturentscheidung, was nach außen geht) oder den Ablauf des Projekts ändert. Arbeit, die klar ist und nach Zeit und Umfang angemessen ist, wird in der Mission erledigt, bevor sie andockt: zuerst gefundene Fehler und was zum Missionsziel gehört. Klare Arbeit, die dafür zu groß ist, wird ein Issue mit `epic` und dem Freigabelabel, nicht `needs-triage`. Ein Wunsch ohne beobachteten Schaden wird verworfen: eine Zeile unter „Verworfen“ im Missions-PR, kein Ticket. Jedes Ticket für den Menschen trägt `needs-triage` und einen Satz zur Ursache, und der Missions-PR listet die angelegten Tickets. Eine Ticketfrage geht nicht an den Menschen.

</details>

## Weitere Grenzen

- **Kein Push auf Hauptzweig oder Basis**, nur auf das Remote des Adapters; das Hauptverzeichnis
  wird nie auf einen anderen Branch umgeschaltet. [`guard.ps1`](../mission/scripts/guard.ps1) sperrt
  das als Hook, ebenso `gh pr merge` im Lauf.
- **Keine Datenmigration, keine gelöschten oder übersprungenen Tests**, nichts über die
  Abnahmeliste hinaus.
- **Bremsen:** Ab der RAM-Schwelle startet kein neues Paket; bei gelbem Limit oder knapper Platte
  startet der Treiber nichts Neues, bei rotem hält er auch Fortsetzungen an. Das ist Mechanik, keine
  Frage an den Admiral.
- **Aufräumen löscht nur**, was nachweislich im Basiszweig liegt, nie mit `-D` oder `--force`.
- **Die Brücke steuert nichts** außer den Handlungen, die sie an den Treiber reicht; Antworten und Handlungen nur im
  LAN von einem gekoppelten Gerät mit PIN, das Recht zu handeln gibt nur der Rechner selbst (#46), unterwegs optional über Tailscale nur zur Ansicht (ADR-0006).
