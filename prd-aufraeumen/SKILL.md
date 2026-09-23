---
name: prd-aufraeumen
description: Nach dem Merge des Pull Requests eines /prd-Laufs aufräumen — zurück auf den Basiszweig des Pull Requests, ziehen, dann Epic- und Ticket-Branches sowie Worktree-Reste nach Prüfung entfernen. Löscht nichts, dessen Commits nicht nachweislich im Basiszweig liegen.
---

# PRD aufräumen

Ein `/prd`-Lauf endet mit einem offenen Pull Request und lässt bewusst alles stehen: den
Epic-Branch, die Ticket-Branches nicht abgenommener Tickets, die Worktrees. Sobald ein Mensch den
Pull Request gemergt hat, räumt dieser Ablauf auf.

Zielvorgabe ist das Argument des Aufrufs: die Nummer des gemergten Pull Requests, ersatzweise die
des PRD-Issues oder der Name des Epic-Branches. Ohne Argument suchst du den jüngsten gemergten
Pull Request, dessen Quellzweig auf ein `epic/…`-Muster passt, und legst ihn zur Bestätigung vor.

**Der Branchname steht in `head.label`, nicht in `head.ref`.** Bei einem *geschlossenen* Pull
Request liefert Gitea als `head.ref` die Referenz `refs/pull/<nr>/head` — ein Filter auf
`^epic/` findet dort nichts und die Liste kommt leer zurück, obwohl gemergte Epic-PRs existieren.
`head.label` trägt weiterhin `epic/<nr>-<slug>`. Das gilt für beide Wege: beim Suchen des Laufs
und beim Ermitteln des zu löschenden Branches.

Der Projektadapter ist derselbe wie bei `/prd`: **`.claude/prd.md`** — er nennt Forge,
Hauptzweig und `worktree_root`.

---

## Die Regeln, die nicht verhandelbar sind

1. **Der Basiszweig kommt aus dem Pull Request, nicht aus dem Adapter.** Du wechselst zurück auf
   den Zweig, in den der Pull Request gemergt wurde — sein `base`. Das ist *meistens* der
   Hauptzweig, aber nicht immer: ein Epic kann von einem anderen Epic abzweigen, und dann wäre ein
   Wechsel auf den Hauptzweig eine falsche Ausgangslage für den nächsten Lauf. Lies das Feld, nimm
   es nicht an.
