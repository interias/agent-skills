---
name: flotte
description: Flotten-Treiber — ein Programm statt eines Admiral-Chats führt mehrere Außeneinsätze (/mission) gleichzeitig als `claude -p` auf einem oder zwei Konten. Belegung, Bremsen, Andocken, Aufräumen, Tafel und Logbuch macht das Programm; ein Sprachmodell entscheidet nur je Frageblock (Admiral). Start aus einem Terminal, nicht aus einer Sitzung.
---

# Flotte

`flotte` ist ein Programm (TypeScript, läuft mit Bun). Es führt mehrere `/mission`-Läufe
gleichzeitig. Ein Sprachmodell kommt nur an zwei Stellen vor:

- in den **Läufen**: `/mission` unverändert, als `claude -p`, jeder Zug endet mit `FLOTTE-FRAGE` oder `FLOTTE-ENDE` (`references/bloecke.md`),
- im **Admiral**: ein `claude -p --json-schema` je Frageblock, mit `--tools Read,Grep,Glob`.

Admiral und Läufe starten mit `--strict-mcp-config`: kein MCP-Server und kein claude.ai-Konnektor
des Kontos. Läufe zusätzlich ohne `RemoteTrigger`, `PushNotification`, `PublishPlugin`,
`ShareOnboardingGuide` und `DesignSync`. Der Treiber prüft die Werkzeugliste im `init`-Ereignis:

- Der Admiral darf nur `Glob`, `Grep`, `Read` und `StructuredOutput` sehen.
- Ein Lauf darf kein `mcp__`-Werkzeug sehen.

Sieht ein Aufruf mehr, beendet der Treiber ihn sofort. Die Fragen des Admirals gehen dann an den
Menschen, die Mission eines Laufs wird blockiert.

Voraussetzung ist die Andockregel aus #15: der Adapterschlüssel `merge` und die neue `merge.ps1`.
Eine ältere `merge.ps1` ruft der Treiber nicht auf.

## Starten

Aus einem Terminal, im Projektordner:

```
bun <skills>\flotte\src\cli.ts fahren --konten 1,2
```

- **Repository und Forge:** ohne `<repo>` das Repository des aktuellen Ordners (sein
  Hauptverzeichnis, auch aus einem Worktree), ohne `--forge` das GitHub-Repository von `origin`.
  Beides lässt sich angeben: `fahren <repo> --forge <owner/name>`.
- **Missionen:** ohne `--epics` alle offenen Missionen (`epic_label`) mit `ready_label` des Adapters, an
  sich oder an einem offenen Missionsziel (`references/belegung.md`). Der Treiber sammelt sie etwa alle
  15 Minuten neu ein und nimmt neu freigegebene Missionen auf; Belegung und Reihenfolge-Kanten gelten
  für sie wie für die ersten. Eine unterwegs entstandene Mission ohne das Label wartet. Ein Issue mit
  `ready_label`, das weder `epic_label` trägt noch Missionsziel einer Mission ist, nimmt er nicht; er meldet
  es einmal als Ereignis „freigegeben, aber keine Mission: #…“. Mit
  `--epics 15,21` bleibt der Einsatz fest auf diese Missionen beschränkt; mit `--epics 15,21 --dauerhaft`
  laufen diese Missionen und dazu alles, was das Einsammeln freigegeben findet. Läufe, Fragen und PRs
  eines früheren Einsatzes aus `zustand.json`, die das Einsammeln nicht trifft, übernimmt er (Ereignis
  „Übernommen aus einem früheren Einsatz“); sie zählen in der Belegung mit.
- **Ende:** Sind Schlange und Kandidaten leer, sammelt der Treiber ein letztes Mal ein und endet,
  wenn nichts Neues freigegeben ist. Mit `--dauerhaft` wartet er weiter auf neue Missionen. Ist eine
  Mission dieses Einsatzes blockiert oder abgebrochen und die Brücke erreichbar, endet er nicht, sondern bleibt im
  Einsatz (Ereignis „bleibt im Einsatz“), bis der Mensch sie dort neu einreiht oder aufgibt. Ohne
  Brücke endet er wie bisher; blockierte Missionen früherer Einsätze halten ihn nicht.
