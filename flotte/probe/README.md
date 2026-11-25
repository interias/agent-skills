# Generalprobe (#14, Stufe 4)

Die Probe vorher/nachher des Missions-Programms (#69) steht in `programm/README.md`.

Der Treiber fährt echte `claude -p`-Läufe mit Haiku in `interias/flotte-probe` (privat).

## Aufbau

- **Im Probe-Repo:**
  - `.claude/epic.md`: hier `epic.md`. Darin `merge: nach_gate`, `CHANGELOG.md` in
    `always_collide` und `git pull --ff-only` als `nach_merge`.
  - `.claude/skills/kurz-lauf/SKILL.md`: hier `kurz-lauf.SKILL.md`. Eine Seite Regeln mit dem
    Protokoll von `/mission`: Tor-Frage, bauen, Andockblock, `FLOTTE-ENDE`. Dazu der Hook
    `guard.ps1` wie bei `/mission`. Ab Probe 2 schließt der PR auch die Pakete.
  - Ein leeres `CHANGELOG.md`.
- **Mini-Missionen** mit je zwei Paketen, jedes Paket legt eine neue Datei an. Alle teilen
  `CHANGELOG.md`; das ist eine kleine Kollision, bis zu drei laufen gleichzeitig.
- **Aufruf** (Repo-Klon unter `<dir>`). Probe 1 lief so; Probe 2 lief zusätzlich mit
  `--obergrenze 3 --merge-skript <merge.ps1 von #15>`:

  ```
  bun src/cli.ts fahren <dir>/flotte-probe --forge interias/flotte-probe --epics 12,13,14 \
    --konten <konto1>,<konto2> --skill kurz-lauf --modell haiku \
    --admiral-modell haiku --admiral-effort keine --leerlauf-min 15 --takt-s 15 \
    --sweep-root <dir> --sweep-temp <dir>/leer-temp --ohne-docker --ohne-nacharbeit --max-min 90
  ```

Gemessen ist alles mit `flotte messen`, für beide Proben mit demselben Programm. Die Quellen sind
Transkripte, `usage.ps1` und `zustand.json` des Treibers. **Mit den alten Läufen nicht
vergleichbar:** Haiku, Mini-Missionen.

## Probe 3 vom 20.11.2026 (Runde 5: Andock-Schlange und Bereiche)

**Aufbau,** zusätzlich zu Probe 1 und 2:

- Der echte Skill `/mission` aus dem Stapel, nicht `kurz-lauf`: als Projekt-Skill
  `.claude/skills/epic-stapel/` im Probe-Repo, ohne Installation. Geändert sind nur `name` (ein
  persönlicher Skill `epic` ginge sonst vor) und der Pfad des Hooks auf die Kopie. Die Agenten des
  Stapels liegen in `.claude/agents/` mit `model: haiku`.
- Adapter: hier `epic-probe3.md`. `merge: nach_gate`, `gate_command`, `gate_always_command`,
  `gate_areas` (`alpha/`, `beta/`, `gamma/`), `worktree_may_start: [compose]`. Protokoll; diese Schlüssel sind seit dem Umbau der Andockprüfung abgeschafft, ein Teil-Lauf zählt nicht mehr.
- Andockprüfung: hier `gate.ps1`, dieselbe Ausgabeform wie eine echte Projekt-Andockprüfung (Kontexte je Bereich,
  `wurzel` immer, Kopfzeile mit Basis und HEAD, `-Alle`, `-Immer`; `-Immer` ist Protokoll, ein Teil-Lauf zählt nicht mehr). Der Bereich `gamma` startet den
  Compose-Dienst aus `compose.yaml` und fragt ihn ab. Zwei Auslöser in `.git`, je einmal: 300 s
  Stille vor der Andockprüfung (über der Leerlaufgrenze von 4 min) und eine rote Andockprüfung beim ersten Lauf auf
  einem Andocken der Basis.
- Vier Specs ohne Missionsziele, je ein Paket: #43 und #44 im Bereich `alpha`, #45 in `beta`, #46 in
  `gamma`.
- Aufruf wie Probe 2, dazu `--skill epic-stapel --konto-max <konto 1>=1 --obergrenze 3
  --leerlauf-min 4`. Läufe und Admiral mit Haiku (`claude-haiku-5-5`).

| Kennzahl | #43 | #44 | #45 | #46 |
|---|---|---|---|---|
| Konto | 1 | 2 | 2 | 2 ¹ |
| Starts (Start und Fortsetzungen) | 4 | 1 | 3 | 4 |
| Aufrufe von `merge.ps1` | 3 | 1 | 2 | 2 |
| Andockprüfungs-Läufe des Treibers | voll (rot ²), Immer-Teil | – | Immer-Teil | Immer-Teil |

Die Teil-Läufe der Tabelle sind Protokoll; seit dem Umbau der Andockprüfung zählt ein Teil-Lauf nicht mehr.
| Rückgaben an den Lauf | 1 ² | 0 | 0 | 0 |
| Missions-Worktree vom Treiber neu angelegt ³ | ja | nein | ja | ja |
| PR bereit bis angedockt (min, `mergedAt`) | 10,0 | 0,1 | 9,8 | 10,3 |

`flotte messen`: 12 Starts, 0 Fehlstarts, 0 Rückfragen, 0 Entscheidungen des Admirals (Haiku
stellte am Tor keine Frage), kalte Zeit 21,6 min (davon rund 3 min die Pause zwischen Anlauf 1
und 2), Reste 0 Worktrees, 0 Branches, 0 Container. Offen ist nur das Logbuch-Issue.

1. #46 startete zuerst auf Konto 1: `--konto-max` zählte die Missionen nicht mit, die im selben Takt
   belegt wurden. Treiber und Lauf beendet, behoben, mit Test; danach Konto 2.
2. Der künstliche Auslöser. Die Mission stellte sich hinten an, die Schlange lief weiter (#45 und #46
   angedockt), der Lauf holte die Basis selbst nach.
3. Die Sitzung eines Laufs nimmt ihren Missions-Worktree mit (`mission/SKILL.md`, Phase 3). Der Treiber
   legt ihn jetzt mit `worktree.ps1 Up` neu an und baut ihn nach dem Andocken mit `Down` ab.

### Was die Probe belegt

- **Andock-Schlange:** Andockprüfungs-Läufe des Treibers 4 bei 4 Missionen. Erwartet n−1 = 3, dazu einer durch
  die künstlich rote Andockprüfung. #44 kam mit gültigem Block und wurde ohne Andockprüfung angedockt.
- **Bereiche, live auf der Forge:** #45, #46 und zuletzt #43 wurden nach einem Lauf nur des
  Immer-Teils angedockt; `merge.ps1` prüfte die Bereiche selbst. #43 bekam nach dem Andocken von #44
  (gleicher Bereich) die volle Andockprüfung. Protokoll; seit dem Umbau der Andockprüfung zählt ein Teil-Lauf nicht mehr.
- **Beide Konten gleichzeitig:** #43 auf Konto 1, #45 und #46 auf Konto 2, zur selben Zeit.
- **Abbruch des Treibers mit lebenden Läufen:** Treiber hart beendet, #43 und #45 liefen weiter;
  der Neustart meldete „lebt noch: wird beobachtet, nicht neu gestartet“.
- **Kein wartender Lauf weggeräumt:** Die Missions-Worktrees der Schlange überstanden jedes
  `CleanupStale` nach einem Andocken und gingen erst mit ihrem eigenen Andocken.
- **Docker:** Die Andockprüfungen der Läufe starteten Compose-Projekte (etwa `probe3-epic-43`); am Ende war
  kein Container, kein Netz und kein Volume des Probe-Repos mehr da. Wer welches Projekt abräumte
  (Lauf, `Down` oder `CleanupStale`), ist nicht einzeln nachgesehen.
- **Lange Andockprüfung über der Leerlaufgrenze:** Der Zug mit 300 s Andockprüfung dauerte 332 s, ohne Abbruch.
  Die Stille-Regel (C1) griff dabei nicht: `claude -p` meldet während eines Werkzeugaufrufs
  `tool_progress`, das Log steht also nicht still. Die Regel ist durch Tests belegt, live nicht
  ausgelöst.

### Was schiefging

- **Anlauf 1:** Drei Läufe beendeten den Zug mit einem nackten `FLOTTE-ENDE` ohne Nummer und URL,
  auch nach der Nachfrage; der Treiber brach sie ab. Haiku fand die Blockform nicht. Der Treiber
  nennt die Kopfzeilen jetzt im Auftrag und in der Nachfrage. In Anlauf 2 kamen alle Blöcke lesbar.
- Ein Lauf legte zwei Andockprüfungs-Ausgaben als Dateien in `worktree_root` ab, neben den Worktrees. Kein
  Worktree, aber ein Rest.

## Kurzprobe vom 19.11.2026, nach der Nachprüfung

Eine Mission über den Treiber, mit `guard.ps1` aus dem Stapel (#21 mit #15) über `--settings` und
`onFailure: block`. Der Probe-Schritt `gh pr merge 999` steht im zweiten Zug, also nach `--resume`.

| Anlauf | Mission | Was geschah |
|---|---|---|
| 1 | #37 | Haiku ließ den Probe-Schritt aus („Andocken ist nicht meine Aufgabe“). Der Hook wurde nicht gefragt; kein Beleg. PR #38 angedockt. |
| 2 | #41 | Schritt 0 im Skill als Pflichttest beschrieben. Im zweiten Zug (dieselbe Sitzung, `--resume`) **sperrte der Hook** `gh pr merge 999` mit Regel 1, als `permission_denial`. Der Treiber notierte „Hook-Sperre: Skill epic, Regel 1“, blockierte nicht, der Lauf baute weiter. PR #42 angedockt vom Treiber, 0 Reste. |

Damit sind Befund A (Hook über den Treiber nach `--resume`) und B (eine Sperre blockiert nicht
sofort) live belegt.

## Probe 2 vom 19.11.2026, nach der Abnahme

Vier Missionen (#21, #24, #27, #30):

- Obergrenze fest auf 3. Die Wochen-Hochrechnung beider Konten hätte sie auf 1 gesenkt.
- Ein Abbruch mit echtem Strg+C mitten im Bauzug aller drei Läufe.
- #30 hat einen Probe-Schritt `gh pr merge 999` gegen `guard.ps1`.

| Kennzahl | #21 | #24 | #27 | #30 |
|---|---|---|---|---|
| Konto | 1 | 1 | 1 | 2 |
| Starts (Start und Fortsetzungen) | 2 | 3 | 4 | 5 |
| Fehlstarts | 0 | 0 | 0 | 0 |
| Rückfragen an den Menschen / Entscheidungen des Admirals | 0 / 1 | 0 / 1 | 0 / 1 | 0 / 1 |
| Andocken abgelehnt, weil die Basis davonzog / eigene Nachbesserung | 0 / 0 | 1 / 0 | 2 / 0 | 3 / 0 |
| Kalte Zeit (min) ¹ | 0 | 4,5 | 13,0 | 17,7 |
| PR bereit bis angedockt (min, `mergedAt`) | 2,6 | 11,3 | 18,0 | 21,5 |
| Orchestrierung (`weighted`, Admiral) | 12 571 | 24 165 | 11 876 | 18 441 |
| Reste danach (Worktrees, Branches, Container, offene Issues) | 0 | 0 | 0 | 0 |

1. Kalte Zeit ist hier die Warteschlange der Andockvorgänge. Jedes Andocken prüft zwei Minuten lang auf
   Checks, die es in diesem Repository nicht gibt. Jedes Andocken rückt die Basis der übrigen PRs
   weiter, die dann neu nachziehen. Der Treiber beantwortete in der Zeit andere Läufe (Befund 12).

### Was die Probe belegt

- **Drei Läufe gleichzeitig** (`maxLaeufe` 3), **einer auf Konto 2** (#30). Zu Beginn war der
  Verbrauchswert von Konto 2 30,9 Minuten alt und galt deshalb als rot. Die ersten drei Läufe
  gingen an Konto 1; erst der Ping machte Konto 2 grün.
- **Alle vier Andockvorgänge kamen vom Treiber über `merge.ps1`:** 10 Aufrufe, 4 angedockt, 6 abgelehnt,
  weil die Basis davongezogen war. #30 wurde dreimal abgelehnt; der alte Zähler hätte die Mission
  nach zwei blockiert (Befund 9).
- **Admiral:** Haiku entschied alle vier Tor-Fragen selbst. Keine Antwort wurde wegen einer
  falschen `nr` verworfen (Befund 1).
- **Strg+C mitten im Bauzug**, über den Terminal-Bereich der App.
  - Der Treiber endete. Alle drei Läufe machten ihren Zug zu Ende und schrieben ihr Ergebnis ins
    eigene Log.
  - Der Neustart fand sie beendet, las die drei Ergebnisse aus den Logs und startete nichts doppelt.
  - Die Sperre blieb liegen; der SIGINT-Handler lief in der PowerShell-Pipeline nicht. Der Neustart
    übernahm sie, weil ihr Prozess tot war.
  - Einen noch lebenden Lauf zu beobachten, kam live nicht vor. D16 deckt es ab: ein echter
    Treiberprozess, mitten im Zug beendet.
- **RAM-Bremse live:** `warn` bei 75,1 %, wieder frei bei 67,4 %. Andockvorgänge liefen in der Zeit weiter.
- **Reste:** keine Worktrees, keine Branches, keine Halter-Dateien. Alle Missionen und Pakete wurden
  über `Closes` geschlossen.

### `guard.ps1` nach `--resume` (Befund 15)

In der Probe verweigerte der Lauf den Probe-Schritt selbst („Andocken ist nicht deine Aufgabe“). Der
Hook wurde dabei nicht gefragt. Deshalb kam eine eigene Prüfung mit `starte`, wie im Treiber:

| Aufbau | `gh pr merge 999` |
|---|---|
| Zug 1: Skill `kurz-lauf` aufgerufen, im selben Zug der Befehl | **gesperrt** vom Hook des Skills |
| Zug 2 mit `--resume`, nur der Hook des Skills | **nicht gesperrt**; GitHub antwortete „Could not resolve to a PullRequest“ |
| Zug 2 mit `--resume`, Hook über `--settings` | **gesperrt**, als `permission_denial` gemeldet |

Der Hook im Frontmatter eines Skills gilt nur im Zug, der den Skill aufruft. Jede Antwort des
Treibers ist ein `--resume`. Deshalb gibt der Treiber jetzt jedem Lauf `guard.ps1` über
`--settings` mit.

## Probe 1 vom 19.11.2026, korrigiert nach der Abnahme

| Kennzahl | #12 | #13 | #14 |
|---|---|---|---|
| Starts des Laufs (Start und Fortsetzungen) | 4 | 3 | 2 |
| Fehlstarts | 0 | 0 | 0 |
| Rückfragen an den Menschen / Entscheidungen des Admirals | 1 / 0 ¹ | 1 / 0 ¹ | 0 / 1 |
| Warten auf den Menschen (min) | 1,1 | 23,5 ² | 0 |
| PR bereit bis angedockt (min, `mergedAt`) | 32,8 ³ | 5,4 | 2,2 |
| Orchestrierung (`weighted`, Admiral) | 90 967 | 24 444 | 17 598 |
| Reste (Worktrees, Branches, Container) | 0 | 0 | 0 ⁴ |

1. Der Admiral hatte beide Fragen selbst entschieden. Er antwortete aber mit der Missionsnummer als
   `nr`, und der Treiber verwarf die Antworten (Befund 1, behoben).
2. Der „Mensch“ der Probe war die Sitzung, die sie fuhr.
3. PR #16 wurde wegen des Fehlers in `merge.ps1` von Hand mit `merge.ps1` angedockt, außerhalb der
   Schleife. Der Treiber bemerkte es danach. Gemeldet waren 38,5 min; das war die Zeit bis zum
   Bemerken, nicht bis zum Andocken.
4. Die Paket-Issues #6 bis #11 blieben offen; sie sind seit Probe 2 geschlossen.

Die Obergrenze war 1. Es lief nie mehr als ein Lauf, alle auf Konto 1.

Die Probe deckte zwei Fehler auf; beide sind behoben:

- **`merge.ps1` las die Ausgabe von `gh` in der Konsolen-Codepage.** `Gate grün.` passte deshalb
  nie. Behoben auf dem Branch der Andock-Regel, mit Test seit der Abnahme.
- **Bei Gleichstand ging jeder Lauf an Konto 1.** Jetzt bekommt das Konto mit weniger Missionen den
  Lauf.

## Probe des Auftragsschreibers (#72)

`auftrag-entwurf.md` ist eine Mission mit drei Missionszielen; dieselbe Datei nehmen die Tests
(`test/auftrag-faelle.ts`). Echt angelegt in `interias/flotte-probe` (Klon unter `<dir>`), erst
trocken, dann ohne `--starten`, damit kein Treiber sie aufnimmt:

```
bun src/cli.ts auftrag <dir>/flotte-probe probe/auftrag-entwurf.md --trocken
bun src/cli.ts auftrag <dir>/flotte-probe probe/auftrag-entwurf.md
```

Die Links aus der Ausgabe gehören in den Kommentar an #72; danach die vier Issues schließen.
