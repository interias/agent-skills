---
name: flotte
description: Flotten-Treiber — ein Programm statt eines Admiral-Chats führt mehrere /epic-Läufe gleichzeitig als `claude -p` auf einem oder zwei Konten. Belegung, Bremsen, Merge, Aufräumen, Tafel und Logbuch macht das Programm; ein Sprachmodell entscheidet nur je Frageblock (Admiral). Start aus einem Terminal, nicht aus einer Sitzung.
---

# Flotte

`flotte` ist ein Programm (TypeScript, läuft mit Bun). Es macht, was `/epic-flotte` als Prosa
beschreibt. Ein Sprachmodell kommt nur an zwei Stellen vor:

- in den **Läufen**: `/epic` unverändert, als `claude -p`, jeder Zug endet mit `FLOTTE-FRAGE` oder `FLOTTE-ENDE` (`epic-flotte/SKILL.md`, „Die Blöcke“),
- im **Admiral**: ein `claude -p --json-schema` je Frageblock, mit `--tools Read,Grep,Glob`.

Admiral und Läufe starten mit `--strict-mcp-config`: kein MCP-Server und kein claude.ai-Konnektor
des Kontos. Läufe zusätzlich ohne `RemoteTrigger`, `PushNotification`, `PublishPlugin`,
`ShareOnboardingGuide` und `DesignSync`. Der Treiber prüft die Werkzeugliste im `init`-Ereignis:

- Der Admiral darf nur `Glob`, `Grep`, `Read` und `StructuredOutput` sehen.
- Ein Lauf darf kein `mcp__`-Werkzeug sehen.

Sieht ein Aufruf mehr, beendet der Treiber ihn sofort. Die Fragen des Admirals gehen dann an den
Menschen, das Epic eines Laufs wird blockiert.

Voraussetzung ist die Merge-Regel aus #15: der Adapterschlüssel `merge` und die neue `merge.ps1`.
Eine ältere `merge.ps1` ruft der Treiber nicht auf.

## Starten

Aus einem Terminal, im Projektordner:

```
bun <skills>\flotte\src\cli.ts fahren --konten 1,2
```

- **Repository und Forge:** ohne `<repo>` das Repository des aktuellen Ordners (sein
  Hauptverzeichnis, auch aus einem Worktree), ohne `--forge` das GitHub-Repository von `origin`.
  Beides lässt sich angeben: `fahren <repo> --forge <owner/name>`.
- **Epics:** ohne `--epics` alle offenen Epics (`epic_label`) mit `ready_label` des Adapters, an
  sich oder an einem offenen Kind, wie `/epic-flotte` Phase 0. Der Treiber sammelt sie etwa alle
  15 Minuten neu ein und nimmt neu freigegebene Epics auf; Belegung und Reihenfolge-Kanten gelten
  für sie wie für die ersten. Ein unterwegs entstandenes Epic ohne das Label wartet. Ein Issue mit
  `ready_label`, das weder `epic_label` trägt noch Kind eines Epics ist, nimmt er nicht; er meldet
  es einmal als Ereignis „freigegeben, aber kein Epic: #…“. Mit
  `--epics 15,21` bleibt der Einsatz fest auf diese Epics beschränkt.
- **Ende:** Sind Schlange und Kandidaten leer, sammelt der Treiber ein letztes Mal ein und endet,
  wenn nichts Neues freigegeben ist. Mit `--dauerhaft` wartet er weiter auf neue Epics.
- **Konten** als Kurzname: `1`, `2`, `3` oder der Ordnername im Benutzerverzeichnis
  (`.claude-arbeitspferd`), sonst ein Pfad. Die Nummern stehen in `konten.json` neben dem Skill
  (`{ "1": "~/.claude", "2": "~/.claude-arbeitspferd" }`); ohne die Datei gelten `~/.claude`,
  `~/.claude-arbeitspferd` und `~/.claude-arbeitspferd-3`. Die Konten aus `--konten` sind
  gleichrangig; ein neues Epic geht auf das Konto mit den wenigsten laufenden Läufen.

Mögliche Schalter:

