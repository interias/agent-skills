# Startprompts für Experiment 1: `/epic` gegen `/epic-schlank`

Zwei Läufe auf derselben Aufgabe, jeder in seinem eigenen Spiegel von BRIQNET #523 auf dem Stand vom
Laufbeginn (`772f38c1`), danach ein blinder Vergleich der Diffs. Dieses Dokument legt fest, wie
beide Läufe gleich gestartet werden; die Läufe selbst und das Urteil gehören zu #39. Was hier steht,
ist Vorgabe, kein Ergebnis.

| | Lauf A | Lauf B |
|---|---|---|
| Skill | `/epic` (Vollfassung) | `/epic-schlank` (`experimente/epic-schlank/`) |
| Spiegel | `Breuckmann/exp-523-a` | `Breuckmann/exp-523-b` |
| Klon | `C:\Users\sboerzel\git\exp-523-a` | `C:\Users\sboerzel\git\exp-523-b` |

Die Nummern im Spiegel zählen ab 1; `spiegel.ps1` gibt sie als JSON aus (`epic`, `children`).
Vorgesehen sind Epic **#1** und Kinder **#2–#6** (alt 523 → 1, 524 → 2 … 528 → 6). Gilt die Ausgabe
anders, gilt die Ausgabe.

## 1 Gleiche Bedingungen

Der Originallauf lief unter `/epic-flotte`, mit einem Paket je Welle in der Reihenfolge #524, #525,
#527, #526, #528 (dann #530). Das war eine Entscheidung des Menschen wegen des Wochenlimits, keine
Eigenschaft der Aufgabe. Für den Vergleich gilt eine eigene Festlegung. **Empfehlung**, entscheidet
#39:

| Punkt | Empfehlung | Grund |
|---|---|---|
| Einstieg | Beide direkt mit `/epic` bzw. `/epic-schlank` in je einer neuen Sitzung im Klon, nicht unter `/epic-flotte` | Der Admiral entschiede Tor-Fragen mit und wäre ein dritter Einfluss |
| Reihenfolge | Erst Lauf A, dann Lauf B; nie gleichzeitig | Wochenlimit und CPU (Testläufe mit 30 % Workern) bleiben für beide gleich, die Laufzeiten vergleichbar |
| Belegung | Wie der Adapter: `window: 3`, die Skills wählen selbst | Der Skill soll seine eigene Planung zeigen; nur einen Platz zu erzwingen bräuchte eine Zeile im Prompt, die beide Läufe gleich tragen müssten |
| Modell und Denkstufe der Hauptsitzung | Gleich für beide, vorher notieren | Pakete, Implementer und Reviewer wählen die Skills selbst |
| Eingriffe | Der Mensch antwortet nur am Vorab-Tor und nur mit den Antworten aus Abschnitt 4 | Jede andere Hilfe verfälscht den Lauf; sie wird als Rückfrage gezählt |
| Fremdwissen | Die Sitzung von A kennt B nicht und umgekehrt; Memory und `CLAUDE.md` sind für beide gleich | Sonst wandert Gelerntes herüber |

Wäre das Wochenlimit zu knapp: Beide Läufe mit der Zeile „Belegung: ein Paket je Platz, in der
Reihenfolge der Kinder“ im Prompt, für beide gleich. Das ändert die Laufzeit, nicht die Skills.

## 2 Vorbereitung

Je Lauf, in dieser Reihenfolge; die Schritte 1 bis 4 für beide Spiegel gleich.