2. **Nichts wird gelöscht, dessen Commits nicht nachweislich im Basiszweig liegen.** Der Nachweis
   ist ein Befehl, nicht eine Annahme (siehe „Der Merge-Nachweis" unten). Ein Branch, dessen Arbeit
   nirgends sonst existiert, ist das einzige Exemplar dieser Arbeit.
3. **Kein `git branch -D`, kein `--force`.** Löschen geht mit `-d`; verweigert Git, ist das eine
   Aussage und kein Hindernis. Ein Branch, den `-d` verweigert, wird gemeldet und bleibt stehen.
4. **Ein schmutziger Worktree wird nicht entfernt.** `git worktree remove` ohne `--force`. Bleibt
   Arbeit darin liegen, gehört sie einem Menschen.
5. **Remote-Branches nur nach ausdrücklicher Zustimmung.** Ein `git push origin --delete` wirkt
   nach außen und ist für andere sichtbar. Lokales Löschen ist reversibel, das hier nicht ohne
   Weiteres.
6. **Die Junctions unter den Worktrees werden nie rekursiv gelöscht.** Das ist die eine Stelle,
   an der ein Aufräumbefehl echten Schaden anrichtet — siehe unten.

---

## Die Junction-Falle

Der wichtigste Absatz dieses Ablaufs.

`/prd` verlinkt die Abhängigkeitsverzeichnisse eines Worktrees als Verzeichnis-Junction auf das
Hauptverzeichnis, statt sie zu installieren (`link_dirs` im Adapter). Ein `rm -rf` auf einen
Worktree-Rest folgt dieser Junction und löscht **das echte `node_modules` im Hauptverzeichnis** —
das Repository, an dem gerade gearbeitet wird. Der Schaden fällt nicht sofort auf: `git status`
bleibt sauber, und erst der nächste Testlauf scheitert an einem fehlenden Modul.

Beobachtete Gestalt eines Restes: `git worktree remove` hat den Eintrag aus Git entfernt und die
verfolgten Dateien gelöscht, die Junctions aber nicht abräumen können. Zurück bleiben leere
Hüllen — nur `client/node_modules` und `server/node_modules` als Verweise, sonst nichts. In einem
Lauf über achtzehn Tickets liegen dann achtzehn solcher Hüllen unter `worktree_root`, und
`git worktree list` kennt keine davon.

Der Weg: **erst die Verweise einzeln als Verweise entfernen, dann das leere Verzeichnis.**

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

---

## Phase 0 — Feststellen, was gilt

- `.claude/prd.md` lesen, Forge-Zugang herstellen und verifizieren.
- **Den Pull Request holen und prüfen, dass er wirklich gemergt ist** (`merged`, nicht nur
  `state: closed` — ein geschlossener Pull Request kann verworfen worden sein, und dann ist der
  Epic-Branch das einzige Exemplar seiner Arbeit). Notiere aus ihm: `base`, `head`, den
  Merge-Commit.
- Ist er nicht gemergt: **anhalten und fragen.** Das ist der Regelfall für einen Fehlaufruf — der
  Ablauf heißt „nach dem Merge".
- `git status` muss sauber sein. Sonst abbrechen und fragen.
- `git fetch --prune` — das hält die Fernverfolgung aktuell und markiert die Branches, deren
  Gegenstück in der Forge schon weg ist.

## Phase 1 — Zurück auf den Basiszweig

```bash
git switch <base aus dem Pull Request>
git pull --ff-only
```

**`--ff-only`, nicht `git pull`.** Lässt sich der Basiszweig nicht vorspulen, liegt lokal etwas,
was nicht in der Forge ist. Das ist eine Aussage über deinen Arbeitsstand und kein Anlass für
einen Merge-Commit: melden und fragen.

Prüfe danach, dass der Merge-Commit des Pull Requests wirklich im Basiszweig liegt:

```bash
git merge-base --is-ancestor <merge-commit> HEAD && echo "drin"
```

Erst wenn das bestätigt ist, darf gelöscht werden. Alles Weitere hängt daran.

## Phase 2 — Die Bestandsaufnahme

Erst zählen, dann löschen. Trage vier Listen zusammen:

1. **Der Epic-Branch des Laufs**, lokal und in der Forge.
2. **Ticket-Branches des Laufs** (`agent/…` oder was der Lauf verwendet hat). Bei einem
   ordentlich verlaufenen Lauf sind sie schon weg — `/prd` löscht sie nach dem Sofortmerge. Was
   übrig ist, gehört zu einem **nicht abgenommenen** Ticket und trägt Arbeit, die im Basiszweig
   *nicht* liegt. Solche Branches werden **nicht** gelöscht; sie werden gemeldet, mit der Nummer
   ihres Tickets.
3. **Worktrees:** `git worktree list` — und getrennt davon der Inhalt von `worktree_root` auf der
   Platte. Die beiden Listen weichen voneinander ab, und die Differenz ist der eigentliche Befund:
   was Git kennt, ist ein Worktree; was nur auf der Platte liegt, ist ein Rest (siehe die
   Junction-Falle).
4. **Altlasten**, wenn der Nutzer sie einbezogen hat: lokale Branches, deren Gegenstück in der
   Forge gelöscht ist (`git branch -vv` zeigt sie als `origin/…: gone`), und Worktree-Reste
   früherer Läufe.

Lege die Listen **vor dem ersten Löschen** vor, mit dem Merge-Nachweis je Eintrag. Das ist keine
Zeremonie: die Altlastenliste ist typischerweise die längste, und sie enthält regelmäßig einen
Branch, der wie eine Leiche aussieht und einen eigenen Commit trägt.

### Der Merge-Nachweis

Je Branch, und zwar so:

```bash
git branch --merged <base>          # vollständig im Basiszweig — gefahrlos
git log --oneline <base>..<branch>  # leer heißt: kein eigener Commit
```

`git branch --merged` allein genügt nicht, wenn der Branch mit *Squash* gemergt wurde: dann liegt
sein Inhalt im Basiszweig, seine Commits aber nicht, und er erscheint als „nicht gemergt". Das ist
der Fall, in dem `-d` verweigert und ein Mensch entscheiden muss — **nicht** der Fall für `-D`.

Ein Branch mit `origin/…: gone` ist **kein** Nachweis für irgendetwas. Er sagt nur, dass sein
Gegenstück in der Forge weg ist; ob das nach einem Merge oder nach einem Verwerfen geschah, steht
dort nicht. Der Nachweis bleibt derselbe Befehl.

## Phase 3 — Löschen, jeweils mit Beleg

In dieser Reihenfolge, weil ein Branch mit angehängtem Worktree sich nicht löschen lässt:

1. **Worktrees**, die Git kennt: `git worktree remove <absoluter Pfad>` — **ohne `--force`**.
   Nimm absolute Pfade; das Arbeitsverzeichnis der Shell wandert im Lauf, und ein relativer Pfad
   liefert „is not a working tree", obwohl der Eintrag in der Liste steht. Verweigert der Befehl
   wegen schmutzigen Zustands: melden, stehen lassen.
2. **Worktree-Reste**, die nur auf der Platte liegen: nach dem Weg aus der Junction-Falle. Prüfe
   vorher, dass darin nichts anderes als die Verweise liegt — findet sich eine veränderte Datei,
   ist es kein Rest, sondern liegengebliebene Arbeit.
3. `git worktree prune` — räumt die Verwaltungseinträge zu Worktrees auf, deren Verzeichnis nicht
   mehr existiert.
4. **Lokale Branches** mit `git branch -d`. Der Epic-Branch zuletzt, nachdem alles andere weg ist.
5. **Remote-Branches** nur nach ausdrücklicher Zustimmung, und nur den Epic-Branch des gemergten
   Laufs: `git push origin --delete <branch>`. Viele Forges tun das beim Merge selbst; prüfe
   erst, ob überhaupt noch etwas da ist.

Nach jedem Schritt den Erfolg prüfen, nicht annehmen. Ein `Remove-Item` auf einen offenen Pfad
scheitert still genug, um übersehen zu werden.

## Phase 4 — Nachsehen und berichten

- `git worktree list` — nur das Hauptverzeichnis darf übrig sein, und es steht auf dem Basiszweig.
- Der Inhalt von `worktree_root` — leer oder nicht mehr vorhanden.
- `git status` — sauber.
- **`node_modules` im Hauptverzeichnis prüfen.** Das ist die Gegenprobe zur Junction-Falle: eine
  Stichprobe, dass die Abhängigkeiten noch dastehen. Fehlen sie, hat ein rekursives Löschen durch
  eine Junction gegriffen — dann sofort melden, denn der nächste Testlauf scheitert sonst an einer
  Ursache, die niemand mehr mit dem Aufräumen verbindet.
- `git branch -vv` — die verbliebenen Branches, und je Eintrag ein Wort, warum er steht.

Bericht: was gelöscht wurde (mit dem Nachweis, der es erlaubte), was **nicht** gelöscht wurde und
warum, und was ein Mensch entscheiden muss. Nicht abgenommene Ticket-Branches namentlich, mit der
Nummer ihres Tickets — sie sind der Grund, warum dieser Ablauf nicht einfach alles wegwirft.

Dieser Ablauf schreibt **nicht** in die Forge. Er verändert keinen Zustand, den ein Leser in einem
halben Jahr braucht; er räumt eine Arbeitskopie auf. Nur wenn ein nicht abgenommenes Ticket einen
Branch behält, gehört das an dessen Issue — falls `/prd` es dort nicht schon vermerkt hat.

---

## Abbruchbedingungen — anhalten und fragen

- Der Pull Request ist nicht gemergt (nur geschlossen, oder noch offen).
- Das Arbeitsverzeichnis ist nicht sauber.
- Der Basiszweig lässt sich nicht mit `--ff-only` vorspulen.
- Der Merge-Commit liegt nicht im Basiszweig.
- Ein Branch trägt Commits, die nicht im Basiszweig liegen — er bleibt stehen, ohne Ausnahme.
- Ein Worktree lässt sich nicht ohne `--force` entfernen.
- Ein Worktree-Rest enthält mehr als die Verweise auf die Abhängigkeiten.
- Ein zu löschender Branch ist gerade in einem anderen Worktree ausgecheckt.
- Es läuft noch ein `/prd`-Lauf auf demselben Repository — dann sind „Reste" keine Reste.