| Schalter | Standard |
|---|---|
| `--skill` | `epic` |
| `--modell` | Standard des Kontos |
| `--admiral-modell` / `--admiral-effort` | `fable` / `high` |
| `--admiral <konto>` | das Konto des Epics; mit Angabe laufen alle Admiral-Aufrufe auf diesem Konto, etwa Läufe auf Konto 2 und der Admiral auf Konto 1. Es muss nicht in `--konten` stehen; der Treiber bewertet seinen Verbrauch trotzdem (Pings, Stufe auf Tafel und im Logbuch). Bei Gelb warnt er im Logbuch vor, bei Rot gehen die Fragen ohne Admiral-Aufruf an den Menschen |
| `--epics <n,n>` | die freigegebenen Epics, laufend neu eingesammelt |
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
| `--merge-skript` | `merge.ps1` des Leitstands |
| `--max-min` | ohne Grenze |
| `--bruecke <url>` | Umgebung `FLOTTE_BRUECKE`, sonst keine Brücke; etwa `http://127.0.0.1:4747`. Den Token einer Brücke mit `BRUECKE_TOKEN` liest der Treiber aus `FLOTTE_BRUECKE_TOKEN` |
| `--konto-max <konto>=<n>` | ohne Grenze; höchstens n Epics gleichzeitig auf diesem Konto (ein Konto, das noch reichen muss). Es zählen die Epics, die dort laufen, fragen oder an ihrem PR stehen; ein gemergtes, blockiertes oder abgebrochenes Epic gibt den Platz frei |

### Weiteres Konto zuschalten

Ein drittes Konto (`~/.claude-arbeitspferd-3`) arbeitet nur unter dem Treiber; der Leitstand kennt
es nicht. Eingerichtet und angemeldet wird es wie in `arbeitspferd/README.md`, „Weiteres Konto
einrichten“. Zugeschaltet wird es nur, wenn der Mensch es sagt:

1. Treiber mit `flotte anhalten <repo>` anhalten (unten). Die Läufe arbeiten weiter, der Zustand steht schon in `zustand.json`.
2. Mit demselben Aufruf neu starten, `--konten` um das Konto erweitert (Kurzname oder Ordner; `~`
   versteht der Treiber selbst), im Projektordner:

   ```
   bun ~\.claude\skills\flotte\src\cli.ts fahren --epics 15,21,32 --konten 1,2,3 --konto-max 3=1
   ```

3. `--konto-max <konto>=<n>` ist die Grenze: Auf dem Konto arbeiten höchstens n Epics gleichzeitig
   (siehe Tabelle). Ohne die Angabe verteilt der Treiber neue Epics auf alle Konten mit grünem
   Verbrauch.

Ein Epic bleibt bei dem Konto, dem es zugeteilt ist, auch für Fortsetzungen und Nacharbeit. Ein
Konto deshalb erst wieder aus `--konten` nehmen, wenn keines seiner Epics mehr offen ist.

Weitere Befehle, jeder gibt genau ein JSON-Objekt aus:

- `flotte zustand <repo>`: Zustand und Sperre.
- `flotte antworten <repo> <epic> <frage> <Antwort>`: eine Antwort des Menschen an den laufenden Treiber.
- `flotte anhalten <repo>`: hält den Treiber sicher an, etwa zum Aktualisieren. Er startet nichts Neues mehr (kein Lauf, kein Zug, kein Merge aus der Schlange), lässt einen begonnenen Merge mit Gate und `nach_merge` zu Ende laufen und endet dann mit dem Ereignis „Angehalten auf Wunsch“. Läufe arbeiten in ihrer eigenen Prozessgruppe weiter, ein Neustart übernimmt sie. Strg+C beendet dagegen auch einen laufenden `merge.ps1`, ein Gate oder `nach_merge` mitten im Schritt.
- `flotte zuschauen <repo> <epic> [--einmal]`: folgt dem Log eines Laufs, je Zeile ein Schritt (Werkzeug und Ziel, Text des Laufs).
- `flotte adapter [<ordner>...]`: nennt die Projektadapter ohne Schlüssel `merge` (ohne Angabe die Repositorys unter `~/git`). Vor dem Einspielen aufrufen: In diesen Projekten mergt danach ein Mensch.
- `flotte belegung`, `verbrauch`, `ressourcen`, `bloecke`, `lauf`: die Werkzeuge einzeln.
- `flotte messen <einsaetze.json>`: Kennzahlen aus den Transkripten; unter dem Treiber auch die Messungen der Prognose (`messungen.jsonl` neben `zustand.json`, Abschnitt `prognose`). Unter dem Treiber liest es Fragen, Wartezeit, kalte Zeit und Starts aus `zustand.json` (`treiberZustand` im Einsatz).

