# Worktrees rüsten und abräumen

Jedes laufende Paket bekommt einen eigenen Worktree, gezogen vom **aktuellen** Epic-Kopf, nicht vom
Stand zu Beginn des Laufs. Dadurch enthält jedes spätere Paket alles bereits Gemergte, und ein
Merge-Konflikt kann nur noch von einem *gleichzeitig* laufenden Paket kommen.

## Rüsten und Abräumen nur per Skript

Anlegen, Rüsten und Abräumen machen **ausschließlich** die drei Aktionen von
`scripts/worktree.ps1` im Skill-Verzeichnis: `Up`, `Down`, `CleanupStale`. Die Schritte von Hand
nachzubauen ist nicht zulässig, auch nicht teilweise (Ausnahme: „Worktrees ohne Manifest und Reste
auf der Platte" unten): Eine Junction aus Git Bash heraus (`ln -s`, `cmd //c mklink`) wird dort still
zur Kopie, und ein rekursives Löschen folgt einer Junction bis ins Hauptverzeichnis.

Aufruf aus Git Bash und aus PowerShell gleich, immer mit absoluten Pfaden. Das ist die eine Form,
auf die sich alle Skills beziehen:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File <skill>/scripts/worktree.ps1 -Action <Up|Down|CleanupStale> -RepoRoot <repo> ...
```

| Aktion | weitere Parameter | Wann |
|---|---|---|
| `Up` | `-Package <nr> -Branch <branch> [-From <start>] [-SessionPid <pid>]` | ein Worktree entsteht: Epic-Worktree (`-Package epic-<nr>`, `-Branch epic/<nr>-<slug>`, `-From <push_remote>/<basis>`) und jedes Paket (`-Package <nr>`, `-Branch agent/<nr>-<slug>`, `-From epic/<nr>-<slug>`) |
| `Down` | `-Package <nr>` | der Worktree ist fertig: nach Merge, nach Zurücklassen, am Ende der Nacharbeit |
| `CleanupStale` | — | Hinterlassenschaften toter Sitzungen, am Anfang von `/epic` und `/epic-aufraeumen` |

Alle drei nehmen zusätzlich `-AdapterFile <absoluter Pfad>`, **nur während der Umstellung** (unten).

Unter Linux/macOS `pwsh` statt `powershell`. Exit-Code 0 heißt erledigt und geprüft, 1 heißt
angehalten, der Grund steht auf stderr. **Bei Exit 1 meldest du die Meldung des Skripts im
Wortlaut** — auf Englisch, so wie es sie ausgibt — **und holst nichts von Hand nach.** Bei `Up`
hält das Paket an. Die Parameter und das Verhalten im Einzelnen stehen im Hilfetext des Skripts
(`Get-Help`); hier steht nur, was der Orchestrator wissen muss.

**`Down` nie aus einer Shell aufrufen, die im Worktree steht.** Sonst scheitert
`git worktree remove`, und erst ein zweites `Down` nach dem `cd` heraus räumt fertig ab.

## Anlegen: was `Up` tut

Ablageort ist `worktree_root`, voreingestellt ein Geschwisterverzeichnis neben dem Repository:
`../<repo>-worktrees/`; der Worktree liegt in `<worktree_root>/<Package>`. Außerhalb des
Repositorys bleibt `git status` im Hauptverzeichnis sauber, und es braucht keine Ignoriereinträge.
Der Pfad enthält **kein Punktverzeichnis** (`.worktrees/`, `.claude/…`); `Up` weist ihn sonst ab.
Nennt der Adapter eines, ist das ein Punkt fürs Vorab-Tor.

`<Package>` ist `<nr>` (Kindnummer, im Modus `spec` ohne Kinder `<spec>-p<k>`) oder `epic-<nr>`;
Namensschema der Branches: `epic/SKILL.md`, Phase 3. Existiert `-Branch` schon, nimmt `Up` ihn,
sonst legt es ihn von `-From` an. Existiert der Pfad schon oder gibt es ein Lock für das Paket,
bricht es ab.

`Up` liest das **Frontmatter** von `.claude/epic.md` im Hauptverzeichnis (`adapter.md`, „Form";
fehlt es, Exit 1; zur Umstellung siehe unten) und rüstet danach:

| Adapterschlüssel | was `Up` damit tut |
|---|---|
| `env_files` | kopiert sie, nie verlinkt: ein Worktree braucht eigene Werte, und eine verlinkte Datei schriebe sie ins Hauptverzeichnis und in jeden anderen Worktree. Ohne `env_files` gibt es nur eine Warnung |
| `link_dirs`, `always_link` | verlinkt **alle** — unter Windows als Junction (ohne Adminrechte), sonst als Symlink —, in jeden Worktree, ohne Einschränkung je Paket |
| `test_isolation_env` | setzt die Variable in jeder kopierten Env-Datei auf die Paketnummer; ein Wert wie „keine…" gilt als nicht gesetzt |
| `port_env` | setzt einen freien Port, je Worktree ein eigener |
| — | setzt `COMPOSE_PROJECT_NAME=<repo>-<Package>`, damit Compose-Projekte je Paket getrennt heißen und `Down` sie findet |

Verlinkt wird statt installiert, weil das Lockfile identisch ist. **Ein Paket, das genau dieses
Lockfile ändert** (`exclusive_paths`), bräuchte eine echte Installation statt des Links; **dafür
gibt es in `Up` keinen Weg. Ein solches Paket ist per `Up` nicht rüstbar** und ein Tor-Punkt
(`SKILL.md`, Phase 2c, Punkt 14). Das Skript installiert nie.

Nach dem Verlinken prüft `Up` jedes Verzeichnis darauf, dass es ein Verweis auf das erwartete
Ziel ist, und bricht bei einer Kopie ab. Die angelegten Verweise stehen in einem Manifest im
Git-Verzeichnis des Worktrees, unsichtbar für `git status`; danach richtet sich `Down`. Das Lock
liegt in `<git common dir>/epic-locks/<Package>.json` und nennt die Sitzung, die den Worktree
besitzt (standardmäßig den nächsten Vorfahren `claude`).

stdout von `Up` ist **genau eine JSON-Zeile** `{path, branch, port, isolation, project, envFiles,
lock, sessionPid, warnings}`. `path`, `port` und `isolation` gehören in den Auftrag des
Implementers; `warnings` nennst du im Plan oder auf der Tafel.

## Umstellung: Frontmatter nur auf dem Epic-Branch

Hat `.claude/epic.md` kein Frontmatter, scheitern `CleanupStale` und `Up` am Hauptverzeichnis, und
die Fassung darf dort nicht committet werden (Regel 11). Der Ausweg (#38), nach Bestätigung am
Vorab-Tor (`SKILL.md`, 2c Punkt 13):

1. Die bestätigte Fassung als Datei ins Scratchpad des Laufs schreiben.
2. `CleanupStale` (0a) und `Up` für den Epic-Worktree (0b) mit `-AdapterFile <scratchpad-datei>`.
3. Im Epic-Worktree `.claude/epic.md` durch die Fassung ersetzen und als **ersten Commit** auf dem
   Epic-Branch committen (trägt der Branch sie aus einem früheren Lauf schon, entfällt das).
4. Ab da bekommt jeder `Up`, `Down` und `CleanupStale` des Laufs `-AdapterFile
   <epic-worktree>/.claude/epic.md`, bis der Pull Request gemergt ist; danach steht das
   Frontmatter auf der Basis, und der Parameter entfällt.
5. Der Pull-Request-Body nennt die Umstellung.

`/epic-aufraeumen` und `/epic-nacharbeit`: Steht das Frontmatter nur auf dem Epic-Branch, nicht im
Hauptverzeichnis, bekommt jeder Aufruf `-AdapterFile` auf eine Kopie im Scratchpad aus
`git show <epic-branch>:.claude/epic.md` — nicht auf die Datei im Epic-Worktree: `CleanupStale`
räumt den Epic-Worktree einer toten Sitzung ab und mit ihm die Datei, und jeder weitere `Down`
scheitert dann. Steht es im Hauptverzeichnis, entfällt der Parameter. `-AdapterFile` ist kein Weg, den Adapter zu umgehen:
dieselben Prüfungen wie sonst, Frontmatter Pflicht.

## Isolation und Ports

**Testisolation:** `Up` schreibt `test_isolation_env` mit der Paketnummer in die kopierte
Umgebungsdatei. Ohne sie schreiben parallele Läufe in dieselben Tabellen, und einem sporadisch
roten Test kann ein Reviewer nicht ansehen, ob der Code schlecht ist oder der Nachbar
dazwischenfunkt. Auf einem geteilten Dienst heißt das eine Datenbank oder ein Schema je Paket
(`adapter.md`, `shared_services`). Wann das Fenster deshalb einen Platz breit bleibt: `adapter.md`,
Schlüssel `window`.

**Ports:** Braucht ein Paket einen laufenden Server, nimmt es den `port` aus dem JSON von `Up`.

**Was ein Worktree starten darf**, steht im Adapter (`worktree_may_start`; Standard: kein eigener
DB-Server). Wer außerhalb von `Up` einen Dev-Server oder Stack startet, beendet ihn am Ende des
Pakets (`epic/SKILL.md`, Regel 13); `Down` fängt den Rest ab.

## Der Subagent im Worktree

Erste Handlung: `EnterWorktree` mit `path` auf sein Verzeichnis. Zulässig ist das, weil der Pfad in
`git worktree list` steht. **Rechne mit dem Fehlschlag.** Läuft die Sitzung im Hauptverzeichnis des
Repositorys, dem Normalfall für diesen Ablauf, lehnt `EnterWorktree` mit *„current working
directory is the repository root, not an isolated worktree"* ab, und zwar für **jeden** Subagenten
gleich. Der Umweg über absolute Pfade unterhalb des eigenen Worktrees ist dann der Regelweg. Prüf
das einmal für den Lauf und schreib das Ergebnis in jeden Auftrag, statt drei Agenten dieselbe
Sackgasse ablaufen zu lassen. `Grep` und `Glob` bekommen
immer explizit ein `path`.

In beiden Fällen bleibt der Subagent **innerhalb seines eigenen Worktrees**: Er arbeitet nur dort,
ohne `git switch` und ohne neue Branches. Er ruft `Up`, `Down` und `CleanupStale` nicht auf.

## Abräumen

Nach dem Merge, und ebenso nach einem nicht abgenommenen Paket: `Down -Package <nr>`. `Down`
stoppt zuerst, was dem Worktree klar gehört (Compose-Projekte, Prozesse), prüft dann auf einen
sauberen Worktree und entfernt die Verweise einzeln, bevor Git den Worktree wegnimmt. Die
Reihenfolge ist fest, weil ein rekursives Löschen einer Junction folgt: **Am 18.09.2026 hat in
KOKOS ein rekursives Löschen einer Worktree-Hülle das echte `node_modules` im Hauptverzeichnis
zerstört.** `git status` blieb sauber, erst der nächste Testlauf scheiterte, und niemand verband die
Ursache mehr mit dem Aufräumen.

Ein **schmutziger Worktree** bricht `Down` mit Exit 1 ab: Worktree und Lock bleiben stehen, die
Prozesse sind dann schon beendet, das Paket gilt als **nicht abgenommen**, und sein Zustand wird
berichtet, damit ein Mensch hineinschauen kann. Ohne docker im PATH meldet `Down`, dass der
Compose-Schritt übersprungen ist (Exit 0).

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

**Der Epic-Worktree** (`epic-<nr>`) trägt ein Lock der Sitzung, die den Lauf führt, und lebt mit
ihr: Endet die Sitzung, räumt der nächste `CleanupStale` ihn ab, sofern er sauber ist; der Branch
bleibt. Er steht also nicht bis zum Merge des Pull Requests. `/epic-aufraeumen` räumt ihn per
`Down -Package epic-<nr>` ab, falls er noch steht, und kommt mit seinem Fehlen zurecht; wer danach
auf dem Epic-Branch weiterarbeitet (`/epic-nacharbeit`), legt ihn mit `Up` auf dem vorhandenen
Branch neu an.

Am Ende des Laufs prüfen: `git worktree list` zeigt das Hauptverzeichnis und den Epic-Worktree, und
unter `worktree_root` liegt kein Verzeichnis dieses Laufs mehr, außer `epic-<nr>` und denen, die
als nicht abgenommen berichtet sind.

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
