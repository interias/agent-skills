# Worktrees rüsten und abräumen

Jedes laufende Paket bekommt einen eigenen Worktree, gezogen vom **aktuellen** Epic-Kopf, nicht vom
Stand zu Beginn des Laufs. Dadurch enthält jedes spätere Paket alles bereits Gemergte, und ein
Merge-Konflikt kann nur noch von einem *gleichzeitig* laufenden Paket kommen.

## Anlegen

Ablageort ist `worktree_root`, voreingestellt ein Geschwisterverzeichnis neben dem Repository:
`../<repo>-worktrees/`. Außerhalb des Repositorys bleibt `git status` im Hauptverzeichnis sauber,
und es braucht keine Ignoriereinträge. Der Pfad enthält **kein Punktverzeichnis** (`.worktrees/`,
`.claude/…`). Nennt der Adapter eines, ist das ein Punkt fürs Vorab-Tor.

```bash
git worktree add <worktree_root>/<nr> -b agent/<nr>-<slug> epic/<issue-nr>-<slug>
```

`<nr>` ist die Kindnummer, im Modus `spec` ohne Kinder `<spec>-p<k>` (`prd/SKILL.md`, Phase 3).

**Nimm absolute Pfade, keine relativen.** Das Arbeitsverzeichnis der Shell wandert im Lauf: Ein
`cd server && npm test` lässt sie in `server/` stehen, und ein relativer Worktree-Pfad zeigt danach
ins Leere. `git worktree remove` antwortet dann *„is not a working tree"*, obwohl
`git worktree list` den Eintrag anzeigt. Das liest sich wie ein kaputter Worktree und ist bloß der
falsche Pfad.

## Was ein frischer Worktree nicht hat

Git bringt nur mit, was eingecheckt ist. Ignoriertes fehlt, typischerweise genau das, was zum
Laufen nötig ist. Gerüstet wird in drei Arten:

| Adapterschlüssel | was | wie | für welches Paket |
|---|---|---|---|
| `env_files` | Umgebungsdateien | **kopieren**, nie verlinken | jedes |
| `link_dirs` | Abhängigkeitsverzeichnisse (`node_modules`, `.venv`) | Junction bzw. Symlink | nur, wenn das Paket das Modul berührt |
| `always_link` | Verzeichnisse, die jedes Paket braucht, etwa weil ein Wächter sein Werkzeug von dort zieht | Junction bzw. Symlink | jedes |

**Rüste nur, was das Paket berührt**, plus `always_link`. Welche Module ein Paket berührt, steht in
seinem `modules_section` bzw. im Schnitt des Orchestrators.

**Umgebungsdateien werden kopiert**, weil ein Worktree eigene Werte braucht: die
Isolationsvariable, gegebenenfalls einen eigenen Port. Eine verlinkte Datei würde diese Werte in
das Hauptverzeichnis und in jeden anderen Worktree schreiben.

## Verlinken statt installieren

Unter Windows geht das ohne Adminrechte, aber **nicht aus Git Bash heraus**:
`cmd //c "mklink /J …"` scheitert mit *„Das System kann den angegebenen Pfad nicht finden"*, weil
MSYS das `/J` als Pfad umschreibt, bevor `cmd` es sieht. Nimm PowerShell:

```powershell
New-Item -ItemType Junction -Path C:\…\<repo>-worktrees\<nr>\server\node_modules `
                            -Target C:\…\<repo>\server\node_modules
