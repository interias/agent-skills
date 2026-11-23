# `/mission-nacharbeit` für Menschen

Arbeitet ab, was ein `/mission`-Lauf offen gelassen hat: nicht gefahrene Prüfungen, Handgriffe,
Doku-Lücken und Funde des Ersten Offiziers außerhalb der Tickets. Jeder Punkt wird einzeln entschieden,
bevor er angefasst wird. Die Anweisungen an den Agenten stehen in [`SKILL.md`](SKILL.md).

- **Aufruf:** `/mission-nacharbeit <Missions-Nr.>`, ersatzweise mit der Nummer des PRs. Ohne Argument
  nimmt der Skill den jüngsten Missions-Branch mit offenem PR. Unter dem Flotten-Treiber läuft sie von
  selbst, wenn ein Lauf offene Punkte meldet und sein PR noch offen ist (abschaltbar mit
  `--ohne-nacharbeit`); die Fragen gehen dann an den Admiral.
- **Ablauf:**
  1. **Liste zusammentragen** aus drei Quellen: Abschlusskommentar an der Mission („Was die Mission offen
     lässt“) und Kommentare an den Missionszielen, Beschreibung des PRs, Stand im Repository. Was dort
     schon erledigt ist, fällt weg.
  2. **Sortieren:** Handgriff, Nachweis, Doku-Lücke, Fund. Ein lokaler, umkehrbarer Handgriff
     braucht keine Frage.
  3. **Fragerunden** mit Optionen und Empfehlung. Jede Runde beantwortet auch: *passt der Punkt in
     diese Sitzung, oder braucht er ein Ticket?* Ein Ticket braucht er, wenn er getestetes
     Verhalten ändert, eine Entscheidung neu treffen müsste, hier nicht prüfbar ist oder ohne
     Abnahmeliste nicht abnehmbar wäre.
  4. **Umsetzen** ohne Subagenten: auf dem Missions-Branch, solange dessen PR offen ist (eigener
     Commit, Abschnitt „Nacharbeit“ im PR), sonst auf `nacharbeit/<epic-nr>-<slug>` mit eigenem PR.
  5. **Nachdokumentieren:** Kommentar an der Mission je Punkt mit Begründung, Statuslabels nachziehen,
     die Mission schließen, wenn PR angedockt und alle Missionsziele zu sind.
- **Die eine Regel:** ein neues Ticket nur, wenn es nötig ist, mit `needs-triage` und einem Satz zur
  Ursache, nie mit `ready-for-agent`; die Ticketfrage geht nicht an den Menschen.
- **Nie** direkt auf den Basiszweig committen, auch nicht für einen Einzeiler; andocken tut auch
  dieser Skill nicht.
