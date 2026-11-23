---
name: mission-aufraeumen
description: Nach dem Andocken des Pull Requests eines Außeneinsatzes aufräumen — den Basiszweig des Pull Requests holen, ohne das Hauptverzeichnis umzuschalten, dann Missions-Worktree, Missions- und Ticket-Branches sowie Worktree-Reste nach Prüfung entfernen. Löscht nichts, dessen Commits nicht nachweislich im Basiszweig liegen.
hooks:
  PreToolUse: [{matcher: "Bash|PowerShell", hooks: [{type: command, command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME/.claude/skills/mission/scripts/guard.ps1" -Profile aufraeumen', timeout: 30, onFailure: block}]}]
---

# Mission aufräumen

Ein Außeneinsatz (`/mission`) endet mit einem offenen Pull Request und lässt bewusst alles stehen: den
Missions-Branch, die Ticket-Branches nicht abgenommener Tickets, die Worktrees. Sobald ein Mensch den
Pull Request angedockt hat, räumt dieser Ablauf auf.

Zielvorgabe ist das Argument des Aufrufs: die Nummer des angedockten Pull Requests, ersatzweise die
der Mission oder der Name des Missions-Branches. Ohne Argument suchst du den jüngsten angedockten
Pull Request, dessen Quellzweig auf ein `epic/…`-Muster passt, und legst ihn zur Bestätigung vor.

**Der Branchname steht in `head.label`, nicht in `head.ref`.** Bei einem *geschlossenen* Pull
Request liefert Gitea als `head.ref` die Referenz `refs/pull/<nr>/head` — ein Filter auf
`^epic/` findet dort nichts und die Liste kommt leer zurück, obwohl angedockte Missions-PRs existieren.
`head.label` trägt weiterhin `epic/<nr>-<slug>`. Das gilt für beide Wege: beim Suchen des Laufs
und beim Ermitteln des zu löschenden Branches.

Der Projektadapter ist derselbe wie bei `/mission`: **`.claude/epic.md`** — er nennt Forge,
`base_branch` als Standardwert und `worktree_root`. Maßgeblich für das Löschen ist trotzdem immer
die `base` des Pull Requests (Regel 1), nie der Adapter-Wert.

Jede Rückfrage — Bestätigung des gefundenen Pull Requests, jede Abbruchbedingung — stellst du nach
`mission/SKILL.md` („Wie gefragt wird"). Die Zustimmung zum Löschen eines Remote-Branches holt der
Hook (Regel 5).

---

## Die Regeln, die nicht verhandelbar sind

1. **Der Basiszweig kommt aus dem Pull Request, nicht aus dem Adapter.** Geholt und geprüft
   wird der Zweig, in den der Pull Request angedockt wurde — sein `base` —, per `git fetch` und gegen
   den Fernzweig, ohne das Hauptverzeichnis umzuschalten (Phase 1, `mission/SKILL.md` Regel 11). Das
   ist *meistens* der Hauptzweig, aber nicht immer: eine Mission kann von einer anderen Mission abzweigen,
   und dann wäre ein Nachweis gegen den Hauptzweig eine falsche Ausgangslage für den nächsten Lauf.
   Lies das Feld, nimm es nicht an.
2. **Nichts wird gelöscht, dessen Commits nicht nachweislich im Basiszweig liegen.** Der Nachweis
   ist ein Befehl, nicht eine Annahme (siehe „Der Andock-Nachweis" unten). Ein Branch, dessen Arbeit
   nirgends sonst existiert, ist das einzige Exemplar dieser Arbeit.
3. **Kein `git branch -D`, kein `--force`**, gelöscht wird mit `-d` — verweigert Git, ist das eine
   Aussage, und der Branch wird gemeldet und bleibt stehen. Für `git branch`, `git worktree remove`
   und `git push` durch Hook durchgesetzt; `--force` anderer Befehle sperrt er nicht.
4. **Ein schmutziger Worktree wird nicht entfernt** — Arbeit darin gehört einem Menschen. Das
   `--force` an `git worktree remove` ist durch Hook gesperrt.
5. **Remote-Branches nur nach ausdrücklicher Zustimmung** — `git push <push_remote> --delete` ist
   für andere sichtbar und nicht ohne Weiteres umkehrbar. Durch Hook durchgesetzt: Vor
   `git push --delete` fragt der Berechtigungsdialog; ohne Ja bleibt der Branch stehen.
6. **Die Junctions unter den Worktrees werden nie rekursiv gelöscht.** Das ist die eine Stelle,
   an der ein Aufräumbefehl echten Schaden anrichtet — `mission/references/worktree.md`,
   „Abräumen".

---

## Phase 0 — Feststellen, was gilt

- **Zuerst, vor allen eigenen Schritten (#36):** `worktree.ps1 -Action CleanupStale`
  (`mission/references/worktree.md`). Es räumt ab, was tote Sitzungen hinterlassen haben
  (`mission/SKILL.md`, Phase 0a) — auch den Missions-Worktree des Laufs, wenn seine Sitzung tot und er
  sauber ist — und fasst Worktrees ohne Lock und Locks lebender Sitzungen nicht an. Ein
  schmutziger Worktree wird gemeldet, nicht entfernt. Das Ergebnis, eine JSON-Liste, gehört in die
  Bestandsaufnahme (Phase 2) und in den Bericht. Exit 1 heißt, ein Schritt ist gescheitert
  (`failed: …` in der Liste): das Skript im Wortlaut melden, nicht von Hand nachholen. Steht das
  Frontmatter nur auf dem Missions-Branch, bekommt jeder Aufruf `-AdapterFile` (#38,
  `mission/references/worktree.md`, „Umstellung").
- `.claude/epic.md` lesen, Forge-Zugang herstellen und verifizieren.
- **Den Pull Request holen und prüfen, dass er wirklich angedockt ist** (`merged`, nicht nur
  `state: closed` — ein geschlossener Pull Request kann verworfen worden sein, und dann ist der
  Missions-Branch das einzige Exemplar seiner Arbeit). Notiere aus ihm: `base`, `head`, den
  Andock-Commit.
- Ist er nicht angedockt: **anhalten und fragen.** Das ist der Regelfall für einen Fehlaufruf — der
  Ablauf heißt „nach dem Andocken".
- `git status` muss sauber sein. Sonst abbrechen und fragen.
- `git fetch --prune` — das hält die Fernverfolgung aktuell und markiert die Branches, deren
  Gegenstück in der Forge schon weg ist.

## Phase 1 — Den Basiszweig holen

Das Hauptverzeichnis wird nicht umgeschaltet (`mission/SKILL.md`, Regel 11). Geprüft wird gegen den
Fernzweig.

```bash
git fetch <push_remote> <base aus dem Pull Request>
```

Steht das Hauptverzeichnis ohnehin auf dem Basiszweig, zusätzlich `git pull --ff-only`.
**`--ff-only`, nicht `git pull`.** Lässt sich der Basiszweig nicht vorspulen, liegt lokal etwas,
was nicht in der Forge ist. Das ist eine Aussage über deinen Arbeitsstand und kein Anlass für
einen Commit per `git merge`: melden und fragen.

Prüfe danach, dass der Andock-Commit des Pull Requests wirklich im Basiszweig liegt:

```bash
git merge-base --is-ancestor <merge-commit> <push_remote>/<base> && echo "drin"
```

Erst wenn das bestätigt ist, darf gelöscht werden. Alles Weitere hängt daran.

## Phase 2 — Die Bestandsaufnahme

Erst zählen, dann löschen. Trage vier Listen zusammen:

1. **Der Missions-Branch des Laufs**, lokal und in der Forge.
2. **Paket-Branches des Laufs** (Namensschema und `<nr>`: `mission/SKILL.md`, Phase 3). Bei einem
   ordentlich verlaufenen Lauf sind sie schon weg — `/mission` löscht sie nach dem Sofort-Andocken. Was übrig ist, gehört zu
   einem **nicht abgenommenen** Paket und trägt Arbeit, die im Basiszweig *nicht* liegt. Solche
   Branches werden **nicht** gelöscht; sie werden gemeldet, mit der Kennung ihres Pakets —
   Ticketnummer im Tickets-Modus, Paketbezeichnung aus dem Branchnamen im Spec-Modus.
3. **Worktrees:** `git worktree list`, darunter der Missions-Worktree `<worktree_root>/epic-<nr>`, **falls
   er noch steht** — er lebt mit der Sitzung des Laufs, und `CleanupStale` kann ihn schon abgeräumt
   haben; sein Fehlen ist kein Befund (`mission/references/worktree.md`, „Abräumen") — und getrennt
   davon der Inhalt von `worktree_root` auf der Platte. Die beiden Listen weichen voneinander ab, und die Differenz ist der eigentliche Befund:
   was Git kennt, ist ein Worktree; was nur auf der Platte liegt, ist ein Rest
   (`mission/references/worktree.md`, „Worktrees ohne Manifest und Reste auf der Platte").
   **Laufende Läufe anderer Missionen** sind kein Befund: `epic-<andere nr>`, ihre Paket-Worktrees und
   Paket-Branches gehören einem Lauf, dessen Zielissue `status/in-arbeit` trägt oder den
   der Auftrag nennt. Sie stehen auf keiner Liste und werden nicht angefasst, auch nicht als
   Altlast.
4. **Altlasten**, wenn der Nutzer sie einbezogen hat: lokale Branches, deren Gegenstück in der
   Forge gelöscht ist (`git branch -vv` zeigt sie als `origin/…: gone`), und Worktree-Reste
   früherer Läufe.

Lege die Listen **vor dem ersten Löschen** vor, mit dem Andock-Nachweis je Eintrag. Das ist keine
Zeremonie: die Altlastenliste ist typischerweise die längste, und sie enthält regelmäßig einen
Branch, der wie eine Leiche aussieht und einen eigenen Commit trägt.

### Der Andock-Nachweis

Je Branch, und zwar so:

```bash
git branch --merged <base>          # vollständig im Basiszweig — gefahrlos
git log --oneline <base>..<branch>  # leer heißt: kein eigener Commit
```

`git branch --merged` allein genügt nicht, wenn der Branch mit *Squash* angedockt wurde: dann liegt
sein Inhalt im Basiszweig, seine Commits aber nicht, und er erscheint als „nicht angedockt" (`--merged` führt ihn nicht). Das ist
der Fall, in dem `-d` verweigert und ein Mensch entscheiden muss — **nicht** der Fall für `-D`.

`--merged` genügt auch dann nicht, wenn das Andocken selbst zurückgenommen wurde: der Andock-Commit
steht weiterhin im Basiszweig, seine Wirkung aber ist per `git revert -m 1` aufgehoben
(`mission/SKILL.md`, Phase 5, Punkt 2). Ein solcher Branch gilt hier **nicht** als angedockt, obwohl
`--merged` ihn so führt. Prüfe je Kandidat:

```bash
git log <base> --grep '^Revert' --format='%H %B'
```

Steht darin ein Revert-Commit, dessen Text „This reverts commit <merge-commit-des-branches>"
nennt, ist das Andocken revertiert. Ein solcher Branch wird **gemeldet und nicht gelöscht** — mit dem
Revert-Commit und dem Hinweis aus `mission/SKILL.md`, „Zurücklassen".

Ein Branch mit `origin/…: gone` ist **kein** Nachweis für irgendetwas. Er sagt nur, dass sein
Gegenstück in der Forge weg ist; ob das nach einem Andocken oder nach einem Verwerfen geschah, steht
dort nicht. Der Nachweis bleibt derselbe Befehl.

## Phase 3 — Löschen, jeweils mit Beleg

In dieser Reihenfolge, weil ein Branch mit angehängtem Worktree sich nicht löschen lässt:

1. **Worktrees**, die Git kennt, mit `worktree.ps1 -Action Down -Package <Ordnername unter
   worktree_root>` (`mission/references/worktree.md`) — **nie von Hand, nie `--force`**, nie aus einer
   Shell, die im Worktree steht. Der Missions-Worktree heißt `epic-<nr>`. Bricht `Down` ab, weil der
   Worktree schmutzig ist: melden, stehen lassen. Bricht es ab, weil **kein Manifest** da ist
   (Worktree aus der Zeit vor dem Skript), gilt der Weg aus `mission/references/worktree.md`,
   „Worktrees ohne Manifest und Reste auf der Platte". Jeder andere Exit 1: das Skript im
   Wortlaut melden, nichts von Hand nachholen.
2. **Worktree-Reste**, die nur auf der Platte liegen: nach demselben Weg. Prüfe
   vorher, dass darin nichts anderes als die Verweise liegt — findet sich eine veränderte Datei,
   ist es kein Rest, sondern liegengebliebene Arbeit.
3. `git worktree prune` — räumt die Verwaltungseinträge zu Worktrees auf, deren Verzeichnis nicht
   mehr existiert. Dazu der Code-Graph des Laufs: `graph.ps1 -Action Remove -RepoRoot <repo>
   -Package epic-<nr>` (`mission/scripts/graph.ps1`); er liegt im Git-Verzeichnis und fällt in
   keiner der Listen auf. `removed: false` heißt, der Lauf hatte keinen.
4. **Lokale Branches** mit `git branch -d`. Ein Branch mit revertiertem Andocken (siehe Andock-Nachweis
   oben) wird übersprungen und gemeldet, nicht gelöscht. Der Missions-Branch zuletzt, nachdem alles
   andere weg ist.
5. **Remote-Branches** nur nach Zustimmung (Regel 5), und nur den Missions-Branch des angedockten
   Laufs: `git push <push_remote> --delete <branch>`. Viele Forges tun das beim Andocken selbst;
   prüfe erst, ob überhaupt noch etwas da ist.

Nach jedem Schritt den Erfolg prüfen, nicht annehmen. Ein `Remove-Item` auf einen offenen Pfad
scheitert still genug, um übersehen zu werden.

## Phase 4 — Nachsehen und berichten

- `git worktree list` — nur das Hauptverzeichnis darf übrig sein, auf dem Zweig, auf dem es vorher
  stand, dazu die Worktrees laufender Läufe anderer Missionen.
- Der Inhalt von `worktree_root` — leer oder nicht mehr vorhanden, bis auf laufende Läufe anderer
  Missionen.
- `git status` — sauber.
- **`node_modules` im Hauptverzeichnis prüfen.** Das ist die Gegenprobe zum Abräumen von Junctions
  (`mission/references/worktree.md`, „Abräumen"): eine Stichprobe, dass die Abhängigkeiten noch dastehen. Fehlen sie, hat ein rekursives Löschen durch
  eine Junction gegriffen — dann sofort melden, denn der nächste Testlauf scheitert sonst an einer
  Ursache, die niemand mehr mit dem Aufräumen verbindet.
- `git branch -vv` — die verbliebenen Branches, und je Eintrag ein Wort, warum er steht.
- **Reste außerhalb dieses Repositorys**, zuletzt: `sweep.ps1 -Root <Ordner über dem
  Hauptverzeichnis>` (`mission/scripts/`, Aufrufform wie `worktree.ps1`, Hilfe im Kopfkommentar). Es
  fährt `CleanupStale` in jedem Repository mit Adapter, entfernt alte Temp-Ordner der Läufe
  (Browserprofile, Jest-Caches), verwaiste Docker-Images und Build-Cache älter als sieben Tage.
  Markierte Images, Volumes, Container und alles, was `CleanupStale` schützt, bleiben. Die
  JSON-Liste gehört in den Bericht; Exit 1 heißt, ein Schritt ist gescheitert: im Wortlaut melden,
  nichts von Hand nachholen. Herkunft: Bestandsaufnahme vom 12.11.2026 — Missions-Worktrees toter
  Sitzungen standen in drei Repositorys seit zwei Wochen, weil dort kein Lauf mehr gestartet war.

Bericht: was gelöscht wurde (mit dem Nachweis, der es erlaubte), was **nicht** gelöscht wurde und
warum, und was ein Mensch entscheiden muss. Nicht abgenommene Paket-Branches namentlich, mit der
Kennung ihres Pakets — Ticketnummer im Tickets-Modus, Paketbezeichnung im Spec-Modus — sie sind der
Grund, warum dieser Ablauf nicht einfach alles wegwirft.

**Lernschleife.** Nennt der Adapter `lern_issue` und lief die Mission ohne Flotten-Treiber (der
startet sie selbst), schlägt der Bericht als letzte Zeile den Aufruf vor:
`bun ~/.claude/skills/flotte/src/cli.ts lernen <repo> --pr <nr> --epic <nr>`. Du führst ihn nicht
selbst aus; er schreibt einen Kommentar in die Forge.

Dieser Ablauf schreibt **nicht** in die Forge. Er verändert keinen Zustand, den ein Leser in einem
halben Jahr braucht; er räumt eine Arbeitskopie auf. Nur wenn ein nicht abgenommenes Ticket einen
Branch behält, gehört das an dessen Issue — falls `/mission` es dort nicht schon vermerkt hat.

---

## Abbruchbedingungen — anhalten und fragen

- Der Pull Request ist nicht angedockt (nur geschlossen, oder noch offen).
- Das Arbeitsverzeichnis ist nicht sauber.
- Der Basiszweig lässt sich nicht mit `--ff-only` vorspulen.
- Der Andock-Commit liegt nicht im Basiszweig.
- Ein Branch trägt Commits, die nicht im Basiszweig liegen — er bleibt stehen, ohne Ausnahme.
- Ein Worktree lässt sich nicht ohne `--force` entfernen.
- Ein Worktree-Rest enthält mehr als die Verweise auf die Abhängigkeiten.
- Ein zu löschender Branch ist gerade in einem anderen Worktree ausgecheckt.
- Es läuft noch ein Außeneinsatz oder eine Nacharbeit **an derselben Mission** — dann sind „Reste"
  keine Reste. Läufe anderer Missionen halten das Aufräumen nicht an; ihre Worktrees und Branches
  bleiben außen vor (Phase 2).