## Was der Treiber tut

1. **Einer je Repository.** Die Sperre liegt in `<git common dir>/flotte/treiber.lock`, der Zustand daneben in `zustand.json`. Nach einem Neustart setzt der Treiber aus der Datei fort. Ein Lauf schreibt sein Log selbst und überlebt den Treiber. Läufe, die noch leben (PID und Startzeit passen), beobachtet der Treiber nur.
2. **Belegung** aus Adapter und Issues: Kollisionsstufen (keine 4, klein 3, mittel 2, groß 1 gleichzeitig, nie mehr als vier) und Reihenfolge-Kanten. Ein Epic startet erst nach dem Merge seines Vorgängers. Ein startbereites Epic mit `prio_label` (Standard `prio/hoch`, am Epic oder an einem Kind) kommt in die nächste Belegung; harte Kanten und Kollisionsstufen gelten weiter. Hält es nur eine Kollision zurück, startet nichts Neues, das mit ihm kollidiert; laufende Epics bricht der Treiber nie ab. Erst danach gilt der Gleichstand: Es gewinnt die Wahl, deren Epics weniger Gate-Bereiche (`gate_areas`) teilen. Jede neue Belegung nennt ihren Beleg, auch das prio-Label und warum ein prio-Epic wartet.
3. **Bremsen** in jedem Takt:
   - RAM über `ram.ps1`: `warn` und `hold` halten an, weiter geht es erst 5 Punkte unter der Warnschwelle. Ein Messfehler gilt als `hold`, mit seinem Fehlertext; die nächste gute Messung gibt frei.
   - Plattenplatz.
   - Verbrauch je Konto aus dem `rate_limit_event` der Läufe, in `<CLAUDE_CONFIG_DIR>/flotte/verbrauch.json`. Gelb startet nichts Neues, Rot hält auch Fortsetzungen an. Ein Wert, der älter als 30 Minuten ist, gilt als rot. Ein Lauf meldet nur etwa ein- bis zweimal je Zug, deshalb holt ab 15 Minuten ein Mini-Lauf mit Haiku einen frischen Wert, auch während auf dem Konto ein Lauf arbeitet. Das geschieht nur, wenn auf dem Konto etwas starten oder weiterlaufen will, also nicht, während alles auf den Menschen wartet.
4. **Fragen:** Der Admiral entscheidet, was sich bis zum Merge widerrufen lässt. Sein Schema lässt als `nr` nur die Nummern der Fragen zu. Jede Entscheidung kommt als Kommentar ans Issue; einflussreiche Entscheidungen kommen zusätzlich ins Logbuch. Was beim Menschen liegt, parkt nur die Pakete aus `Betrifft:`; die übrigen laufen weiter (`weiter ohne <Pakete>`). Mit `merge: nach_gate` sieht vor dem Merge kein Mensch den PR; dann liegen zusätzlich Schema und Migration, ADRs, der Umfang des Epics, das Löschen von Daten und alles nach außen Sichtbare beim Menschen, auch gegen eine Empfehlung des Laufs.
5. **Fehler:**
   - Ein Fehlstart wird höchstens zweimal neu gestartet.
   - Bei einem Netzfehler setzt der Treiber höchstens zweimal mit `--resume` fort.
   - Endet ein Zug ohne Block, fragt der Treiber einmal nach; danach gilt der Lauf als abgebrochen.
   - Nach `--leerlauf-min` ohne Ausgabe beendet er den Zug und setzt ihn einmal fort. Beim zweiten Mal bricht er das Epic ab. Lebt unter dem Lauf ein Kindprozess (ein Gate, eine Testsuite), gilt die Stille als Arbeit, bis zum Vierfachen von `--leerlauf-min`; das Ereignis nennt den Kindprozess.
   - `permission_denials` blockieren das Epic, ohne zweiten Versuch.
   - Ausnahme sind Sperren von `guard.ps1`. Der Treiber gibt den Hook jedem Zug über `--settings` mit, weil der Hook des Skills nach `--resume` nicht mehr gilt. Nach einer Sperre darf der Lauf seinen Weg ändern, wie im Fenster. Blockiert wird das Epic erst in einem dieser Fälle:
     - Der Zug scheitert an der Sperre.
     - Dieselbe Regel sperrt ein zweites Mal.
     - Im Epic kommt die dritte Sperre.
   - Nach jedem toten Lauf räumt `CleanupStale` auf. Es verschont die Worktrees der Epics, die noch laufen oder warten: Jeder Lauf bekommt `EPIC_LOCK_HOLDER`, eine Datei in `<git common dir>/flotte/halten/`. Der Treiber löscht sie erst, wenn das Epic endet.
