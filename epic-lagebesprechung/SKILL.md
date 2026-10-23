---
name: epic-lagebesprechung
description: Lagebesprechung im laufenden /epic-flotte- oder /epic-Chat — alles, was beim Menschen liegt, sammeln (Fragen der Läufe, vorläufige Entscheidungen, Triage-Tickets der Epics), in Fragerunden mit Empfehlung klären, Antworten sofort an die Läufe geben, Tickets nachdokumentieren und auf ready-for-agent heben. Optional; der Ablauf des Laufs bleibt unverändert.
disable-model-invocation: true
---

# Epic-Lagebesprechung

Der Mensch ruft diesen Skill im Chat eines laufenden **Admirals** (`/epic-flotte`) oder
**Orchestrators** (`/epic`) auf, wenn er Zeit hat. Bis dahin hat sich angestaut, was nur er
entscheidet: Fragen, auf die Läufe warten, vorläufige Entscheidungen, Tickets, die in Triage
hängen. Die Lagebesprechung holt all das in **einer** Sitzung ab, statt zu warten, bis es am Ende
eines Zugs einzeln gefragt wird.

Sie ist ein **Einschub**: Du bleibst Admiral bzw. Orchestrator, mit allen Regeln deines Skills,
und benutzt nur dessen Mechanismen — Antwort an den Lauf, Forge-Kommentar, Tafel, Logbuch. Nach
der Lagebesprechung arbeitest du weiter wie vorher; was offen blieb, fragst du so, wie dein Skill
es ohnehin vorsieht. Code, Commits und Branches berührt sie nicht.

Ohne laufenden Admiral oder Orchestrator in diesem Chat gibt es nichts zu besprechen: sag das in
einem Satz und verweise für die offenen Punkte eines abgeschlossenen Laufs auf `/epic-nacharbeit`.

Adapter, Labels und Forge-Zugang sind die des laufenden Skills (`.claude/epic.md`,
`epic/references/adapter.md`, `epic/references/forge.md`). Labelnamen stehen hier mit ihren
Standardwerten; es gelten die des Adapters.

## 1 — Lage sammeln

Vier Quellen, in dieser Rangfolge. Die Rangfolge ist auch die Reihenfolge der Vorlage:
**Blockierendes zuerst.**

1. **Fragen, auf die ein Lauf wartet.** Unter `/epic-flotte`: offene `FLOTTE-FRAGE`n aus der
   rechten Spalte des Entscheidungsrechts — Flottentafel „Beim Menschen", `questions` im
   Flottenlogbuch. Unter `/epic`: ein offenes Vorab-Tor oder eine Abbruchbedingung.
2. **Vorläufige Entscheidungen** ohne Bestätigung: Forge-Kommentare „Vorläufig entschieden von
   /epic-flotte", noch ohne „bestätigt vom Menschen" oder „gekippt vom Menschen".
3. **Triage-Tickets** der Epics dieses Chats — laufende und anstehende: Kinder mit
   `needs-triage` oder `needs-info`, ohne `ready-for-agent`, oder ohne `acceptance_section` bzw.
   `verification_section`. Den Grund liefert oft der Überspringen-Kommentar des Laufs am Ticket.
   `wontfix` ist bereits entschieden und bleibt außen vor.
4. **Eigene Entscheidungen** des Admirals seit der letzten Vorlage — keine Fragen, nur zum Kippen.

Glut-Punkte und offene Punkte abgeschlossener Läufe gehören zu `/epic-nacharbeit`, nicht hierher.

**Jeden Punkt an Forge und Repository nachprüfen**, bevor er auf die Liste kommt: Ist die Frage
inzwischen beantwortet, das Label gesetzt, der Abschnitt ergänzt? Für Triage-Tickets beschaffst du
die Fakten für einen Antwortvorschlag selbst — Body, Kommentare, ADRs, Vokabulardatei,
`out_of_scope_dir`, Präzedenz nach dem Entscheidungsrecht von `/epic-flotte`; bei mehr als einer
Handvoll Tickets gebündelt an `epic-kundschafter`. Die Frage an den Menschen ist dann die
Entscheidung, nie die Recherche.

Fertig, wenn jeder Punkt einer der vier Quellen zugeordnet und nachgeprüft ist. Ist die Liste
leer: ein Satz „Nichts liegt bei dir", und zurück zum normalen Ablauf.

## 2 — Fragerunden

