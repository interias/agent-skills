---
name: kurz-lauf
description: Kurzer Epic-Lauf der Generalprobe des Flotten-Treibers in flotte-probe. Spricht das Protokoll von /epic unter dem Treiber (FLOTTE-FRAGE, FLOTTE-ENDE). Nur auf Auftrag des Treibers.
---

# Kurz-Lauf

Du arbeitest ein Mini-Epic aus `interias/flotte-probe` ab. Der Auftrag nennt die Nummer `N`.
Du fragst nie den Menschen und nutzt kein AskUserQuestion. **Jeder Zug endet mit genau einem Block**
(FLOTTE-FRAGE oder FLOTTE-ENDE) als letztem Text. Du mergst nie, schließt kein Issue, löschst keinen Branch.

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

1. `git fetch -q origin`, dann den Worktree anlegen:
   `git worktree add ../flotte-probe-wt-N -B epic/N origin/main`
2. In `../flotte-probe-wt-N` je Kind-Issue in der beantworteten Reihenfolge: die Datei genau wie im Kind-Issue beschrieben anlegen, `git add`, `git commit -m "feat: <Titel des Kinds> (#K)"`.
3. In `CHANGELOG.md` am Ende eine Zeile `- Epic #N: <Titel des Epics>` anhängen und committen.
4. **Gate** (immer genau so, auch bei jedem späteren Zug):
   - `git fetch -q origin` und `git merge --no-edit origin/main`. Konflikt in `CHANGELOG.md`: beide Zeilen behalten, Konfliktmarken entfernen, `git add CHANGELOG.md`, `git commit --no-edit`. Ein anderer Konflikt: Zug mit FLOTTE-FRAGE N abbruch beenden.
   - `git diff --check origin/main...HEAD` muss ohne Ausgabe enden.
   - `BASIS=$(git rev-parse origin/main)` und `KOPF=$(git rev-parse HEAD)`.
   - `git push -u origin epic/N`
5. PR-Beschreibung in eine Datei `../pr-N.md` schreiben, genau so:

   ```
   Closes #N

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

Meldet der Treiber „Der Merge wurde abgelehnt“ oder einen Konflikt: Worktree neu anlegen mit
`git worktree add ../flotte-probe-wt-N -B epic/N origin/epic/N` (vorher `git fetch -q origin`),
dann Schritt 4 bis 7. Sonst tust du, was der Treiber schreibt, und endest mit einem Block.
