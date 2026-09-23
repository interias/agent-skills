# Worktree rüsten

Ein Worktree je laufendem Ticket, gezogen vom **aktuellen** Epic-Kopf — nicht vom Startpunkt
des Laufs. Dadurch enthält jedes spätere Ticket alles bereits Gemergte, und ein Konflikt beim
Merge kann nur noch von einem gleichzeitig laufenden Ticket kommen.

Ablageort aus dem Adapter (`worktree_root`), voreingestellt ein Geschwisterverzeichnis neben dem
Repository: `../<repo>-worktrees/`. Außerhalb des Repositorys, damit `git status` im
Hauptverzeichnis sauber bleibt und keine Ignoriereinträge nötig werden.

```bash
git worktree add ../<repo>-worktrees/<nr> -b agent/<nr>-<slug> epic/<prd>-<slug>
```

**Nimm absolute Pfade, keine relativen.** Das Arbeitsverzeichnis der Shell wandert im Lauf: ein
`cd server && npm test` lässt sie in `server/` stehen, und `../<repo>-worktrees` zeigt danach ins
Leere — `git worktree remove` antwortet dann *„is not a working tree"*, obwohl `git worktree list`
den Eintrag anzeigt. Das liest sich wie ein kaputter Worktree und ist bloß der falsche Pfad.

## Was ein frischer Worktree nicht hat

Git kopiert nur, was eingecheckt ist. Ignoriertes fehlt — typischerweise genau das, was zum
Laufen nötig ist.

**Umgebungsdateien** (Adapterschlüssel `env_files`) aus dem Hauptverzeichnis kopieren.

**Abhängigkeiten** (`node_modules` o.ä.): als Verzeichnis-Junction verlinken statt neu zu
installieren. Unter Windows ohne Adminrechte möglich, aber **nicht aus Git Bash heraus**:

```powershell
New-Item -ItemType Junction -Path C:\path\to\worktree\server\node_modules `
                            -Target C:\path\to\repo\server\node_modules
```

`cmd //c "mklink /J …"` im Bash-Werkzeug scheitert mit *„Das System kann den angegebenen Pfad
nicht finden"* — MSYS schreibt `/J` als Pfad um, bevor `cmd` es sieht. Der Fehlschlag ist still
genug, um übersehen zu werden: die Umgebungsdateien liegen dann richtig, nur `node_modules` fehlt,
und der Testlauf scheitert erst viel später an einem fehlenden Modul. Prüfe nach dem Anlegen, dass
das Verzeichnis existiert.

Unter Linux/macOS `ln -s`. Die Verknüpfung ist nur zulässig, weil das Lockfile identisch ist.
**Ein Exklusivticket** — es ändert genau dieses Lockfile — bekommt stattdessen eine echte
Installation im eigenen Worktree.

**Testisolation:** die Isolationsvariable des Projekts (`test_isolation_env`) in die
Worktree-Umgebungsdatei schreiben, Wert = Ticketnummer. Ohne sie schreiben parallele Läufe in
dieselben Tabellen, und einem sporadisch roten Test kann ein Reviewer nicht ansehen, ob der
Code schlecht ist oder der Nachbar dazwischenfunkt. Gibt es keine solche Variable, ist das
Fenster genau einen Platz breit.

**Ports:** verlangt ein Ticket einen laufenden Server, je Ticket einen eigenen Port setzen.

## Der Subagent im Worktree

Erste Handlung des Subagenten: `EnterWorktree` mit `path` auf sein Verzeichnis. Zulässig ist
das, weil der Pfad in `git worktree list` steht. Schlägt es fehl, arbeitet er mit absoluten
Pfaden unterhalb dieses Verzeichnisses und setzt `Grep`/`Glob` immer explizit auf `path`.

Rechne mit dem Fehlschlag. Läuft die Sitzung im Hauptverzeichnis des Repositorys — dem
Normalfall für diesen Ablauf —, lehnt `EnterWorktree` mit *„current working directory is the
repository root, not an isolated worktree"* ab, und zwar für **jeden** Subagenten gleich. Der
Umweg über absolute Pfade ist dann kein Notbehelf, sondern der Regelweg; sag das im Auftrag, statt
sechs Agenten dieselbe Sackgasse ablaufen zu lassen.

In beiden Fällen gilt: **nichts außerhalb des eigenen Worktrees anfassen** — kein anderer
Worktree, nicht das Hauptverzeichnis, kein `git switch`, kein Branchen.

## Aufräumen

Nach dem Merge — und auch nach einem nicht abgenommenen Ticket:

```bash
git worktree remove ../<repo>-worktrees/<nr>     # ohne --force
git branch -d agent/<nr>-<slug>                  # nur nach erfolgreichem Merge
```

`git worktree remove` verweigert bei schmutzigem Zustand. Das ist eine Abbruchbedingung, kein
Anlass für `--force`: der Zustand wird berichtet, damit ein Mensch hineinschauen kann. Der
Branch eines nicht abgenommenen Tickets bleibt stehen und wird im Kommentar genannt.

Am Ende des Laufs `git worktree list` prüfen — es darf nur das Hauptverzeichnis übrig sein.
