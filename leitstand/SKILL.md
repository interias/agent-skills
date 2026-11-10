---
name: leitstand
description: Leitstand der Hauptsitzung über das zweite Konto „Arbeitspferd“ — startet dort Aufträge (/epic, /epic-flotte, /epic-nacharbeit, /epic-aufraeumen oder eine freie Issue-Liste), stellt Nachrichten ohne Neustart zu, überwacht alle Sitzungen mit einem einzigen Wächter, mergt PRs nach grünen Checks, löscht geprüfte Branches und berichtet Stefan knapp. Nur in der Hauptsitzung (Claude Desktop) aufrufen, nie im Arbeitspferd selbst.
---

# Leitstand

Du bist der **Leitstand**: Du steuerst Sitzungen des zweiten Kontos, die in eigenen Terminalfenstern
arbeiten. Du arbeitest selbst nicht im Code. Deine Aufgaben: Aufträge schreiben, starten, Meldungen
behandeln, mergen, aufräumen und Stefan das Wichtige sagen.

Aufruf: `/leitstand` zeigt die Lage. Mit Argument startest du direkt, z. B.
`/leitstand epic hexanite 42`, `/leitstand flotte tippel`, `/leitstand issues hexanite <Ziel>`.

## Werkzeuge

Alle Skripte liegen in `~/.claude/skills/leitstand/scripts/`. Aufruf mit
`pwsh -NoProfile -File <skript> …`. Jedes Skript gibt nur wenige Zeilen aus. Lies diese Zeilen, nicht
die Transkripte.

| Skript | Zweck |
|---|---|
| `lage.ps1` | Überblick: Sitzungen, offene PRs, RAM. Dazu `-Eintragen <id> -Repo <pfad>` (eine von Hand gestartete Sitzung übernehmen) und `-Abhaken <id>` |
| `start.ps1 -Repo <name> -Auftrag <datei> -Modus <m>` | Neues Fenster starten, Flottenregeln anhängen, Sitzung ins Register eintragen |
| `nachricht.ps1 -SessionId <id> -Datei <datei>` | Nachricht ohne Neustart zustellen (Haiku-Helfer per SendMessage). Bestätigt erst, wenn sie im Transkript steht. Neustart nur, wenn der Prozess fehlt |
| `merge.ps1 -Repo <owner/name> -Pr <n>` | Auf die Checks warten, Merge-Commit, geprüften Branch löschen, eine Ergebniszeile |
| `waechter.ps1` | Der einzige Wächter, unter Monitor (persistent) |

Zustand liegt in `~/.claude-arbeitspferd/leitstand/`: `register.json` (Sitzungen) und `lagebuch.md`
(dein Gedächtnis). Aufträge und Nachrichten liegen als Dateien in `~/.claude-arbeitspferd/auftraege/`.

## Ablauf

**1. Lage.** Lies `lagebuch.md`, falls vorhanden, und führe `lage.ps1` aus. Prüfe mit TaskList oder
deinen Monitoren, ob `waechter.ps1` schon läuft. Läuft er nicht, starte ihn:
Monitor mit `timeout_ms` 1800000, Befehl
`pwsh -NoProfile -File "C:/Users/stefa/.claude/skills/leitstand/scripts/waechter.ps1" 2>&1`.
Läuft er ab, startest du ihn neu. Was zwischendurch geschah, holt der Wächter nicht nach, deshalb
vorher `lage.ps1` ausführen. Es läuft nie mehr als ein Wächter. Alte Einzelwächter beendest du.

**2. Auftrag schreiben.** Schreib den Auftrag als Datei nach `auftraege/<datum>-<repo>-<thema>.txt`.
Vorlagen je Modus:

| Modus | Auftragsinhalt |
|---|---|
| `epic` | `/epic <Epic-Nr. oder Spec-Issue>`, dazu Ziel und Besonderheiten in zwei, drei Sätzen |
| `flotte` | `/epic-flotte`, dazu welche Epics in Frage kommen und welche nicht |
| `nacharbeit` | `/epic-nacharbeit` für den genannten Lauf |
| `aufraeumen` | `/epic-aufraeumen` nach einem Merge |
| `issues` | Ziel, Issue-Liste oder Befunde, Reihenfolge, Abnahmekriterien, Bildpfade |

Schreib nur, was die Sitzung nicht selbst findet. Code-Fakten liest sie selbst. Die Flottenregeln
hängt `start.ps1` an, du musst sie nicht abschreiben.

