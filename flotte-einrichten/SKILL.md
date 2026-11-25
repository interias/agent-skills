---
name: flotte-einrichten
description: Ein Repository in einem Zug flottentauglich machen, einmal je Repository — erkennen, was da ist, die Andockprüfung auf den Vertrag des Adapters bringen, den Adapter in einer Fragerunde ausfüllen, die Forge vorbereiten, den Nachtlauf einrichten, Probelauf und Anmeldung an der Brücke. Für ein neues Projekt oder wenn `flotte pruefen` Lücken meldet.
disable-model-invocation: true
---

# Flotte einrichten

Ein Repository ist **flottentauglich**, wenn der Flotten-Treiber dort Missionen starten, die
Andockprüfung selbst fahren, über `merge.ps1` andocken und nachts alles ohne Cache prüfen kann.
Dieser Ablauf bringt ein Repository einmal dorthin. Was zum heutigen Stand fehlt, sagt

```powershell
bun "$HOME\.claude\skills\flotte\src\cli.ts" pruefen <ordner>
```

Der Befehl liest nur und nennt je Punkt den Schritt unten, der ihn schließt (`stand`: `fehlt`,
`empfohlen`, `offen` = nicht prüfbar, `ok`). Fahre ihn zu Beginn und am Ende; am Ende steht
`fehlt: 0`.

Zielvorgabe ist das Argument des Aufrufs: der Ordner des Repositorys, sonst das aktuelle.

## Regeln

