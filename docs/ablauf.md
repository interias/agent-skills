# Wie eine Mission läuft

Die Bilder dazu stehen in der [README](../README.md#wie-eine-mission-läuft); hier steht, was sie nicht zeigen.

## Zwei Wege, ein Andocken

Ob der Treiber oder du im Chat einen Lauf startest, ändert nichts daran, wer andockt. Der Treiber ist
der Regelweg, auch für eine einzelne Mission: Er verteilt Läufe auf Konten, bremst bei vollem Speicher
oder Limit, legt dir nur die Fragen vor, die bei dir liegen, und fährt `/mission-nacharbeit` von selbst.
Einen Lauf im Chat startest du, wenn du eine Mission begleiten willst, etwa das Vorab-Tor selbst
beantworten; dann gehört `/mission-nacharbeit` vor das Andocken, solange der PR offen ist.

## Die Implementierungsschleife

Ein **Lauf** (`/mission`) liest die Mission, schneidet sie in Pakete, fragt einmal am Vorab-Tor und setzt
dann bis zu drei Pakete gleichzeitig um, jedes in eigenem Worktree. Je Paket:

1. **Schneiden:** Der Orchestrator gibt jedem Paket eine **Paketklasse** — *mechanisch*, *Standard* oder
   *Urteil*. Sie wählt Modell und Denkstufe: so günstig wie möglich, so stark wie nötig.
2. **Ingenieur:** baut das Paket, Test zuerst, wo Verhalten entsteht. **Gezielt iterieren, einmal voll:**
   Während der Arbeit laufen nur die Tests der berührten Dateien; die volle Suite läuft einmal am Ende,
   ihr Protokoll geht in den Bericht.
3. **Erster Offizier:** prüft gegen die Abnahmekriterien und die Regeln des Repos, mit gezielten Tests und
   Gegenproben, ohne eigenen Volllauf. Findet er eine **strukturelle** Abweichung, läuft die nächste Runde
   eine Klasse höher (**Eskalation**); ein verletzter Abnahmepunkt allein eskaliert nicht.
4. **Nachprüfung und Andocken auf den Missions-Branch:** Der Orchestrator fährt den einen Volllauf je
   betroffener Suite, der neben dem des Ingenieurs vorgesehen ist, und dockt das Paket sofort an. Das
   Fenster gleitet: Ist ein Platz frei, startet das nächste Paket, ohne auf die Nachbarn zu warten.

Am Ende steht ein offener Pull Request mit dem Andockblock. Den Stand zeigt im Einzellauf die
**Lauftafel** im Browser; unter dem Treiber zeigt ihn die Brücke. Alle Regeln:
[`mission/SKILL.md`](../mission/SKILL.md), Modelle und Denkstufen:
[`mission/README.md`](../mission/README.md#modelle-und-denkstufen).

**Warum so geschnitten:** Tests sind der größte Zeitposten eines Pakets. Jede Suite läuft je Paket
höchstens zweimal voll (Ingenieur und Nachprüfung), alles andere gezielt. Teure Modelle nur, wo Urteil
gefragt ist; reine Lesearbeit geht an Kundschafter.

## Wenn ein Lauf fragt

Ein Lauf fragt nie im Chat, sondern mit einem Frageblock an den Treiber. Der Admiral entscheidet, was
nicht bei dir liegt ([Wer entscheidet](befugnisse.md)); nur der Rest erscheint auf der Brücke unter
„Braucht dich“. Deine Antwort holt der Treiber im nächsten Takt ab, der Lauf macht weiter. Jede
Entscheidung steht danach am Issue und ist bis zum Andocken widerrufbar.

## Loslegen

1. **Installieren:** wie in [`INSTALL.md`](../INSTALL.md).
2. **Adapter anlegen:** `.claude/epic.md` im Zielprojekt. Soll die Flotte dort fahren, macht
   `/flotte-einrichten` das Repository in einem Zug flottentauglich (Adapter, Andockprüfung, Forge,
   Nachtlauf, Anmeldung an der Brücke); `flotte pruefen <ordner>` meldet, was fehlt. Die Skripte lesen nur das Frontmatter;
   alle Schlüssel und Standards stehen in [`mission/references/adapter.md`](../mission/references/adapter.md).
   Fehlt der Adapter, leitet der erste Lauf ab, was geht, fragt den Rest am Vorab-Tor und bietet an,
   die Datei abzulegen.

   ```yaml
   ---
   forge: github
   push_remote: origin
   main_branch: main
   ready_label: ready-for-agent
   epic_label: epic
   test_commands:
     unit: npm test
   lint_commands:
     web: npm run lint
   isolation: none-needed
   merge: mensch
   ---
   ```

   Erst `isolation: none-needed` (mit Begründung in der Prosa darunter) oder `test_isolation_env`
   lässt drei Pakete gleichzeitig laufen. Mit `merge: nach_gate` dockt der Treiber nach grüner
   Andockprüfung an; dafür braucht er `gate_command`.

   Labels im Repository: `ready-for-agent` (Freigabe), `epic` und für den Flotten-Treiber
   `prio/hoch` (Vorrang in der nächsten Belegung, Name über `prio_label` änderbar).

3. **Erster Lauf:** eine Mission mit `ready-for-agent` freigeben, in Claude Code im Projekt
   `/mission #<nr>` aufrufen, am Vorab-Tor antworten, am Ende den Pull Request prüfen und andocken.
   Danach `/mission-nacharbeit` und nach dem Andocken `/mission-aufraeumen`.
4. **Flotte fahren:** aus einem Terminal im Projektordner, nicht aus einer Sitzung (Bun nötig):

   ```powershell
   bun "$HOME\.claude\skills\flotte\src\cli.ts" fahren --konten 1,2 --bruecke http://127.0.0.1:4747
   ```

   Ohne `--epics` nimmt der Treiber alle freigegebenen Missionen. Das zweite Konto richtet
   [`arbeitspferd/einrichten.ps1`](../arbeitspferd/README.md) ein, die Brücke startet mit
   `docker compose up -d` in [`flottenbruecke/`](../flottenbruecke/README.md). Alle Schalter:
   [`flotte/SKILL.md`](../flotte/SKILL.md).