1. **Spiegel anlegen** (einmal für beide):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\sboerzel\git\agent-skills\experimente\scripts\spiegel.ps1 -WhatIf
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\sboerzel\git\agent-skills\experimente\scripts\spiegel.ps1 | Set-Content spiegel.json -Encoding utf8
   ```

   Erst `-WhatIf` lesen: Es zeigt jeden geplanten Aufruf und schreibt nichts. Das JSON bewahren
   (`epic`, `children`, `base`, `deviations`); die Abweichungen gehören ins Urteilsprotokoll. Weg
   zurück: `spiegel.ps1 -Remove` löscht beide Spiegel, nachdem der Repo-Name eingetippt wurde.
2. **Klonen** in den Pfad aus dem JSON (`clone`); der Adapter verweist auf ihn:

   ```powershell
   git clone http://mb-vsv-cast:3003/Breuckmann/exp-523-a.git C:\Users\sboerzel\git\exp-523-a
   git clone http://mb-vsv-cast:3003/Breuckmann/exp-523-b.git C:\Users\sboerzel\git\exp-523-b
   ```

   Danach je Klon prüfen: `.claude/epic.md` hat `api: …/repos/Breuckmann/exp-523-a` (bzw. `-b`), und
   `git log -1` ist der Adapter-Commit (`base` aus dem JSON). **Das Token in der `.env` gilt auch
   für das echte BRIQNET; die `api:`-Zeile ist die einzige Schranke.** Zeigt sie auf `BRIQNET`,
   startet nichts. `.claude/launch.json` nennt Pfade des echten BRIQNET-Klons (im JSON als
   `repository-reference-unchanged`); `spiegel.ps1` ändert sie nicht. Startet ein Lauf daraus
   Dienste, laufen sie aus dem echten Klon: im Urteilsprotokoll vermerken.
3. **Gitignoriertes anlegen**, aus dem Hauptverzeichnis von BRIQNET kopiert, nie ausgegeben:
   `.env` im Wurzelverzeichnis (Adapter `token_file`, enthält das Token), `server\.env`,
   `client\.env` (Adapter `env_files`), `test-data\` (ohne sie bestehen Eval-Suiten gehaltlos,
   Adapter „Verifikationsweg“).
4. **Abhängigkeiten** in beiden Klonen gleich: `npm ci` in `client` und `server`. Keine Junctions
   auf BRIQNET: Ein rekursives Löschen des Klons folgte ihnen (KOKOS, 2026-09-18). Fehlt ein
   Ordner aus `link_dirs` (`.venv` der Python-Dienste), scheitert `worktree.ps1` für Pakete, die
   ihn brauchen. Die Python-Suiten also für beide gleich einrichten oder für beide als „nicht
   messbar“ stehen lassen; das Tor meldet es dann. Welche Fassung, entscheidet #39.
5. **Nur Lauf A: `/epic` ist die Vollfassung des Repos.** Vergleich des Repo-Stands mit dem
   Installierten:

   ```powershell
   $repo = 'C:\Users\sboerzel\git\agent-skills'
   Get-ChildItem "$repo\epic" -Recurse -File | ForEach-Object {
       $rel = $_.FullName.Substring("$repo\epic".Length)
       $inst = "$HOME\.claude\skills\epic$rel"
       if (-not (Test-Path $inst) -or (Get-FileHash $_.FullName).Hash -ne (Get-FileHash $inst).Hash) { "weicht ab: $rel" }
   }
   Get-ChildItem "$repo\agents\*.md" | ForEach-Object {
       $inst = "$HOME\.claude\agents\$($_.Name)"
       if (-not (Test-Path $inst) -or (Get-FileHash $_.FullName).Hash -ne (Get-FileHash $inst).Hash) { "weicht ab: agents\$($_.Name)" }
   }
   ```

   **Stand 23.10.2026 weicht alles ab:** Installiert sind 700 Zeilen `SKILL.md` ohne `guard.ps1` und
   Hook, das Repo hat 699 Zeilen mit Hook, und alle acht Agent-Dateien unterscheiden sich. Lauf B
   ist aus dem Repo-Stand abgeleitet (`STREICHLISTE.md`: `epic/` auf `66966ec`). Gegen die ältere
   installierte Fassung verglichen, mäße das Experiment auch den Abstand zwischen beiden
   Fassungen. Empfehlung: vor Lauf A `install.ps1` aus dem Repo-Stand fahren (`-DryRun` zuerst,
   siehe `INSTALL.md`), danach die Prüfung oben wiederholen, bis sie nichts meldet. Das tut der
   Mensch, nicht ein Agent.
6. **Nur Lauf B: Skill und Agenten von Hand kopieren**, nicht über `install.ps1` (`experimente/`
   bleibt für `install.ps1` unsichtbar). Die Dateien in `agents/` gehören nach `~/.claude/agents/`,
   nicht in den Skill-Ordner; in `SKILL.md` steht „liegen im Skill-Repository unter `agents/`“,
   für diese Kopie ist es `experimente/epic-schlank/agents/`:

   ```powershell
   $repo = 'C:\Users\sboerzel\git\agent-skills'
   robocopy "$repo\experimente\epic-schlank" "$HOME\.claude\skills\epic-schlank" /E /XD agents
   Copy-Item "$repo\experimente\epic-schlank\agents\*.md" "$HOME\.claude\agents\"
   ```

   `robocopy` endet mit Exit 0 bis 7 erfolgreich. Der Hook liest
   `$HOME/.claude/skills/epic-schlank/scripts/guard.ps1`; dort muss die Datei liegen. Neue Skills
   und Agenten greifen erst in einer neuen Sitzung. Namen kollidieren nicht: Skill und Agenten
   heißen `epic-schlank…`.
7. **Neue Sitzung** je Lauf, Arbeitsverzeichnis der Klon. Hauptmodell und Denkstufe notieren.

## 3 Die Startprompts

Wortgleich bis auf Skill und Epic-Nummer. Die Nummer ist `epic` aus dem JSON des jeweiligen Spiegels.

**Lauf A**, Sitzung in `C:\Users\sboerzel\git\exp-523-a`:

```
/epic #1