- **Konten** als Kurzname: `1`, `2`, `3` oder der Ordnername im Benutzerverzeichnis
  (`.claude-arbeitspferd`), sonst ein Pfad. Die Nummern stehen in `konten.json` neben dem Skill
  (`{ "1": "~/.claude", "2": "~/.claude-arbeitspferd" }`); ohne die Datei gelten `~/.claude`,
  `~/.claude-arbeitspferd` und `~/.claude-arbeitspferd-3`. Die Konten aus `--konten` sind
  gleichrangig; eine neue Mission geht auf das Konto mit den wenigsten laufenden Läufen.

Mögliche Schalter:

| Schalter | Standard |
|---|---|
| `--skill` | `mission` |
| `--modell` | Standard des Kontos |
| `--admiral-modell` / `--admiral-effort` | `fable` / `high` |
| `--admiral <konto>` | das Konto der Mission; mit Angabe laufen alle Admiral-Aufrufe auf diesem Konto, etwa Läufe auf Konto 2 und der Admiral auf Konto 1. Es muss nicht in `--konten` stehen; der Treiber bewertet seinen Verbrauch trotzdem (Pings, Stufe auf Tafel und im Logbuch). Bei Gelb warnt er im Logbuch vor. Bei Rot fragt er den Admiral auf einem Konto aus `--konten` mit Luft (grün vor gelb, in der Reihenfolge von `--konten`); hat keins Luft, wartet der Frageblock im Zustand, bis ein Konto frei wird, und geht dann einmal an den Admiral. An den Menschen geht deshalb keine Frage. Das gilt auch ohne `--admiral` für das Konto der Mission |
| `--epics <n,n>` | die freigegebenen Missionen, laufend neu eingesammelt |
| `--dauerhaft` | Ende, wenn Schlange und Kandidaten leer sind |
| `--ping-modell` | `haiku` |
| `--leerlauf-min` | `60` |
| `--takt-s` | `60` |
| `--platte-min-gb` | `20` |
| `--ram-warn` | aus dem Adapter, sonst `75`; geht auch an `ram.ps1` |
| `--obergrenze` | aus der Wochen-Hochrechnung (4, 2 oder 1); fest gesetzt nur für Proben |
| `--sweep-root <dir>` und `--sweep-temp <dir>` | ohne Angabe läuft kein Sweep |
| `--ohne-docker` | Docker wird mit aufgeräumt |
| `--ohne-nacharbeit` | Nacharbeit läuft |
| `--merge-skript` | `mission/scripts/merge.ps1` |
| `--max-min` | ohne Grenze |
| `--bruecke <url>` | Umgebung `FLOTTE_BRUECKE`, sonst keine Brücke; etwa `http://127.0.0.1:4747`. Den Token einer Brücke mit `BRUECKE_TOKEN` liest der Treiber aus `FLOTTE_BRUECKE_TOKEN` |
| `--konto-max <konto>=<n>` | ohne Grenze; höchstens n Missionen gleichzeitig auf diesem Konto (ein Konto, das noch reichen muss). Es zählen die Missionen, die dort laufen, fragen oder an ihrem PR stehen; eine angedockte, blockierte oder abgebrochene Mission gibt den Platz frei |

### Weiteres Konto zuschalten

Ein drittes Konto (`~/.claude-arbeitspferd-3`) arbeitet nur unter dem Treiber. Eingerichtet und
angemeldet wird es wie in `arbeitspferd/README.md`, „Weiteres Konto einrichten“. Zugeschaltet wird
es nur, wenn der Mensch es sagt:

1. Treiber mit `flotte anhalten <repo>` anhalten (unten). Die Läufe arbeiten weiter, der Zustand steht schon in `zustand.json`.
2. Mit demselben Aufruf neu starten, `--konten` um das Konto erweitert (Kurzname oder Ordner; `~`
   versteht der Treiber selbst), im Projektordner:

   ```
   bun ~\.claude\skills\flotte\src\cli.ts fahren --epics 15,21,32 --konten 1,2,3 --konto-max 3=1
   ```

3. `--konto-max <konto>=<n>` ist die Grenze: Auf dem Konto arbeiten höchstens n Missionen gleichzeitig
   (siehe Tabelle). Ohne die Angabe verteilt der Treiber neue Missionen auf alle Konten mit grünem
   Verbrauch.

