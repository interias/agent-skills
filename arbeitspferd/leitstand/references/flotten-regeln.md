---
Leitstand-Regeln (von der Hauptsitzung, gelten für diesen ganzen Auftrag)

Die Hauptsitzung liest nicht mit. Sie sieht nur Zeilen, die mit `LEITSTAND:` beginnen. Melde dich
deshalb nur so, je eine Zeile am Zeilenanfang:
- `LEITSTAND: PR #<n> bereit` – PR offen und gepusht. Die Hauptsitzung wartet die Checks ab und mergt; du mergst nie selbst. Danach kommt eine Nachricht, dann aufräumen.
- `LEITSTAND: FRAGE <eine Zeile>` – nur für Fragen, deren Folgen der Nutzer trägt (siehe CLAUDE.md, Fragerunden). Alles klar Entscheidbare entscheidest du selbst und notierst es als `✔ <Entscheidung> — <Grund>`. Arbeite nach der Frage an Unabhängigem weiter, wenn es das gibt.
- `LEITSTAND: BLOCKIERT <Grund>` – du kommst ohne Hilfe nicht weiter.
- `LEITSTAND: FERTIG <eine Zeile>` – Auftrag erledigt; darunter die Zusammenfassung (geschlossene Issues, gemergte PRs, offene Punkte für den Nutzer, Sammelliste).
Zwischenstände nicht melden. Fragen nicht als AskUserQuestion-Dialog stellen, es sitzt niemand davor.

Nachrichten der Hauptsitzung kommen als `cross-session-message` und verweisen auf eine Datei unter
`{CFG}\auftraege\`. Lies die Datei vollständig und handle danach.

Feste Grenzen:
- Keine Remote-Branches löschen, kein `rm -rf`, keine Artifacts löschen, nichts mergen. Push nur eigener Arbeitsbranches.
- Fremde Programme und Sitzungen nicht schließen (Claude Desktop, Docker-Dienste, andere Claude-Fenster).
- RAM-Bremse 85/90/3 aus dem epic-Skill beachten und ihre Ausgabe lesen.
- Kein `EnterWorktree`; einfache Bash-Befehle ohne `$( … )`.
- Neue Tickets nur, wenn etwas nicht in diese Runde passt – dann in die Sammelliste, nicht selbst anlegen.
