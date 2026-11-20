# `/epic-nacharbeit` für Menschen

Arbeitet ab, was ein `/epic`-Lauf offen gelassen hat: nicht gefahrene Prüfungen, Handgriffe,
Doku-Lücken und Funde der Reviewer außerhalb der Tickets. Jeder Punkt wird einzeln entschieden,
bevor er angefasst wird. Die Anweisungen an den Agenten stehen in [`SKILL.md`](SKILL.md).

- **Aufruf:** `/epic-nacharbeit <Epic-Nr.>`, ersatzweise mit der Nummer des PRs. Ohne Argument
  nimmt der Skill den jüngsten Epic-Branch mit offenem PR. Unter dem Flotten-Treiber läuft sie von
  selbst, wenn ein Lauf offene Punkte meldet und sein PR noch offen ist (abschaltbar mit
  `--ohne-nacharbeit`); die Fragen gehen dann an den Admiral.
- **Ablauf:**
  1. **Liste zusammentragen** aus drei Quellen: Abschlusskommentar am Epic („Was das Epic offen
     lässt“) und Kommentare an den Kindern, Beschreibung des PRs, Stand im Repository. Was dort
     schon erledigt ist, fällt weg.
  2. **Sortieren:** Handgriff, Nachweis, Doku-Lücke, Fund. Ein lokaler, umkehrbarer Handgriff
     braucht keine Frage.
  3. **Fragerunden** mit Optionen und Empfehlung. Jede Runde beantwortet auch: *passt der Punkt in
     diese Sitzung, oder braucht er ein Ticket?* Ein Ticket braucht er, wenn er getestetes
     Verhalten ändert, eine Entscheidung neu treffen müsste, hier nicht prüfbar ist oder ohne
     Abnahmeliste nicht abnehmbar wäre.
  4. **Umsetzen** ohne Subagenten: auf dem Epic-Branch, solange dessen PR offen ist (eigener
     Commit, Abschnitt „Nacharbeit“ im PR), sonst auf `nacharbeit/<epic-nr>-<slug>` mit eigenem PR.
  5. **Nachdokumentieren:** Kommentar am Epic je Punkt mit Begründung, Statuslabels nachziehen,
     das Epic schließen, wenn PR gemergt und alle Kinder zu sind.
- **Die eine Regel:** kein neues Issue ohne ausdrückliche Entscheidung in einer Fragerunde. Neue
  Issues tragen das Triage-Label, nie `ready-for-agent`.
- **Nie** direkt auf den Basiszweig committen, auch nicht für einen Einzeiler; mergen tut auch
  dieser Skill nicht.