Eine Mission bleibt bei dem Konto, dem sie zugeteilt ist, auch für Fortsetzungen und Nacharbeit. Ein
Konto deshalb erst wieder aus `--konten` nehmen, wenn keine seiner Missionen mehr offen ist.

Weitere Befehle, jeder gibt genau ein JSON-Objekt aus:

- `flotte zustand <repo>`: Zustand und Sperre.
- `flotte antworten <repo> <epic> <frage> <Antwort>`: eine Antwort des Menschen an den laufenden Treiber.
- `flotte anhalten <repo>`: hält den Treiber sicher an, etwa zum Aktualisieren. Er startet nichts Neues mehr (kein Lauf, kein Zug, kein Andocken aus der Schlange), lässt ein begonnenes Andocken mit Andockprüfung und `nach_merge` zu Ende laufen und endet dann mit dem Ereignis „Angehalten auf Wunsch“. Läufe arbeiten in ihrer eigenen Prozessgruppe weiter, ein Neustart übernimmt sie. Strg+C beendet dagegen auch einen laufenden `merge.ps1`, eine Andockprüfung oder `nach_merge` mitten im Schritt.
- `flotte zuschauen <repo> <epic> [--einmal]`: folgt dem Log eines Laufs, je Zeile ein Schritt (Werkzeug und Ziel, Text des Laufs).
- `flotte adapter [<ordner>...]`: nennt die Projektadapter ohne Schlüssel `merge` (ohne Angabe die Repositorys unter `~/git`). In diesen Projekten dockt nur ein Mensch an (ohne Schlüssel gilt `merge: mensch`).
- `flotte auftrag <repo> <entwurf.md> [--starten] [--trocken]`: der Auftragsschreiber, das einzige Werkzeug, das Missionen und Missionsziele anlegt (agent-skills/ADR-0002). Prüft den Entwurf gegen den Adapter des Ziel-Repositorys und legt nichts an, wenn einem Missionsziel ein Pflichtabschnitt fehlt. Labels `needs-triage`, mit `--starten` `ready_label`. Entwurfsformat und Ergebnis: `README.md`, „Aufträge“.
- `flotte triage [<repo>...] [--trocken]`: der Admiral klärt die offenen Sternzeit-Notizen (`needs-triage`, `needs-info`) selbst — ein Aufruf je Projekt liefert Schnittplan, Fragen, Abnahmekriterien und Verifikationsweg für alle Notizen (geteilt nach Thema nur über der Größengrenze eines Aufrufs); klar: Abschnitte ergänzen (der Text bleibt), an die Mission des Plans hängen (eine neue legt der Auftragsschreiber an) und Warp frei; überflüssig, zusammengeführt, verworfen: schließen mit Grund; kritisch: eine gebündelte Frage an den Menschen. Kommentar mit Herkunft vor jeder Änderung, ohne eigenen Zustand wiederholbar. Formen und Planen: `README.md`, „Triage“.
- `flotte werft [<ordner>...] [--bruecke <url>] [--einmal]`: die Werft (agent-skills/ADR-0005), ein Dienst je Rechner aus einem Terminal wie der Treiber. Für jedes Repository mit Adapterschlüssel `deploy` (ohne Angabe unter `~/git`) beobachtet sie `origin/<main_branch>` und zieht die Stacks nach, deren Pfade der Diff seit ihrem letzten Stand berührt; ein roter Stack bleibt mit Protokoll stehen, bis der Mensch ihn über die Brücke nachziehen lässt. `--einmal`: ein Takt. Form und Stand: `README.md`, „Werft“.
- `flotte belegung`, `verbrauch`, `ressourcen`, `bloecke`, `lauf`: die Werkzeuge einzeln.
- `flotte messen <einsaetze.json>`: Kennzahlen aus den Transkripten; unter dem Treiber auch die Messungen der Prognose (`messungen.jsonl` neben `zustand.json`, Abschnitt `prognose`). Unter dem Treiber liest es Fragen, Wartezeit, kalte Zeit und Starts aus `zustand.json` (`treiberZustand` im Einsatz). Abschnitt `tokens`: Eingabe, Cache-Schreiben, Cache-Lesen und Ausgabe je Agent-Typ, je Mission und je Paket, Cache-Quote, Review-Runden je Paket und je Agent-Typ der Anteil, den jede Art Werkzeugergebnis (Test, Andockprüfung, Diff, Lesen, übrige Shell) kostet; Abschnitt `verlauf`: Durchlaufzeit und Fehlerquote je Mission (`README.md`, „Messen“). Mit `epicLaeufe` teilt es jeden Außeneinsatz nach Rollen auf (Orchestrator, Ingenieur, Erster Offizier, Kundschafter, Admiral), mit Verbrauch je Mission und Paket, Zeiten vom Andocken bis zum nächsten Start, Prüfzeit und Fensterverlust (Abschnitt `epic_laeufe`, Herleitung in `probe/programm/README.md`). Einen Lauf von `flotte mission` liest es aus `epics/<nr>/` neben `zustand.json`: Aufrufe nach Rolle, Andockvorgänge, Neustarts und ungültige Ausgaben aus seinen Ereignissen.
- `flotte lernen [<repo>] --pr <n> [--epic <n>] [--trocken]`: die Lernschleife nach einem angedockten Missions-PR. Ein billiges Modell (Standard `haiku`, ohne Werkzeuge) liest PR und Missions-Kommentare und schlägt höchstens drei Lehren vor, je mit Beleg, in der billigsten dauerhaften Form (Test > Adapterregel > Skilltext > Doku) und mit dem, was dafür entfallen kann. Der Kommentar geht an `lern_issue` des Adapters, mit `--trocken` oder ohne `lern_issue` nur in die Ausgabe. Er sagt je Regel `Lernschleife L<n>`, ob sie gegriffen hat; eine Regel, die zehnmal in Folge nicht gegriffen hat, schlägt das Programm zum Streichen vor. Unter dem Treiber läuft sie nach jedem Andocken von selbst, wenn `lern_issue` gesetzt ist (Modell: `--lern-modell`).

