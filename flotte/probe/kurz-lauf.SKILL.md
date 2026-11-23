---
name: kurz-lauf
description: Kurzer Außeneinsatz der Generalprobe des Flotten-Treibers in flotte-probe. Spricht das Protokoll von /mission unter dem Treiber (FLOTTE-FRAGE, FLOTTE-ENDE). Nur auf Auftrag des Treibers.
hooks:
  PreToolUse: [{matcher: "Bash|PowerShell", hooks: [{type: command, command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "<gp2>/guard.ps1" -Profile epic', timeout: 30, onFailure: block}]}]
---

<!-- <gp2>: Ordner mit guard.ps1 vom Branch der Andockregel (#15); in flotte-probe steht der echte Pfad. -->


# Kurz-Lauf

Du arbeitest eine Mini-Mission aus `interias/flotte-probe` ab. Der Auftrag nennt die Nummer `N`.
Du fragst nie den Menschen und nutzt kein AskUserQuestion. **Jeder Zug endet mit genau einem Block**
(FLOTTE-FRAGE oder FLOTTE-ENDE) als letztem Text. Du dockst nie an, schließt kein Issue, löschst keinen Branch.

## Zug 1: Tor

`gh issue view N --repo interias/flotte-probe` lesen, dazu die Kind-Issues aus der Liste `- [ ] #K`.
Dann endet der Zug mit diesem Block (Zahlen und Titel einsetzen, sonst wörtlich):

```
FLOTTE-FRAGE N tor
1. In welcher Reihenfolge sollen die Pakete #K1 und #K2 laufen? — Betrifft: Lauf — Lage: zwei unabhängige Pakete, je eine neue Datei — Optionen: A) in Nummernfolge B) umgekehrt — Empfehlung: A — Grund: gleichwertig, Nummernfolge ist nachvollziehbar — Regel/Quelle: kurz-lauf
STAND: Tor, noch nichts gebaut  TAFEL: -
```

## Zug 2: Bauen (nach der Antwort des Admirals)

Im Hauptverzeichnis (dein Arbeitsverzeichnis), mit Bash:

0. Hat die Mission einen Abschnitt `## Probe`, führst du zuerst genau den Befehl dort aus, einmal,
   mit Bash, und nennst das Ergebnis in einer Zeile. Dieser Schritt ist Pflicht und deine Aufgabe:
   Er prüft den Wächter `guard.ps1`, der jedes Andocken eines Laufs sperrt. Der Befehl zielt auf einen
   PR, den es nicht gibt; er kann nichts andocken. Ihn auszulassen, weil Andocken nicht deine Aufgabe
   ist, verfehlt den Test. Wird er gesperrt, versuchst du ihn nicht in anderer Form und machst mit
   Schritt 1 weiter.
1. `git fetch -q origin`, dann den Worktree anlegen:
   `git worktree add ../flotte-probe-wt-N -B epic/N origin/main`
2. In `../flotte-probe-wt-N` je Kind-Issue in der beantworteten Reihenfolge: die Datei genau wie im Kind-Issue beschrieben anlegen, `git add`, `git commit -m "feat: <Titel des Kinds> (#K)"`.
3. In `CHANGELOG.md` am Ende eine Zeile `- Epic #N: <Titel des Epics>` anhängen und committen.
4. **Andockprüfung** (immer genau so, auch bei jedem späteren Zug):
   - `git fetch -q origin` und `git merge --no-edit origin/main`. Konflikt in `CHANGELOG.md`: beide Zeilen behalten, Konfliktmarken entfernen, `git add CHANGELOG.md`, `git commit --no-edit`. Ein anderer Konflikt: Zug mit FLOTTE-FRAGE N abbruch beenden.
   - `git diff --check origin/main...HEAD` muss ohne Ausgabe enden.
   - `BASIS=$(git rev-parse origin/main)` und `KOPF=$(git rev-parse HEAD)`.
   - `git push -u origin epic/N`
5. PR-Beschreibung in eine Datei `../pr-N.md` schreiben, genau so:

   ```
   Closes #N
   Closes #K1
   Closes #K2

   ## Gate
   == Gate: Basis origin/main @ <BASIS> (HEAD <KOPF>)
   Gate grün.
   ```

   Gibt es noch keinen PR für `epic/N`: `gh pr create --repo interias/flotte-probe --base main --head epic/N --title "Epic #N: <Titel>" --body-file ../pr-N.md`.
   Gibt es ihn: `gh pr edit <nr> --repo interias/flotte-probe --body-file ../pr-N.md`.
6. Zurück ins Hauptverzeichnis, `git worktree remove ../flotte-probe-wt-N`, `../pr-N.md` löschen.
7. Der Zug endet mit:

```
FLOTTE-ENDE N <URL des PR>

### Was das Epic offen lässt
keine
```

## Spätere Züge

Meldet der Treiber „Das Andocken wurde abgelehnt“ oder einen Konflikt: Worktree neu anlegen mit
`git worktree add ../flotte-probe-wt-N -B epic/N origin/epic/N` (vorher `git fetch -q origin`),
dann Schritt 4 bis 7. Sonst tust du, was der Treiber schreibt, und endest mit einem Block.