```

Unter Linux/macOS `ln -s`. Die Verknüpfung ist zulässig, weil das Lockfile identisch ist. Ein
**Exklusivpaket, das genau dieses Lockfile ändert** (`exclusive_paths`), bekommt stattdessen eine
echte Installation im eigenen Worktree.

**Prüfe nach dem Anlegen, dass jedes verlinkte Verzeichnis existiert.** Der Fehlschlag ist still:
Die Umgebungsdateien liegen dann richtig, nur `node_modules` fehlt, und der Testlauf scheitert erst
viel später an einem fehlenden Modul, an einer Stelle, die wie ein Codefehler aussieht.

## Isolation und Ports

**Testisolation:** Ist `test_isolation_env` gesetzt, wird diese Variable in die kopierte
Umgebungsdatei des Worktrees geschrieben, Wert = Paketnummer. Ohne sie schreiben parallele Läufe in
dieselben Tabellen, und einem sporadisch roten Test kann ein Reviewer nicht ansehen, ob der Code
schlecht ist oder der Nachbar dazwischenfunkt. **Ohne `test_isolation_env` und ohne
`isolation: none-needed` ist das Fenster ein Platz breit.**

**Ports:** Braucht ein Paket einen laufenden Server, setzt `port_env` je Paket einen eigenen Wert.
Das geht nur, weil die Umgebungsdatei eine Kopie ist.

## Der Subagent im Worktree

Erste Handlung: `EnterWorktree` mit `path` auf sein Verzeichnis. Zulässig ist das, weil der Pfad in
`git worktree list` steht. **Rechne mit dem Fehlschlag.** Läuft die Sitzung im Hauptverzeichnis des
Repositorys, dem Normalfall für diesen Ablauf, lehnt `EnterWorktree` mit *„current working
directory is the repository root, not an isolated worktree"* ab, und zwar für **jeden** Subagenten
gleich. Der Umweg über absolute Pfade unterhalb des eigenen Worktrees ist dann der Regelweg. Sag das
im Auftrag, statt drei Agenten dieselbe Sackgasse ablaufen zu lassen. `Grep` und `Glob` bekommen
immer explizit ein `path`.

In beiden Fällen bleibt der Subagent **innerhalb seines eigenen Worktrees**: Er arbeitet nur dort,
ohne `git switch` und ohne neue Branches.

## Abräumen

Nach dem Merge, und ebenso nach einem nicht abgenommenen Paket. Die Reihenfolge ist fest, weil ein
rekursives Löschen einer Junction folgt: **Am 18.09.2026 hat in KOKOS ein rekursives Löschen einer
Worktree-Hülle das echte `node_modules` im Hauptverzeichnis zerstört.** `git status` blieb sauber,
erst der nächste Testlauf scheiterte, und niemand verband die Ursache mehr mit dem Aufräumen.
Zurück blieben damals 18 Hüllen, die `git worktree list` nicht mehr kannte: `git worktree remove`
entfernt den Git-Eintrag und die verfolgten Dateien, die Junctions bleiben liegen.

1. **Sauber?** `git -C <worktree> status --porcelain` muss leer sein. Ist es das nicht, endet das
   Abräumen hier: Der Worktree bleibt stehen, das Paket gilt als **nicht abgenommen**, und sein
   Zustand wird berichtet, damit ein Mensch hineinschauen kann. Nie `--force`.
2. **Junctions einzeln entfernen**, ohne `-Recurse`, und zwar genau die, die dieser Lauf angelegt
   hat (`link_dirs` des Pakets und `always_link`):

   ```powershell
   Remove-Item -LiteralPath C:\…\<repo>-worktrees\<nr>\server\node_modules -Force
   ```

   Ohne `-Recurse` entfernt `Remove-Item` nur den Verweis. Verweigert es das mit einer Rückfrage
   nach Kindelementen, entfernt `cmd /c rmdir "<pfad>"` (ohne `/s`) ebenfalls nur den Verweis. Aus
   Git Bash heraus wird nichts davon gelöscht, auch kein `rm -rf`.
3. **Nach Reparse-Points suchen.** Die Ausgabe muss leer sein:

   ```powershell
   Get-ChildItem -LiteralPath C:\…\<repo>-worktrees\<nr> -Recurse -Force -Attributes ReparsePoint
   ```

   Ist sie nicht leer, liegt dort ein Verweis, den der Lauf nicht kennt. Dann wird nichts
   rekursiv gelöscht, und der Pfad geht in den Bericht.
4. **Worktree entfernen**, dann den Branch:

   ```bash
   git worktree remove <worktree_root>/<nr>     # ohne --force
   git branch -d agent/<nr>-<slug>              # nur nach erfolgreichem Merge
   ```

5. **Hülle prüfen.** Steht das Verzeichnis danach noch, wird Schritt 3 wiederholt. Erst wenn die
   Suche leer bleibt, darf die Hülle rekursiv weg:
   `Remove-Item -LiteralPath <pfad> -Recurse -Force`.

Der Branch eines nicht abgenommenen Pakets bleibt stehen und wird im Abschlusskommentar mit Pfad
genannt.

Am Ende des Laufs prüfen: `git worktree list` zeigt nur das Hauptverzeichnis, und unter
`worktree_root` liegt kein Verzeichnis dieses Laufs mehr, außer denen, die als nicht abgenommen
berichtet sind.