## Was der Treiber tut

1. **Einer je Repository.** Die Sperre liegt in `<git common dir>/flotte/treiber.lock`, der Zustand daneben in `zustand.json`. Nach einem Neustart setzt der Treiber aus der Datei fort. Ein Lauf schreibt sein Log selbst und überlebt den Treiber. Strg+C beendet den Treiber; seine Sperre gibt er nur frei, wenn das Signal ankommt (nicht in einer PowerShell-Pipeline wie `… | Tee-Object`), sonst übernimmt der nächste `fahren`-Aufruf die Sperre, weil ihr Prozess tot ist. Läufe, die noch leben (PID und Startzeit passen), beobachtet der Treiber nur.
2. **Belegung** aus Adapter und Issues: Kollisionsstufen (keine 4, klein 3, mittel 2, groß 1 gleichzeitig, nie mehr als vier) und Reihenfolge-Kanten. Eine Mission startet erst nach dem Andocken ihrer Vorgängerin. Eine startbereite Mission mit `prio_label` (Standard `prio/hoch`, an der Mission oder an einem Missionsziel) kommt in die nächste Belegung; harte Kanten und Kollisionsstufen gelten weiter. Hält sie nur eine Kollision zurück, startet nichts Neues, das mit ihr kollidiert; laufende Missionen bricht der Treiber nie ab. Erst danach gilt der Gleichstand: Es gewinnt die Wahl, deren Missionen weniger Bereiche der Andockprüfung (`gate_areas`) teilen. Jede neue Belegung nennt ihren Beleg, auch das prio-Label und warum eine prio-Mission wartet.
3. **Bremsen** in jedem Takt:
   - RAM über `ram.ps1`: `warn` und `hold` halten an, weiter geht es erst 5 Punkte unter der Warnschwelle. Ein Messfehler gilt als `hold`, mit seinem Fehlertext; die nächste gute Messung gibt frei.
   - Plattenplatz.
   - Verbrauch je Konto aus dem `rate_limit_event` der Läufe, in `<CLAUDE_CONFIG_DIR>/flotte/verbrauch.json`. Gelb startet nichts Neues, Rot hält auch Fortsetzungen an. Ein Wert, der älter als 30 Minuten ist, gilt als rot. Ein Lauf meldet nur etwa ein- bis zweimal je Zug, deshalb holt ab 15 Minuten ein Mini-Lauf mit Haiku einen frischen Wert, auch während auf dem Konto ein Lauf arbeitet. Das geschieht nur, wenn auf dem Konto etwas starten oder weiterlaufen will, also nicht, während alles auf den Menschen wartet.