6. **Ende eines Laufs:**
   - Der PR aus `FLOTTE-ENDE` muss offen sein und den Epic-Branch `epic/<nr>-…` als Head haben. Sonst mergt und beobachtet der Treiber ihn nicht; die Frage, welcher PR zum Epic gehört, geht an den Menschen (Frage 99), und der ganze Lauf wartet.
   - Mit `merge: nach_gate` kommt das Epic in die **Merge-Schlange**, in der Reihenfolge seines `FLOTTE-ENDE`. Nur ihr Kopf ist dran, neben der Schleife: Während `merge.ps1` und das Gate laufen, beantwortet der Treiber andere Läufe.
     - **Basis:** Die Basis des PRs muss die erwartete sein: `base_branch` des Adapters, sonst `main_branch`, sonst der Standardzweig der Forge. Passt sie nicht oder steht `from-issue` im Adapter, mergt ein Mensch. `merge.ps1` prüft das noch einmal und liest den Adapter dafür vom Standardzweig, nicht von der Basis des PRs.
     - **Gate-Nachweis:** Der letzte Lauf im Gate-Block des PRs muss im Log des Laufs als Ausgabe eines echten Gate-Aufrufs stehen: grün, mit derselben Basis, demselben Head und derselben Art (voll oder Immer-Teil). Es zählt nur das Ergebnis eines Bash- oder PowerShell-Aufrufs, dessen Befehl `gate_command` oder `gate_always_command` enthält (führende Env-Zuweisungen wie `$env:X='0';` abgeschnitten); das Ergebnis wird über seine `tool_use_id` dem Aufruf zugeordnet, auch in Subagenten. Ein Block, den der Lauf nur geschrieben, mit `gh pr view` gelesen, mit `echo` ausgegeben oder per Read aus einer Datei geholt hat, reicht nicht. Fehlt der Nachweis, fährt der Treiber das volle Gate selbst (wie unten); ohne `gate_command` mergt ein Mensch.
     - Mit Nachweis mergt `merge.ps1`, wenn der Block gültig ist.
     - Sonst holt der Treiber selbst die Basis in den Epic-Worktree (`git merge origin/<basis>`), fährt `gate_command` des Adapters dort, schreibt den Block in die PR-Beschreibung, pusht und mergt. Hat sich die Basis seit dem letzten vollen grünen Lauf nur in Bereichen bewegt, die das Epic nicht berührt (`gate_areas`), fährt er nur `gate_always_command`. Hat die Sitzung des Laufs den Epic-Worktree mitgenommen, legt der Treiber ihn mit `worktree.ps1 Up` neu an und baut ihn nach dem Merge mit `Down` ab.
     - Ein Konflikt oder ein rotes Gate geht mit der Ausgabe an den Lauf zurück (`--resume`); das Epic stellt sich hinten an, die Schlange läuft weiter. Ein rotes Gate setzt den Worktree auf den Stand des PRs zurück. Nach zwei Rückgaben wird das Epic bei der dritten blockiert.
     - Bei n Epics in der Schlange sind so höchstens n−1 Gate-Wiederholungen nötig. Der Zähler steht als `gateWiederholungen` je Epic und in der Statistik; nach drei eigenen Gate-Läufen für dasselbe Epic wird es blockiert.
     - Ohne `gate_command` im Adapter lässt sich kein Gate nachweisen: Der Treiber ruft `merge.ps1` nicht auf, ein Mensch mergt.
   - Mit `merge: mensch` (Standard) meldet er „PR bereit“ und erkennt den Merge später.
   - Nach dem Merge: die `nach_merge`-Befehle des Adapters, dann `CleanupStale`, dann der lokale Epic-Branch, wenn er ganz in `origin/<basis>` liegt. Bekommt ein anderer offener PR außerhalb der Schlange einen Konflikt, geht ein Auftrag an dessen Lauf.