1. **Wie gefragt wird**, steht in `mission/SKILL.md` („Wie gefragt wird"): Optionen, markierte
   Empfehlung, ein Satz Grund. Klare Punkte entscheidest du selbst und nennst sie in der Runde als
   eine Zeile `✔ <Entscheidung> — <Grund>`, damit der Mensch widersprechen kann. Fragen stellst du nur,
   wo der Mensch die Folge trägt: Zugänge und Rechte, was nach außen wirkt, Produktregeln, mehrere
   vertretbare Wege.
2. **Kein Universalwerkzeug erzwingen.** Die Andockprüfung gehört dem Projekt. Du schlägst vor und
   baust mit dem Menschen; eine vorhandene Prüfung wird ergänzt, nicht ersetzt.
3. **Alles über einen Branch und Pull Request**, in einem Worktree (`<repo>-worktrees/einrichten`),
   nie im Hauptverzeichnis. Den ersten Pull Request dockt ein Mensch an: Bis der Adapter auf dem
   Standardzweig liegt, gilt dort `merge: mensch`.
4. **Wortschatz** aus `CONTEXT.md` dieses Skill-Repositorys (Mission, Andockprüfung, Andocken …);
   Schlüssel und Labels bleiben technisch.
5. **Nichts starten, was läuft:** keinen Treiber, keine Brücke neu bauen. Die Anmeldung an der
   Brücke geht über den vorhandenen Weg „Projekt hinzufügen“ (Schritt 6).

## Schritt 1: Erkennen

Lies, ohne etwas zu ändern, und halte das Ergebnis in der ersten Runde fest:

- **Sprachen und Testbefehle:** `package.json` (Skripte, Workspaces), `pyproject.toml`,
  `requirements*.txt`, `go.mod`, `Cargo.toml`, `*.csproj`, Pester-Dateien (`*.Tests.ps1`).
- **Ordnerstruktur:** Apps, Pakete, Dienste — das sind die Kandidaten für Module und Kontexte.
- **Vorhandene CI:** `.github/workflows`, `.gitea/workflows`; was sie prüft und was nicht.
- **Vorhandene Andockprüfung:** `gate.ps1`, `npm run gate`, ein Skript unter `gate/` oder `scripts/`.
- **Vorhandener Adapter:** `.claude/epic.md` (alter Name `.claude/prd.md`), `AGENTS.md`, `CLAUDE.md`,
  `CONTEXT.md`, `docs/adr/`.
- **Commit-Stil und -Sprache** aus `git log --oneline -30`.
- **Einrichten:** Abhängigkeiten, `.env.example`, Compose-Dateien, geteilte Dienste.

## Schritt 2: Andockprüfung

Der Vertrag (`mission/references/adapter.md`, „Andocken“):

1. **Gegen eine Basis:** Die Prüfung bestimmt, was sich gegenüber `origin/<basis>` geändert hat, und
   fährt die Kontexte, deren Eingaben berührt sind.
2. **Cache:** Ein grünes Ergebnis eines Kontexts gilt wieder, solange seine Eingaben unverändert sind
   (Schlüssel: Prüfsumme über die Eingabedateien, Werkzeugstände, Modus). Die Zeile des Kontexts sagt
   das, und `gate_cached` im Adapter ist der Ausdruck dafür (etwa `aus dem Cache`).
3. **Nachweisblock:** Kopfzeile mit Basis und HEAD, je Kontext eine Zeile, Schlusszeile:

   ```
   == Gate: Basis origin/main @ a7d3a91, 3 geänderte Dateien (HEAD d9084a7c)
     web   grün   0:50
     api   grün   aus dem Cache
   Gate grün.
   ```

   Weicht das Projekt ab, stehen `gate_heading`, `gate_green`, `gate_base`, `gate_head` im Adapter.
4. **Rot von außen** (belegte Testsperre, Zeitgrenze) meldet sie in einer eigenen Zeile, die mit
   `Testsperre belegt` oder `Zeitgrenze des Gates` beginnt.

Fehlt etwas davon, legst du einen **Vorschlag** vor: je Kontext Name, Befehl und Eingaben (Pfade, die
ihn wecken — auch Dateien, die er quer liest), dazu was alle Kontexte weckt (die Prüfung selbst,
Lockfiles). Frage nur, wo es mehrere vertretbare Schnitte gibt; dann baut ihr ihn gemeinsam, mit
Tests für die Zuordnung Datei → Kontext. Kann ein Kontext nicht sicher gecacht werden (Uhrzeit,
Dienste, Netz), läuft er immer und sagt es in seiner Zeile.

## Schritt 3: Adapter

Ausgangspunkt ist die Vorlage in `mission/references/adapter.md` („Vorlage“); dort stehen alle
Schlüssel und Standards. Eine Fragerunde, in der du das Erkannte vorschlägst:

- ✔ selbst: `forge`, `api` (aus `origin`), `commit_style`, `commit_language` (aus `git log`),
  `test_commands` (je Suite ohne vollen Stack), `gate_command`, `gate_cached` (Schritt 2), `glossary`,
  `must_read`.
- **Module und Kontexte:** welche Ordner ein Paket sind; ob `modules_section` vom Standard abweicht.
- **`exclusive_paths`:** Pfade, deren Änderung allein laufen muss (Lockfiles, Migrationen, Schemata,
  geteilte Konfiguration); `always_collide` für Dateien, die fast jedes Paket berührt.
- **Parallelität:** `isolation: none-needed` mit Begründung oder `test_isolation_env`; sonst
  `window: 1`. `shared_services`, `worktree_may_start`, `env_files`, `link_dirs`.
- **Regeln** in der Prosa: „nur Software“ schärfen (`mission/SKILL.md`, Regel 14: was hier Inhalt
  ist), Migrationsverbote, Doku-Pflicht, ein Abschnitt `## Entscheidungsregeln` nur bei Bedarf.
- **`merge`** (Schritt 4) und **`gate_night_command`** (Schritt 5).

Danach meldet `flotte pruefen` keine `<…>` mehr; ein Wert in `<…>` sperrt jede Mission.

## Schritt 4: Forge

1. **Anmeldung und Rechte:** `bun …\cli.ts forge pruefen` im Repository; ohne Schreibrecht oder mit
   abgeschalteten Issues geht es nicht weiter — das klärt der Mensch.
2. **Labels:** die, die `flotte pruefen` unter `labels` als fehlend nennt, mit `gh label create`
   (Gitea: über die API) anlegen. Farben und Texte der Statuslabels stehen in
   `mission/references/forge.md`.
3. **Der Weg nach main:** `merge: nach_gate` im Adapter. Flottentauglich heißt: der Treiber dockt
   an. Behält der Mensch `merge: mensch` (seine Entscheidung), bleibt `merge` in `flotte pruefen` als
   `fehlt` stehen und im Bericht als bewusst offener Punkt. Mit `nach_gate` ist **`merge.ps1` der einzige Weg** auf den Basiszweig,
   für jeden: eine Zeile in `AGENTS.md`, dass angedockt nur mit `merge.ps1 -Repo <owner/name> -Pr <nr>`
   wird, nie mit `gh pr merge` oder dem Knopf der Forge. Branch-Schutz (kein direkter Push auf main)
   und abgeschaltetes Auto-Andocken der Forge schlägst du vor; einstellen tut es der Mensch.

## Schritt 5: Nachtlauf

`gate_night_command` fährt alles ohne Cache, was es braucht, bringt es mit (etwa eine Installation;
`mission/references/adapter.md`, „Nachtlauf“). Vorschlag: derselbe Befehl wie `gate_command` mit dem
Schalter für „ohne Cache“. Dann die geplante Aufgabe:

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\flotte\nachtlauf-aufgabe.ps1" -Projekt <ordner> -Uhrzeit 02:30
```

✔ die Uhrzeit, wenn nichts dagegen spricht. Einmal von Hand auslösen (`Start-ScheduledTask`), dann
`flotte nachtlauf --stand` lesen: Das Werkzeug der Prüfung (npm, bun, python) muss im Pfad der Aufgabe
liegen. Die Aufgabe läuft nur, solange der Benutzer angemeldet ist.

## Schritt 6: Probelauf und Anmelden

1. **Probelauf:** `gate_command` einmal im Worktree auf `origin/main` fahren. Erwartet: der Block wie
   in Schritt 2, grün; ein zweiter Lauf auf demselben Stand kommt aus dem Cache. Den Block in den Pull
   Request der Einrichtung unter `gate_heading`.
2. **Andocken** des Einrichtungs-PRs durch den Menschen (Regel 3).
3. **Anmelden** an der Brücke über den vorhandenen Weg: Maschinenraum, „Projekt hinzufügen“, oder
   `bun …\cli.ts projekt hinzufuegen <ordner> [--autostart]` (`flotte/SKILL.md`). Das legt das
   Startskript an; den Treiber startet der Mensch.
4. **`flotte pruefen <ordner>`** zeigt `fehlt: 0` (oder nur `merge`, wenn der Mensch selbst andockt). Was `offen` bleibt (etwa kein angedockter PR mit
   Block), steht mit Grund im Bericht.

## Bericht

Eine kurze Liste: was erkannt wurde, die ✔-Entscheidungen, die Antworten des Menschen, der Pull
Request, das Ergebnis von `flotte pruefen` vorher und nachher, was beim Menschen bleibt.