Messlauf in einem Spiegel-Repository. Arbeite so, wie der Skill es vorsieht. Wo er am Vorab-Tor
fragt, antwortet der Mensch.
```

**Lauf B**, Sitzung in `C:\Users\sboerzel\git\exp-523-b`:

```
/epic-schlank #1

Messlauf in einem Spiegel-Repository. Arbeite so, wie der Skill es vorsieht. Wo er am Vorab-Tor
fragt, antwortet der Mensch.
```

Beim Start Uhrzeit notieren. Ab hier greift der Mensch nur am Vorab-Tor ein.

## 4 Tor-Antworten

Grundlage: der Eröffnungskommentar des Originallaufs an BRIQNET #523 (19.10.2026, 05:22 UTC,
Kommentar 23505). Dort stand: Vorab-Tor **keine Punkte**; die Behauptungen der Bodys waren gegen
`main` geprüft. Erwartet wird also **kein** Tor. Fragt eines der beiden Läufe doch, bekommen beide
dieselbe Antwort aus dieser Tabelle, und die Frage zählt als Rückfrage (Abschnitt 5).

| Das Tor fragt nach | Antwort |
|---|---|
| Modus | `spec` mit Kindern (Adapter `issue_form: spec`). Die Kinder sind die Pakete, kein eigener Schnitt. |
| Basis | `main`, das ist der Adapter-Commit über `772f38c1`. |
| Pakete | Die fünf Kinder #2 bis #6 (im Original #524 bis #528). Nichts hinzufügen, nichts zusammenlegen. |
| Klassen | Der Plan des Skills ist freigegeben. Die Klassen des Originals, nur als Referenz für die Auswertung, nicht vorgeben: ADRs und Patch Note Standard, MP in der Anfrage Standard, Gewichtszuschlag raus Urteil, MP im Angebot Urteil. Eine abweichende Einstufung ist ein Messpunkt, kein Tor-Punkt. |
| Graph | Harte Kanten #3, #4, #5 → #6 (Kopfzeile und API); #2 ohne harte Kante zu einem anderen Kind (alle Kinder blockieren das Epic #1). Im Original zusätzlich eine Kollisionskante #3 – #4 (gemeinsame Dateien). Kein Exklusivknoten, keine Migration. |
| Übersprungenes | Nichts. #529 und #530 des Originals gibt es im Spiegel nicht. Der Verweis auf `#529` im Abschnitt Out of Scope ist kein Auftrag und kein Tor-Punkt. |
| Kanten nachtragen (Tor-Punkt 11) | Nicht nötig: Die Kanten stehen schon in den Abhängigkeiten (`spiegel.ps1` hat sie angelegt), `write_back_dependencies: true`. |
| Ausgangsstand | Messen lassen. Referenz aus dem Original (Epic-Worktree auf `772f38c1`): guard 0 Befunde · server 74 Suiten / 1740 Tests · client 239 / 2379 · migrations 30 / 121 · eval 92 / 1438 (+3 pending) · costing-service 17 (+2 skipped) · export-service 25 · cgis-service bekannt rot (Einsammeln) · converter-service nicht messbar · Lint client 778 Fehler / 128 Warnungen, server 75 / 1442. Abweichungen durch eine fehlende Umgebung sind ein Messpunkt; der Lauf geht weiter. |
| Verifikationsweg nicht fahrbar (Bildschirmfotos nach Deploy, Tor-Punkt 9) | Die Fotos entfallen als offener Punkt. Der Pull Request bekommt `WIP:`. Im Original war es ebenso. |
| Schreibrecht, Token (aus Tor-Punkt 10 des Skills, nicht aus dem Kommentar) | Das Token liegt in der `.env` des Klons. Fehlt das Schreibrecht, bricht der Mensch ab und prüft den Spiegel (kein Messwert). |
| `gate_approvals`, bezahlter Lauf, Stammdaten (aus dem BRIQNET-Adapter, nicht aus dem Kommentar) | Keines der Pakete darf sie berühren. Würde eines es, wird es zurückgelassen, nicht freigegeben. |