Nach dem Frontier-Verfahren aus `grilling` (Skill aus `mattpocock-skills`, wie in
`epic-nacharbeit`, Phase 2), gestellt nach `epic/SKILL.md` („Wie gefragt wird").
`AskUserQuestion` ist hier richtig: Der Mensch hat die Lagebesprechung selbst
aufgerufen und sitzt davor.

- **Vor der ersten Frage** die ✔-Liste aus Quelle 4, in der Form von `epic-flotte/SKILL.md`,
  „Den Menschen fragen".
- **Je Frage** das Epic und das Ticket als Link; die Empfehlung des Laufs neben deiner und eine
  vorläufige Entscheidung wie dort.
- **Je Triage-Ticket** fragst du, was zur Freigabe fehlt — Abnahmekriterien, Verifikationsweg,
  Abgrenzung, die offene Sachfrage aus `needs-info` — jeweils mit deinem ausformulierten Vorschlag
  als Empfehlung. „Verwerfen" ist immer eine Option.

**Wirksam nach jeder Runde**, nicht erst am Ende — ein blockierter Lauf wartet nicht auf die
ganze Lagebesprechung. Die Antwort des Menschen ist die ausdrückliche Entscheidung:

- Antwort auf eine wartende Frage → an den Lauf, so wie dein Skill sonst antwortet (unter
  `/epic-flotte` per `SendMessage`; unter `/epic` setzt du selbst fort, sobald die
  Lagebesprechung endet).
- Bestätigt oder gekippt → Forge-Kommentar „bestätigt vom Menschen" bzw. „gekippt vom Menschen:
  <neue Option>" am Issue der vorläufigen Entscheidung; ein Veto geht nach „Vorläufig mit Veto"
  (`epic-flotte/SKILL.md`) an den Lauf.
- Erledigte Punkte verlassen „Beim Menschen" und `questions` — was hier beantwortet ist, fragst du
  danach nicht noch einmal.

Fertig, wenn die Frontier leer ist. Dann legst du die geplanten Ticketänderungen als Liste vor
(Ticket, was in den Body kommt, welches Label) und wartest auf die Bestätigung.

## 3 — Tickets nachdokumentieren

Erst nach der Bestätigung, je Ticket:

1. **Body fortschreiben.** Der Implementer liest den Body als Scope; die Entscheidung gehört in den
   Abschnitt, den sie betrifft (`acceptance_section`, `verification_section`, sonst den passenden
   aus dem Adapter). Body per PATCH aus einer Datei (`epic/references/forge.md`,
   „Stolperstellen"), danach einmal nachlesen.
2. **Kommentar**, damit die Body-Änderung eine Herkunft hat:

   ```
   **Entschieden vom Menschen in /epic-lagebesprechung** — <Frage in einem Satz>
   Entscheidung: <…>
   Body: <welcher Abschnitt sich wie geändert hat>
   ```

   Unterschrift wie sonst in diesem Chat (unter `/epic-flotte` die des Admirals).
3. **Freigabe prüfen und setzen.** Freigegeben wird nur, was `/epic` aufnehmen würde:
   `acceptance_section` und `verification_section` vorhanden, kein `skip_label` mehr nötig. Dann
   `needs-triage`/`needs-info` entfernen und `ready-for-agent` setzen. Besteht ein Ticket die Prüfung
   nicht, bleibt es in Triage, und der Kommentar sagt, was fehlt.
4. **Läuft das Epic des Tickets schon**, nimmt der Lauf es nicht mehr auf — `/epic` liest die Kinder
   nur in Phase 1. Der Kommentar bekommt die Zeile „Freigegeben nach Phase 1 von Lauf #<epic>;
   aufgenommen vom nächsten Lauf." Ein anstehendes Epic nimmt es regulär auf.
5. **Verworfen:** `wontfix` setzen, Grund in den Kommentar. Geschlossen wird ein Issue nur, wenn der
   Mensch das ausdrücklich gesagt hat.

Fertig, wenn jedes Ticket der Liste nachgelesen ist: Body, Kommentar und Labels stehen in der Forge.

## 4 — Abschluss

Kurz an den Menschen, in dieser Reihenfolge: was entschieden wurde, welche Läufe wieder laufen,
welche Tickets freigegeben sind (mit dem Hinweis, wenn erst der nächste Lauf sie aufnimmt), was
offen blieb. Unter `/epic-flotte` Flottentafel und Flottenlogbuch im selben Zug fortschreiben.

Dann arbeitest du als Admiral bzw. Orchestrator weiter, wo du warst.
