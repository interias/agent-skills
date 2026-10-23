# Worktrees rüsten und abräumen

Jedes laufende Paket bekommt einen eigenen Worktree, gezogen vom **aktuellen** Epic-Kopf, nicht vom
Stand zu Beginn des Laufs. Dadurch enthält jedes spätere Paket alles bereits Gemergte, und ein
Merge-Konflikt kann nur noch von einem *gleichzeitig* laufenden Paket kommen.

## Rüsten und Abräumen nur per Skript

Anlegen, Rüsten und Abräumen macht **ausschließlich** `scripts/worktree.ps1` im Skill-Verzeichnis.
Die Schritte von Hand nachzubauen ist nicht zulässig, auch nicht teilweise (Ausnahme: „Worktrees
ohne Manifest und Reste auf der Platte" unten): Eine Junction aus Git
Bash heraus (`ln -s`, `cmd //c mklink`) wird dort still zur Kopie, und ein rekursives Löschen folgt
einer Junction bis ins Hauptverzeichnis. **Scheitert das Skript, hält das Paket an** und wird
berichtet, mit der Meldung des Skripts im Wortlaut. Es wird nichts von Hand repariert.

Aufruf aus Git Bash und aus PowerShell gleich, immer mit absoluten Pfaden:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/worktree.ps1 -Action Add   -RepoRoot <repo> -WorktreePath <worktree_root>/<nr>   -Branch agent/<nr>-<slug> -From epic/<issue-nr>-<slug>   -LinkDirs server/node_modules,client/node_modules -EnvFiles server/.env   -SetEnv server/.env:<test_isolation_env>=<nr>,server/.env:<port_env>=<port>

powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/worktree.ps1 -Action Remove   -RepoRoot <repo> -WorktreePath <worktree_root>/<nr>
```

Unter Linux/macOS `pwsh` statt `powershell`. Exit-Code 0 heißt erledigt und geprüft, 1 heißt
angehalten, der Grund steht auf stderr. Das Skript liest den Adapter nicht: Welche Verzeichnisse
verlinkt und welche Variablen gesetzt werden, entscheidest du und gibst es als Parameter mit.

## Anlegen

Ablageort ist `worktree_root`, voreingestellt ein Geschwisterverzeichnis neben dem Repository:
`../<repo>-worktrees/`. Außerhalb des Repositorys bleibt `git status` im Hauptverzeichnis sauber,
und es braucht keine Ignoriereinträge. Der Pfad enthält **kein Punktverzeichnis** (`.worktrees/`,
`.claude/…`). Nennt der Adapter eines, ist das ein Punkt fürs Vorab-Tor.

`<nr>` und die Branchnamen: `epic-schlank/SKILL.md`, Phase 3.
Existiert `-Branch` schon, nimmt das Skript ihn, sonst legt es ihn von `-From` an. Existiert der
Pfad schon, bricht es ab.

**Nimm absolute Pfade, keine relativen.** Das Arbeitsverzeichnis der Shell wandert im Lauf: Ein
`cd server && npm test` lässt sie in `server/` stehen, und ein relativer Pfad zeigt danach ins
Leere. Das Skript weist relative Pfade ab.

## Was ein frischer Worktree nicht hat

Git bringt nur mit, was eingecheckt ist. Ignoriertes fehlt, typischerweise genau das, was zum
Laufen nötig ist. Gerüstet wird in drei Arten:

| Adapterschlüssel | was | Parameter | für welches Paket |
|---|---|---|---|
| `env_files` | Umgebungsdateien, **kopiert**, nie verlinkt | `-EnvFiles` | jedes |
| `link_dirs` | Abhängigkeitsverzeichnisse (`node_modules`, `.venv`), verlinkt | `-LinkDirs` | nur, wenn das Paket das Modul berührt |
| `always_link` | Verzeichnisse, die jedes Paket braucht, etwa weil ein Wächter sein Werkzeug von dort zieht | `-LinkDirs` | jedes |

**Rüste nur, was das Paket berührt**, plus `always_link`. Welche Module ein Paket berührt, steht in
seinem `modules_section` bzw. im Schnitt des Orchestrators.

**Umgebungsdateien werden kopiert**, weil ein Worktree eigene Werte braucht: die
Isolationsvariable, gegebenenfalls einen eigenen Port. Eine verlinkte Datei würde diese Werte in
das Hauptverzeichnis und in jeden anderen Worktree schreiben.

**Verlinkt wird statt installiert**, unter Windows als Junction (ohne Adminrechte), sonst als
Symlink. Das ist zulässig, weil das Lockfile identisch ist. Ein **Exklusivpaket, das genau dieses
Lockfile ändert** (`exclusive_paths`), bekommt das Verzeichnis nicht in `-LinkDirs`, sondern eine
echte Installation, die du nach dem Anlegen im Worktree fährst. Das Skript installiert nie.

Nach dem Verlinken prüft das Skript jedes Verzeichnis darauf, dass es ein Verweis auf das erwartete
Ziel ist, und bricht bei einer Kopie ab. Die angelegten Verweise schreibt es in ein Manifest im
Git-Verzeichnis des Worktrees, unsichtbar für `git status`. Danach richtet sich das Abräumen.

## Isolation und Ports

**Testisolation:** Ist `test_isolation_env` gesetzt, gehört die Variable mit dem Wert Paketnummer
über `-SetEnv` in die kopierte Umgebungsdatei. Ohne sie schreiben parallele Läufe in dieselben
Tabellen, und einem sporadisch roten Test kann ein Reviewer nicht ansehen, ob der Code schlecht ist
oder der Nachbar dazwischenfunkt. Wann das Fenster deshalb einen Platz breit bleibt:
`adapter.md`, Schlüssel `window`.

**Ports:** Braucht ein Paket einen laufenden Server, setzt `-SetEnv` den `port_env` je Paket auf
einen eigenen Wert. Das geht nur, weil die Umgebungsdatei eine Kopie ist.

## Der Subagent im Worktree

Erste Handlung: `EnterWorktree` mit `path` auf sein Verzeichnis. Zulässig ist das, weil der Pfad in
`git worktree list` steht. Läuft die Sitzung im Hauptverzeichnis des
Repositorys, dem Normalfall für diesen Ablauf, lehnt `EnterWorktree` mit *„current working
directory is the repository root, not an isolated worktree"* ab, und zwar für **jeden** Subagenten
gleich. Der Umweg über absolute Pfade unterhalb des eigenen Worktrees ist dann der Regelweg. Prüf
das einmal für den Lauf und schreib das Ergebnis in jeden Auftrag. `Grep` und `Glob` bekommen
immer explizit ein `path`.

In beiden Fällen bleibt der Subagent **innerhalb seines eigenen Worktrees**: Er arbeitet nur dort,
ohne `git switch` und ohne neue Branches.

## Abräumen

Nach dem Merge, und ebenso nach einem nicht abgenommenen Paket: `worktree.ps1 -Action Remove`. Die
Reihenfolge darin ist fest, weil ein rekursives Löschen einer Junction folgt: **Am 18.09.2026 hat in
KOKOS ein rekursives Löschen einer Worktree-Hülle das echte `node_modules` im Hauptverzeichnis
zerstört**, bei sauberem `git status`, sodass erst der nächste Testlauf scheiterte und niemand die
Ursache mehr mit dem Aufräumen verband.

1. **Sauber?** Ist `git status --porcelain` im Worktree nicht leer, bricht das Skript ab: Der
   Worktree bleibt stehen, das Paket gilt als **nicht abgenommen**, und sein Zustand wird berichtet,
   damit ein Mensch hineinschauen kann.
2. **Verweise aus dem Manifest einzeln entfernen**, ohne Rekursion, und gegenprüfen, dass das Ziel
   unverändert ist. Ohne Manifest entfernt das Skript nichts (dann gilt „Worktrees ohne Manifest und Reste auf der
   Platte" unten).
3. **Nach Reparse-Points suchen.** Liegt noch ein Verweis darin, den das Manifest nicht kennt, wird
   nichts rekursiv gelöscht, und der Pfad steht in der Meldung.
4. **`git worktree remove`** ohne `--force`.
5. **Hülle prüfen.** Steht das Verzeichnis danach noch, wird erneut gesucht und erst bei leerem
   Ergebnis rekursiv gelöscht.

**Den Branch löscht das Skript nie.** Das bleibt bei dir, weil es vom Ausgang des Pakets abhängt:

```bash
git branch -d agent/<nr>-<slug>              # nur nach erfolgreichem Merge ohne Revert
```

Der Branch eines nicht abgenommenen Pakets bleibt stehen und wird im Abschlusskommentar mit Pfad
genannt.

**Nach einem Revert bleibt der Branch ebenfalls stehen.** Wurde der Sofortmerge mit
`git revert -m 1` zurückgenommen, wird nur der Worktree abgeräumt. `git branch -d` würde gelingen,
weil der Branch gemergt ist, und damit die Arbeit verlieren: Ein erneuter Merge bringt die Änderung
nicht zurück, dafür braucht es den Revert des Reverts. Was der Kommentar am Paket nennt: `SKILL.md`,
„Zurücklassen".

Am Ende des Laufs prüfen: `git worktree list` zeigt das Hauptverzeichnis und den Epic-Worktree, und
unter `worktree_root` liegt kein Verzeichnis dieses Laufs mehr, außer `epic-<nr>` und denen, die
als nicht abgenommen berichtet sind. Den Epic-Worktree räumt `/epic-aufraeumen` nach dem Merge des
Pull Requests ab, mit demselben Skript.

### Worktrees ohne Manifest und Reste auf der Platte

Das Skript räumt nur, was ein Manifest kennt. Zwei Fälle bleiben, in denen der Weg von Hand nötig
wird: ein Worktree aus der Zeit vor dem Skript (das Skript bricht ab, weil **kein Manifest** da ist)
und ein Rest, den Git nicht mehr kennt und der nur noch auf der Platte liegt. In beiden gilt
dieselbe Reihenfolge wie im Skript: **erst die Verweise einzeln als Verweise entfernen**, dann
nach übrigen Reparse-Points suchen (unten), und erst danach den Rest wegnehmen — bei einem
Worktree ohne Manifest mit `git worktree remove <absoluter Pfad>` ohne `--force`, bei einem Rest,
den Git nicht mehr kennt, durch Löschen des leeren Verzeichnisses (letzte Zeile des Beispiels).

**Gestalt eines Restes.** `git worktree remove` hat den Eintrag aus Git entfernt und die
verfolgten Dateien gelöscht, die Junctions aber nicht abräumen können. Zurück bleiben leere
Hüllen — nur `client/node_modules` und `server/node_modules` als Verweise, sonst nichts. In einem
Lauf über achtzehn Tickets liegen dann achtzehn solcher Hüllen unter `worktree_root`, und
`git worktree list` kennt keine davon. Prüfe vor dem Entfernen, dass darin nichts anderes als die
Verweise liegt: eine veränderte Datei macht aus dem Rest liegengebliebene Arbeit.

```powershell
# recursive=false kann per Definition nicht durch die Junction laufen: entweder der Link
# verschwindet, oder der Aufruf wirft. Das Ziel bleibt in jedem Fall unberührt.
[System.IO.Directory]::Delete('C:\pfad\zum\rest\server\node_modules', $false)
[System.IO.Directory]::Delete('C:\pfad\zum\rest\client\node_modules', $false)
Remove-Item -Path C:\pfad\zum\rest -Recurse -Force -Confirm:$false   # jetzt gefahrlos
```

**Nicht `Remove-Item -Force` für die Junction selbst.** PowerShell 5.1 sieht den *Inhalt* hinter
dem Verweis und fragt „enthält Elemente. Möchten Sie fortfahren?" — im NonInteractive-Modus
scheitert der Aufruf dann mit *„Lese- und Eingabeaufforderungsfunktionen sind nicht verfügbar"*,
und zwar für jeden Verweis. Das ist harmlos, solange die Prüfung unten davor steht (sie verhindert
dann das rekursive Löschen), aber es räumt nichts auf. `Directory.Delete` mit `$false` stellt die
Frage nicht.

Prüfe **vor** jedem rekursiven Löschen, dass kein Verweis mehr darin liegt:

```powershell
Get-ChildItem C:\pfad\zum\rest -Recurse -Force -Attributes ReparsePoint | Select-Object FullName
```

Ist die Ausgabe leer, ist das Verzeichnis gefahrlos. Ist sie es nicht, **lösche nicht rekursiv** —
entferne erst die genannten Verweise. Diese Prüfung ist die eigentliche Sicherung: sie muss auch
dann greifen, wenn das Entfernen eines Verweises fehlgeschlagen ist.

**Zähl die echten Abhängigkeiten vorher und nachher.** `(Get-ChildItem <repo>\server\node_modules
-Force).Count` vor dem ersten und nach dem letzten Löschen — gleiche Zahl heißt, keine Junction
wurde durchlaufen. Eine Stichprobe auf ein einzelnes Paket sagt das nicht: sie bliebe auch dann
wahr, wenn die Hälfte fehlt.

Unter Linux und macOS sind es Symlinks: `rm` auf den Link selbst (nie `rm -rf` auf den Elternpfad,
solange der Link darin liegt), dann das Verzeichnis. `find <pfad> -type l` listet sie.