7. **Sichtbar:**
   - Tafel: `<git common dir>/flotte/tafel.html` im Browser öffnen; sie lädt sich selbst neu. Sie zeigt je Lauf den letzten Schritt und seine Zeit und die Merge-Schlange.
   - Keine Lauftafel je Lauf: Jeder Auftrag an `/epic` und `/epic-nacharbeit` sagt `Lauftafel aus` (`epic/references/lauftafel.md`, „Lauftafel aus"). Den Stand zeigen Brücke und Forge.
   - Logbuch: ein Issue mit Label `flotte`, mit dem KIBO-Block. Die Bremse steht dort nur als Stufe, nie in Prozent.
   - **Prognose:** Je fertigem Epic schreibt der Treiber eine Messung nach `messungen.jsonl` (Arbeitszeit ohne Warten auf den Menschen, Gate-Zeit, Pakete mit Klasse und Eskalationen aus dem Log). Ab `prognose_ab` (Standard 5) Messungen meldet er der Brücke je wartendem Epic und für den Backlog eine Monte-Carlo-Spanne (P50–P90) und prüft sich selbst; unter 60 % Treffern blendet die Brücke sie aus. Einzelheiten: `README.md`, „Prognose“.
   - **Flottenbrücke** (`flottenbruecke/`, mit `--bruecke`): Der Treiber meldet ihr in jedem Takt seinen Zustand (mit Kind-Tickets je Epic, Verbrauch je Konto, Ereignissen und Admiral-Entscheidungen) und holt die Antworten und Handlungen ab, die der Mensch dort gegeben hat: blockiertes Epic neu einreihen oder aufgeben, eine Entscheidung des Admirals zurücknehmen. Nur der Treiber spricht mit ihr, Läufe und Admiral sehen sie nicht. Ein Ereignis (neue Frage, Stufenwechsel, Merge) meldet er sofort; solange eine Frage offen ist, fragt er alle 10 s nach Antworten. Ist sie aus, arbeitet er weiter (ein Ereignis, kein Fehler). Schnittstelle: `flottenbruecke/SCHNITTSTELLE.md`.

## Was beim Menschen liegt

- **Fragen**, die der Admiral nicht entscheiden darf. Sie stehen als `FRAGE AN DEN MENSCHEN` am Issue, auf der Tafel und vollständig auf der Brücke (Frage, Lage, Optionen, Empfehlung, Betrifft, Wortlaut). Lässt sich ein Block nicht in Fragen zerlegen, geht sein Wortlaut an den Menschen; keine Frage verschwindet still. Antwort mit `flotte antworten …` oder auf der Brücke (Option, bei `— Auswahl: mehrere` mehrere als Kästchen, Freitext oder beides; der Freitext erreicht den Lauf unverändert als `Antwort: <Text>`).
- **Mergen** bei `merge: mensch`, und das Umstellen auf `nach_gate` im Adapter.
- **Konto anmelden**, wenn ein Lauf mit einem Anmeldefehler endet (das Epic steht dann auf „blockiert“).
- **Widerruf** einer Entscheidung: als Kommentar am Issue oder auf der Brücke („Zurücknehmen“ bis zum Merge). Der Lauf setzt ihn im nächsten Zug oder in der Nacharbeit um; ein Epic in der Merge-Schlange geht dafür zurück an den Lauf.
- **Blockierte und abgebrochene Epics:** Der Grund steht am Issue und auf der Brücke. Dort lässt sich das Epic neu einreihen (Zähler zurück, der Lauf setzt mit dem Grund fort) oder aufgeben (`abgebrochen`, Branch, PR und Issue bleiben). Endete der Einsatz, weil alles blockiert war, wirkt die Handlung beim nächsten Start.
- **Vorrang** eines Epics: das Label `prio/hoch` (Adapter `prio_label`) am Epic oder an einem Kind.

Umschalten von `/epic-flotte` und zurück: `references/umschalten.md`.