Alles andere, was ein Tor fragt: Rückfrage notieren, die Empfehlung des Skills annehmen, beiden
Läufen dieselbe Antwort geben und sie hier unter der Tabelle nachtragen, bevor der zweite Lauf
startet.

## 5 Messpunkte

Je Lauf eine Zeile, gleich abgelesen. Alles, was in der Forge steht, steht im Spiegel (Epic #1).

| Messpunkt | Wo abgelesen | Hinweis |
|---|---|---|
| **Tokens** | Verbrauchsanzeige der Sitzung am Ende (`/usage` bzw. `/cost`, je nach Abrechnung), vor dem Start auf Null oder den Stand notieren; zusätzlich die Summe der `usage`-Felder in den Sitzungsprotokollen unter `~/.claude/projects/` | Ob die Anzeige die Subagenten einschließt und wie die Protokolle abgelegt sind, ist hier nicht geprüft; vor Lauf A an einer Probesitzung klären |
| **Laufzeit** | Zeitstempel (`created_at`) des Eröffnungskommentars bis zum Abschlusskommentar an Epic #1: `GET /repos/Breuckmann/exp-523-a/issues/1/comments` | Wanduhr. Wartezeit auf den Menschen und Pausen (Limit) getrennt notieren |
| **Eskalationen** | Tabelle „Runden / Klasse“ im Abschlusskommentar an Epic #1 und die Paket-Kommentare #2–#6 (Eskalation: Implementer-Runde eine Klasse höher nach strukturellem Befund) | Zahl der eskalierten Pakete und von welcher auf welche Klasse |
| **Reviewer-Befunde** | Kommentare an den Paket-Issues #2–#6 je Runde, Abschlusskommentar („Runden“) | Zahl je Paket und Runde, strukturell oder lokal, und ob am Ende offen |
| **Rückfragen** | Verlauf der Sitzung: Runden am Vorab-Tor, Zahl der Fragen, Fragen im Lauf (Soll: keine, „im Lauf wird nicht angehalten“) | Die Forge hält sie nicht fest; Uhrzeit und Wortlaut mitschreiben |

Zur Einordnung dazu: Teststand nachher (Abschlusskommentar), Pull Request im Spiegel, Zahl der
zurückgelassenen Pakete.

## 6 Auswertung

Erst wenn beide Läufe fertig sind. Im lokalen BRIQNET-Klon `C:\Users\sboerzel\git\BRIQNET`:

1. **Epic-Branches der Spiegel holen.** Den Namen liefert `git ls-remote --heads <url> "epic/*"`.

   ```powershell
   $repo = 'C:\Users\sboerzel\git\BRIQNET'
   git -C $repo remote add exp-a http://mb-vsv-cast:3003/Breuckmann/exp-523-a.git
   git -C $repo remote add exp-b http://mb-vsv-cast:3003/Breuckmann/exp-523-b.git
   git -C $repo fetch exp-a
   git -C $repo fetch exp-b
   ```
2. **Den Adapter-Commit aus dem Diff nehmen.** Die Adapter-Commits der Spiegel unterscheiden sich
   im Namen (`exp-523-a` gegen `exp-523-b` in `api:`, `worktree_root` und im Fließtext) und wären
   in beiden Diffs sichtbar, gegen `29207580` gerechnet, also ein Hinweis, welcher Diff von
   welchem Lauf stammt. Darum je Branch einen Vergleichs-Commit bilden, dessen `.claude/epic.md`
   die Fassung von `29207580` trägt; sonst bleibt alles, wie der Lauf es hinterlassen hat. Das
   schreibt Objekte in den Klon, keinen Branch, keinen Checkout:

   ```powershell
   $ref = '29207580'
   $blob = git -C $repo rev-parse "${ref}:.claude/epic.md"
   $heads = @{ A = 'exp-a/epic/1-<slug>'; B = 'exp-b/epic/1-<slug>' }   # Namen aus ls-remote
   $neutral = @{}
   foreach ($k in $heads.Keys) {
       $env:GIT_INDEX_FILE = Join-Path $env:TEMP "idx-neutral-$k"
       Remove-Item $env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
       git -C $repo read-tree $heads[$k]
       git -C $repo update-index --cacheinfo "100644,$blob,.claude/epic.md"
       $tree = git -C $repo write-tree
       $neutral[$k] = git -C $repo commit-tree $tree -p $heads[$k] -m 'neutral adapter'
       Remove-Item $env:GIT_INDEX_FILE
   }
   Remove-Item Env:GIT_INDEX_FILE
   ```

   Danach ist der Adapter in beiden Diffs gleich, nämlich gar nicht vorhanden. Änderte ein Lauf
   `.claude/epic.md` selbst, geht das hier verloren; vorher mit
   `git diff <base> <branch> -- .claude/epic.md` je Spiegel prüfen und im Protokoll vermerken.
3. **Blind aufbereiten.** `blind.ps1` mischt A und B zufällig und versiegelt die Zuordnung:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\sboerzel\git\agent-skills\experimente\scripts\blind.ps1 `
       -RepoRoot $repo -Branches $neutral.A,$neutral.B -OutDir C:\Users\sboerzel\git\blind-523 -Reference 29207580
   ```

   Ergebnis: `A.diff`, `B.diff` und `zuordnung-erst-nach-dem-urteil\zuordnung.json`. Die Zuordnung
   wird erst nach dem Urteil geöffnet. `-Branches` nimmt auch Hashes.
4. **Urteilen** über die Diffs gegen `29207580`, das Ergebnis des Originals für #524–#528. Der
   Originaldiff enthält auch #530; er ist der Maßstab für #524–#528, nicht für #530. Dessen
   Anteil (Materialpreisbasis nach Reihenfolge, Spalte `mp_source`, Migration, ADR-0071) kommt in
   keinem Spiegel vor und zählt in keinem Diff als Fehler.
5. **Ins Urteilsprotokoll:** Der Diff-Inhalt selbst kann die Herkunft verraten, etwa durch Dateien,
   die nur ein Skill hinterlässt (Lauftafel-Dateien, Zwischenstände, Namen von Branches oder
   Commit-Nachrichten, die auf `epic-schlank` weisen). Vermerken, was beim Lesen aufgefallen ist,
   bevor die Zuordnung geöffnet wird. Dazu die `deviations` aus dem JSON von `spiegel.ps1`.
6. **Danach:** `zuordnung.json` öffnen, Messpunkte aus Abschnitt 5 dagegenhalten, Remotes entfernen
   (`git -C $repo remote remove exp-a`, `… exp-b`), die Spiegel mit `spiegel.ps1 -Remove`
   löschen und, wenn das Experiment beendet ist, die von Hand kopierten Dateien aus
   `~/.claude/skills/epic-schlank` und `~/.claude/agents/epic-schlank-*.md` entfernen.

## Nicht geprüft

Hier nicht gelaufen: `spiegel.ps1` gegen die echte API (Anlegen, Push, Labels, Kanten, Löschen),
die Wege in Abschnitt 2 und 6 und die Messung der Tokens. Der echte Lauf von `spiegel.ps1` ist
ein offener Punkt von #39.