4. **Fragen:** Der Admiral entscheidet alles außer der Liste „Beim Menschen" (`references/entscheidungsrecht.md`; im Programm `BEIM_MENSCHEN` in `src/treiber/admiral.ts`), bei beiden Werten von `merge`. Sein Schema lässt als `nr` nur die Nummern der Fragen zu. Jede Entscheidung kommt als Kommentar ans Issue; einflussreiche Entscheidungen kommen zusätzlich ins Logbuch. Was beim Menschen liegt, parkt nur die Pakete aus `Betrifft:`; die übrigen laufen weiter (`weiter ohne <Pakete>`).
5. **Fehler:**
   - Ein Fehlstart wird höchstens zweimal neu gestartet.
   - Bei einem Netzfehler setzt der Treiber höchstens zweimal mit `--resume` fort.
   - Endet ein Zug ohne Block, fragt der Treiber einmal nach; danach gilt der Lauf als abgebrochen.
   - Nach `--leerlauf-min` ohne Ausgabe beendet er den Zug und setzt ihn einmal fort. Beim zweiten Mal bricht er die Mission ab. Lebt unter dem Lauf ein Kindprozess (eine Andockprüfung, eine Testsuite), gilt die Stille als Arbeit, bis zum Vierfachen von `--leerlauf-min`; das Ereignis nennt den Kindprozess.
   - `permission_denials` blockieren die Mission, ohne zweiten Versuch, wenn der Zug ohne Block endet. Endet er mit `FLOTTE-FRAGE` oder `FLOTTE-ENDE`, geht der Block vor: Die Ablehnungen sind ein Ereignis und stehen in der Lage jeder Frage des Blocks.
   - Ausnahme sind Sperren von `guard.ps1`. Der Treiber gibt den Hook jedem Zug über `--settings` mit, weil der Hook des Skills nach `--resume` nicht mehr gilt. Nach einer Sperre darf der Lauf seinen Weg ändern, wie im Fenster. Blockiert wird die Mission erst in einem dieser Fälle:
     - Der Zug scheitert an der Sperre.
     - Dieselbe Regel sperrt ein zweites Mal.
     - In der Mission kommt die dritte Sperre.
   - Nach jedem toten Lauf räumt `CleanupStale` auf. Es verschont die Worktrees der Missionen, die noch laufen oder warten: Jeder Lauf bekommt `EPIC_LOCK_HOLDER`, eine Datei in `<git common dir>/flotte/halten/`. Der Treiber löscht sie erst, wenn die Mission endet.