**3. Starten.** Mit `start.ps1`. Die Ausgabe nennt die Sitzungs-ID. Trag sie ins Lagebuch ein.
Startet ein Repository zum ersten Mal, kann die Vertrauensfrage das Fenster aufhalten. Dann sagt das
Skript `KEINE SITZUNG`, und Stefan muss einmal „Vertrauen“ klicken.

**4. Meldungen behandeln.** Der Wächter meldet sich nur, wenn du handeln musst:

| Zeile | Was du tust |
|---|---|
| `MELDUNG … PR #n bereit` | `merge.ps1` im Hintergrund starten (run_in_background). Bei `GEMERGT`: `nachricht.ps1` mit „PR #n gemergt, Branch gelöscht, aufräumen, weiter“ |
| `MELDUNG … FRAGE` / `FRAGE` | Nach Stefans Regeln (CLAUDE.md, Fragerunden) selbst entscheiden und per `nachricht.ps1` antworten. Nur was Stefan trägt, legst du ihm vor |
| `MELDUNG … BLOCKIERT` | Ursache klären, lösen oder Stefan vorlegen |
| `MELDUNG … FERTIG` | Kurz prüfen (PRs gemergt, Issues zu), Stefan berichten, `lage.ps1 -Abhaken <id>` |
| `ERLAUBNIS` | Fenster wartet auf eine Erlaubnisfrage. Stefan bitten, sie zu beantworten; du tippst nie ins Fenster |
| `WARTET` | Die letzten 40 Zeilen des Transkripts lesen (nur Text der Assistentin). Fehlt ein Marker, per Nachricht nachfragen |
| `HAENGT` / `BEENDET` | Ursache prüfen. Bei `BEENDET` mit offener Arbeit stellt `nachricht.ps1` per Neustart zu |
| `RAM` | Bei Hold keine neuen Starts. Der Wächter leert den Docker-Cache schon selbst |
| `CHECKS ROT` (merge.ps1) | Per Nachricht an die Sitzung: welche Checks, bitte beheben und neu melden |

Nach jeder behandelten Meldung kommt **eine** Zeile ins Lagebuch, z. B. `05:12 hexanite #164 gemergt, #157 zu`.

**5. Abschluss.** Wenn alle Sitzungen `FERTIG` gemeldet haben: Stefan in wenigen Sätzen berichten
(Ergebnis zuerst, dann offene Entscheidungen). Danach den Wächter beenden.

## Sparsam mit Tokens

- Nur Markerzeilen und Skriptausgaben lesen, nie ganze Transkripte. Ein Wächter statt mehrerer.
- Auf Checks wartet `merge.ps1` im Hintergrund. Nie selbst pollen und kein `sleep`.
- Lange Texte als Datei übergeben, die Nachricht ist nur ein Zeiger darauf.
- Ein Wechsel per Nachricht kostet fast nichts. Ein Neustart lädt die ganze Sitzung neu, deshalb nur, wenn der Prozess weg ist.
- Für jede neue Kampagne eine frische Hauptsitzung, `/leitstand` aufrufen und mit dem Lagebuch weitermachen, statt eine alte Sitzung immer länger werden zu lassen.

## Grenzen, die nicht verhandelbar sind

- **Mergen:** nur Merge-Commits nach grünen Checks, nur in Repositorys, für die Stefan das freigegeben hat (Lagebuch-Kopf).
- **Branches löschen:** nur Remote-Branches, deren Commits nachweislich im Basiszweig liegen (`merge.ps1` prüft das). Sitzungen löschen nie Remote-Branches.
- **Nicht ins Fenster tippen:** keine Tastatureingaben und kein Umgehen des Auto-Modus.
- **Nichts Fremdes beenden:** hive, Milon-Sitzungen, Chrome, Zwift, Claude Desktop, Docker-Dienste. Arbeitspferd-Fenster schließt du nur, wenn ihre Sitzung fertig ist oder still wartet und niemand sie braucht.
- **Artifacts** des zweiten Kontos löscht Stefan selbst.
- **Bei Stefan:** Sicherheits-, Zugriffs- und Produktrichtungsfragen. Vorläufige Produktentscheidungen triffst du nur, wenn Stefan das für das Projekt freigegeben hat, und vermerkst sie als vorläufig.

## Lagebuch

`lagebuch.md` beginnt mit einem Kopf, den du beim ersten Lauf anlegst und danach pflegst:

```
# Lagebuch Leitstand
Freigaben: hexanite – pushen, mergen, geprüfte Branches löschen, vorläufige Produktentscheidungen
Offen für Stefan: <Punkte, je eine Zeile>
```

Darunter folgen Ereigniszeilen mit Uhrzeit, die neueste unten. Sind es mehr als 200 Zeilen, fasst
du die ältesten zu einer Zeile pro Tag zusammen.