6. **Ende eines Laufs:**
   - Der PR aus `FLOTTE-ENDE` muss offen sein und den Missions-Branch `epic/<nr>-…` als Head haben. Sonst dockt der Treiber ihn nicht an und beobachtet ihn nicht; die Frage, welcher PR zur Mission gehört, geht an den Menschen (Frage 99), und der ganze Lauf wartet.
   - Mit `merge: nach_gate` kommt die Mission in die **Andock-Schlange**, in der Reihenfolge ihres `FLOTTE-ENDE`. Nur ihr Kopf ist dran, neben der Schleife: Während `merge.ps1` und die Andockprüfung laufen, beantwortet der Treiber andere Läufe.
     - **Basis:** Die Basis des PRs muss die erwartete sein: `base_branch` des Adapters, sonst `main_branch`, sonst der Standardzweig der Forge. Passt sie nicht oder steht `from-issue` im Adapter, dockt ein Mensch an. `merge.ps1` prüft das noch einmal und liest den Adapter dafür vom Standardzweig, nicht von der Basis des PRs.
     - **Nachweis der Andockprüfung:** Der letzte Lauf im Andockblock des PRs muss im Log des Laufs als Ausgabe eines echten Aufrufs der Andockprüfung stehen: grün, mit derselben Basis, demselben Head und derselben Art (voll oder Immer-Teil). Es zählt nur das Ergebnis eines Bash- oder PowerShell-Aufrufs, dessen Befehl `gate_command` oder `gate_always_command` enthält (führende Env-Zuweisungen wie `$env:X='0';` abgeschnitten); das Ergebnis wird über seine `tool_use_id` dem Aufruf zugeordnet, auch in Subagenten. Ein Block, den der Lauf nur geschrieben, mit `gh pr view` gelesen, mit `echo` ausgegeben oder per Read aus einer Datei geholt hat, reicht nicht. Fehlt der Nachweis, fährt der Treiber die volle Andockprüfung selbst (wie unten); ohne `gate_command` dockt ein Mensch an.
     - Mit Nachweis dockt `merge.ps1` an, wenn der Block gültig ist.
     - Sonst holt der Treiber selbst die Basis in den Missions-Worktree (`git merge origin/<basis>`), fährt `gate_command` des Adapters dort, schreibt den Block in die PR-Beschreibung, pusht und dockt an. Hat sich die Basis seit dem letzten vollen grünen Lauf nur in Bereichen bewegt, die die Mission nicht berührt (`gate_areas`), fährt er nur `gate_always_command`. Hat die Sitzung des Laufs den Missions-Worktree mitgenommen, legt der Treiber ihn mit `worktree.ps1 Up` neu an und baut ihn nach dem Andocken mit `Down` ab.
     - Ein Konflikt oder eine rote Andockprüfung geht mit der Ausgabe an den Lauf zurück (`--resume`); die Mission stellt sich hinten an, die Schlange läuft weiter. Eine rote Andockprüfung setzt den Worktree auf den Stand des PRs zurück. Nach zwei Rückgaben wird die Mission bei der dritten blockiert. Konflikte mit der Basis zählen getrennt (`basisKonflikte`, blockiert erst beim fünften): Sie entstehen, weil andere vor ihr andocken, nicht durch den Lauf. Rot von außen — die Ausgabe der Andockprüfung meldet in einer eigenen Zeile eine belegte Testsperre oder ihre abgelaufene Zeitgrenze — wiederholt der Treiber einmal selbst, ohne Rückgabe an den Lauf; bleibt es rot, geht es wie jedes Rot zurück.
     - Bei n Missionen in der Schlange sind so höchstens n−1 Wiederholungen der Andockprüfung nötig. Der Zähler steht als `gateWiederholungen` je Mission und in der Statistik; nach drei eigenen Läufen der Andockprüfung für dieselbe Mission wird sie blockiert.
     - Ohne `gate_command` im Adapter lässt sich keine Andockprüfung nachweisen: Der Treiber ruft `merge.ps1` nicht auf, ein Mensch dockt an.
   - Mit `merge: mensch` (Standard) meldet er „PR bereit“ und erkennt das Andocken später.
   - **Andocken je Mission (#112):** Bei `merge: nach_gate` kommt nur eine Mission mit der wirksamen Stellung „automatisch“ in die Schlange; sonst „PR bereit“ mit dem Grund (`Andocken: Mensch prüft, …`). Die Stellung: der Schalter der Mission auf der Brücke, sonst der Vorschlag aus dem Inhalt (Body der Mission, Titel und Body der Missionsziele gegen `MERKMALE` in `src/treiber/admiral.ts`: Treffer → „Mensch prüft“), sonst die Einstellung `merge` des Projekts (Startwert der Adapter). Ein PR, der nur deshalb wartet, kommt in die Schlange, sobald die Stellung „automatisch“ wird. Bei `merge: mensch` bleibt es bei „PR bereit“: Die Brücke verschärft nur.
   - Nach dem Andocken schließt der Treiber die Mission mit einem Kommentar, wenn alle Missionsziele geschlossen sind. Ist noch eines offen, bleibt sie offen, er nimmt `ready_label` ab und sagt am Issue, was offen ist; die Mission startet erst wieder, wenn ein offenes Missionsziel freigegeben wird. Ist der Stand eines Missionsziels nicht lesbar, ändert er nichts. Beim Start sieht er für angedockte Missionen nach und schließt, was inzwischen fertig ist; ein Label nimmt er dabei nicht ab.
   - Dann die `nach_merge`-Befehle des Adapters, dann `CleanupStale`, dann der lokale Missions-Branch, wenn er ganz in `origin/<basis>` liegt. Bekommt ein anderer offener PR außerhalb der Schlange einen Konflikt, geht ein Auftrag an dessen Lauf. Mit `lern_issue` im Adapter läuft nebenher `flotte lernen` (siehe „Weitere Befehle“); ihr Ergebnis steht als Ereignis im Zustand.
7. **Sichtbar:**
   - Tafel: `<git common dir>/flotte/tafel.html` im Browser öffnen; sie lädt sich selbst neu. Sie zeigt je Lauf den letzten Schritt und seine Zeit und die Andock-Schlange.
   - Keine Lauftafel je Lauf: Jeder Auftrag an `/mission` und `/mission-nacharbeit` sagt `Lauftafel aus` (`mission/references/lauftafel.md`, „Lauftafel aus"). Den Stand zeigen Brücke und Forge.
   - Logbuch: ein Issue mit Label `flotte`, mit dem KIBO-Block. Die Bremse steht dort nur als Stufe, nie in Prozent.
   - **Prognose:** Je fertiger Mission schreibt der Treiber eine Messung nach `messungen.jsonl` (Arbeitszeit ohne Warten auf den Menschen, Zeit der Andockprüfung, Pakete mit Klasse und Eskalationen aus dem Log). Ab `prognose_ab` (Standard 5) Messungen meldet er der Brücke je wartender Mission und für den Backlog eine Monte-Carlo-Spanne (P50–P90) und prüft sich selbst; unter 60 % Treffern blendet die Brücke sie aus. Einzelheiten: `README.md`, „Prognose“.
   - **Flottenbrücke** (`flottenbruecke/`, mit `--bruecke`): Der Treiber meldet ihr in jedem Takt seinen Zustand (mit Missionszielen je Mission, Verbrauch je Konto, Ereignissen und Admiral-Entscheidungen) und holt die Antworten und Handlungen ab, die der Mensch dort gegeben hat: blockierte Mission neu einreihen oder aufgeben, eine Entscheidung des Admirals zurücknehmen, eine Einstellung ändern, eine freigegebene Mission aufnehmen, eine Mission pausieren, fortsetzen oder ihre Priorität setzen. Nur der Treiber spricht mit ihr, Läufe und Admiral sehen sie nicht. Ein Ereignis (neue Frage, Stufenwechsel, Andocken) meldet er sofort; solange eine Frage offen ist, fragt er alle 10 s nach Antworten. Ist sie aus, arbeitet er weiter (ein Ereignis, kein Fehler). Fürs Holodeck schickt er die HTML-Dateien direkt im Ordner `prototype_dir` (Adapter, Standard `prototypen/`), sobald sich ihr Satz ändert: nur Dateinamen und Inhalte, keine Unterordner, keine Verknüpfungen, kein Weg aus dem Repository. Schnittstelle: `flottenbruecke/SCHNITTSTELLE.md`.

## `flotte mission`: eine Mission als Programm

`flotte mission` arbeitet eine Mission ohne Orchestrator-Sitzung ab (Mission #69): Schnitt, Vorab-Tor, Fenster, Ingenieur, Erster Offizier, Nachprüfung, Andocken in den Missions-Branch, Revert und PR fährt das Programm. Je Sprachmodell-Punkt (Schnitt, Ingenieur, Erster Offizier, Konflikt) startet es einen `claude -p` mit JSON-Schema und dem Hook `guard.ps1`.

```
bun src/cli.ts mission <nr> <repo> --mechanik echt --aufrufe echt --konto <CLAUDE_CONFIG_DIR> \
  [--branch epic/<nr>-<slug>] [--basis origin/main] [--forge <owner/repo>] [--antworten <datei>] [--max-min 120]
```

- Zustand, Sperre und Blöcke liegen in `<git common dir>/flotte/epics/<nr>/` (`zustand.json` mit `ereignisse[]`, `bloecke.txt`, Aufruf-Logs unter `aufrufe/`). Jeder Block `FLOTTE-FRAGE`/`FLOTTE-ENDE` geht auch auf stdout.
- Antworten stehen als Zeilen `<nr>: <antwort>` in der `--antworten`-Datei. Ohne sie hält das Programm an, sobald nur noch eine Antwort weiterhilft.
- Fortsetzen heißt neu starten: Laufende Aufrufe beendet das Programm beim Anhalten und setzt sie beim nächsten Start mit `--resume` fort (Ereignis `neustart`).
- Der Treiber kennt `flotte mission` nicht. Die Probe in `probe/programm/` fährt es unter dem Treiber über eine dünne Hülle als Projekt-Skill (`vorbereiten.ps1 -Motor programm`); `flotte messen` misst beides mit demselben Abschnitt `epic_laeufe`. Ob `/mission` unter dem Treiber auf das Programm umgestellt wird, entscheidet der Mensch; das Umschalten ist nicht Teil des Programms.

## Was beim Menschen liegt

- **Fragen**, die der Admiral nicht entscheiden darf. Sie stehen als `FRAGE AN DEN MENSCHEN` am Issue, auf der Tafel und vollständig auf der Brücke (Frage, Lage, Optionen, Empfehlung, Betrifft, Wortlaut). Lässt sich ein Block nicht in Fragen zerlegen, geht sein Wortlaut zuerst als eine Frage an den Admiral (`Betrifft: Lauf`); erst was er nicht entscheiden darf, kommt zum Menschen. Keine Frage verschwindet still. Antwort mit `flotte antworten …` oder auf der Brücke (Option, bei `— Auswahl: mehrere` mehrere als Kästchen, Freitext oder beides; der Freitext erreicht den Lauf unverändert als `Antwort: <Text>`).
- **Andocken** bei `merge: mensch` und bei einer Mission, deren Andocken auf „Mensch prüft“ steht (Vorschlag, Schalter oder Einstellung auf der Brücke), und das Umstellen auf `nach_gate` im Adapter.
- **Konto anmelden**, wenn ein Lauf mit einem Anmeldefehler endet (die Mission steht dann auf „blockiert“).
- **Widerruf** einer Entscheidung: als Kommentar am Issue oder auf der Brücke („Zurücknehmen“ bis zum Andocken). Der Lauf setzt ihn im nächsten Zug oder in der Nacharbeit um; eine Mission in der Andock-Schlange geht dafür zurück an den Lauf.
- **Blockierte und abgebrochene Missionen:** Der Grund steht am Issue und auf der Brücke. Dort lässt sich die Mission neu einreihen (Zähler zurück, der Lauf setzt mit dem Grund fort; noch unbeantwortete Fragen des Laufs nennt der Auftrag als offen, der Lauf entscheidet sie nicht selbst und stellt sie erneut) oder aufgeben (`abgebrochen`, Branch, PR und Issue bleiben). Mit Brücke bleibt der Treiber dafür im Einsatz; endete er ohne Brücke, weil alles blockiert war, wirkt die Handlung beim nächsten Start.
- **Vorrang** einer Mission: das Label `prio/hoch` (Adapter `prio_label`) an der Mission oder an einem Missionsziel, oder auf der Brücke „Priorität hoch“/„normal“ (gilt vor dem Label).
- **Missionen im Einsatz steuern** (Brücke, Sternenkarte, mit PIN): eine offene Mission mit `ready_label` und `epic_label` aufnehmen, auch neben `--epics` (der Treiber prüft das an der Forge, sie bleibt nach einem Neustart im Einsatz); eine Mission pausieren (startet nicht; ein laufender Lauf erfährt die Pause vor seinem nächsten Paketstart über die RAM-Messung — der Treiber schreibt `pausiert` in die Haltedatei, `ram.ps1` meldet dann `hold` —, startet kein weiteres Paket, laufende Pakete laufen zu Ende; der nächste Zug wartet, bis sie fortgesetzt wird) und fortsetzen; ihr Andocken auf „automatisch“, „Mensch prüft“ oder zurück zum Vorschlag stellen (#112). Nichts wird abgebrochen.

Die Regeln hinter Belegung, Bremsen, Blöcken, Entscheidungsrecht und Logbuch:
`references/belegung.md`, `bremsen.md`, `bloecke.md`, `entscheidungsrecht.md`, `flottenlogbuch.md`.
