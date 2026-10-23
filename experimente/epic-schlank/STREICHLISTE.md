# Streichliste `epic-schlank`

Grundlage: `epic/` auf `main` 66966ec. Klassen nach der Einsortierung vom 20.10.2026: **Vertrag**
(Schlüssel, Regeln, Formate, die andere Skills oder Werkzeuge lesen), **Tor** (wann gefragt,
angehalten, zurückgelassen wird), **Choreografie** (Ablaufbeschreibung, die ein aktuelles Modell
ohne Vorgabe ebenso erledigt, und Rhetorik). Gestrichen wird nur Choreografie. Vertrag und Tor
bleiben inhaltlich unverändert; ihre Begründungen werden auf einen Halbsatz gekürzt (Spalte
„Klasse“ = *Begründung*), nicht gestrichen.

**Freigegeben vom Menschen am 23.10.2026** (Vorab-Tor #32, Frage 2, Option B, Kommentar 28727):
die Zeilen 1–42 wie unten, ohne den Abschnitt „Verschoben“.

Die Spalte „gestrichen“ ist ein wörtlicher Ausschnitt aus `epic/`; nach der Streichung darf er in
`experimente/epic-schlank/` nicht mehr vorkommen (`grep -F`). Kursiv in Klammern steht, was an
seiner Stelle bleibt.

## SKILL.md

| # | gestrichen | Klasse | Grund |
|---|---|---|---|
| 1 | „Wie viel Sachverhalt und Herkunft dazugehört, entscheidest du nach Lage; der Mensch soll ohne Nachlesen wählen können.“ | Choreografie | Ermessen, das ein Modell ohnehin ausübt |
| 2 | „davor im Text eine kurze Lage, die empfohlene Option zuerst“ | Choreografie | Bedienung von `AskUserQuestion`; die Grenzen (vier Optionen, vier Fragen) bleiben als Werkzeug-Eigenheit |
| 3 | „Jede Label-Änderung zählt in der Forge als Änderung und setzt den Stillstand des Tickets auf null.“ | Choreografie | Erklärung ohne Handlung |
| 4 | „Ein `POST`, der still fehlschlägt, fällt sonst erst beim Nachzählen in Phase 6 auf — oder nie,“ | Begründung | auf Halbsatz *(„sonst fällt ein still gescheiterter POST erst in Phase 6 auf“)* |
| 5 | „Nicht jede Arbeit braucht das stärkste Modell.“ | Choreografie | Rhetorik |
| 6 | „Nicht aus dem README abschreiben — dort steht der Stand vom letzten Mal.“ | Choreografie | selbstverständlich, die Regel „messen“ bleibt |
| 7 | „ein fehlendes Abhängigkeitsverzeichnis fällt hier auf und nicht beim dritten Paket“ | Begründung | auf Halbsatz |
| 8 | „**Problem Statement** (der Schaden, der die naheliegende Lösung ausschließt), **Solution**,“ (Rollenbeschreibung der sieben Abschnitte) | Choreografie | Lesehilfe; es bleiben nur User Stories = Abnahmeliste und Decisions samt Begründung |
| 9 | „erst jetzt, weil er die Kinder braucht“ | Choreografie | Ablaufnarration |
| 10 | „Bodys altern.“ | Choreografie | Rhetorik |
| 11 | „Ein Implementer, der das ganze Issue bekommt, liefert Matsch.“ | Choreografie | Rhetorik |
| 12 | „**Ein Schema-Versionssprung ist querschnittlich:**“ (Schnittregel) | Choreografie | Planungsrat ohne Vorfall; als Kriterium der Klasse *Urteil* bleibt er |
| 13 | „Der Graph wird nach dem Sortieren **nicht weggeworfen**“ | Choreografie | doppelt zu „Diese Wahl triffst du bei jedem frei werdenden Platz neu“ |
| 14 | „Ist der Graph so dicht, dass nie zwei Pakete gleichzeitig laufen, ist das eine Eigenschaft des“ | Choreografie | Ablaufkommentar |
| 15 | „Der Sinn dieses Ablaufs ist der unbeaufsichtigte Lauf.“ | Begründung | auf Halbsatz am Tor |
| 16 | „Je Paket eine Task anlegen (Task-Werkzeug der Sitzung, falls vorhanden), in Reihenfolge.“ | Choreografie | Sitzungsbuchhaltung, die Tafel trägt den Stand |
| 17 | „Den Graphen zeigt die Pakettabelle“ / „das ist ein gültiger Zustand“ (in 2d) | Choreografie | doppelt zu `references/lauftafel.md` |
| 18 | „Ein Grund, der nur im Chat steht, führt zu einem vergessenen Ticket oder einem in falscher Reihenfolge.“ | Choreografie | doppelt zu Regel 8 |
| 19 | „KIBO gruppiert danach, und ein späterer Lauf unterscheidet daran Kind und“ | Begründung | auf Halbsatz |
| 20 | „Danach **ohne Rückfrage** losarbeiten.“ | Choreografie | doppelt zu Regel 10 |
| 21 | „Kein Wellenmodell mit Barrieren —“ | Choreografie | Rhetorik |
| 22 | „Hängen zwei Pakete am selben Vorgänger und kollidieren miteinander,“ | Choreografie | Beispiel zur Wahlregel, die Regel selbst bleibt |
| 23 | „Warum höchstens drei: du fährst jeden Verifikationsweg selbst nach und liest jeden“ | Begründung | auf Halbsatz *(„deine Nachprüfung ist die Engstelle“)* |
| 24 | „genau dort fällt es am leichtesten aus, weil der Start dann mitten in der Merge-Checkliste passiert“ | Begründung | auf Halbsatz |
| 25 | „Ein Wächter ohne Nachweis, dass er feuern kann, ist schlimmer als keiner.“ | Choreografie | Rhetorik, die Regel Positiv-/Gegenprobe bleibt |
| 26 | „ein zweiter im Review hat bisher keine Regression gefunden, die 4c nicht auch gefunden hätte,“ | Begründung | auf Halbsatz |
| 27 | „Ein Agent, der „alle Suiten grün" meldet, hat nichts über die Vollzähligkeit gesagt.“ | Choreografie | Rhetorik; die Lehre „gesunkene Zahl trotz Grün“ bleibt |
| 28 | „Der Paket-Branch lebt Minuten statt Stunden neben dem Epic-Branch“ | Begründung | auf Halbsatz |
| 29 | „So bleibt der Epic-Branch grün, und der Lauf hält nicht an.“ | Choreografie | doppelt zu Regel 10 |
| 30 | „eine Tafel, die nach dem dritten Merge den Anfang zeigt, sieht aktuell aus und ist falsch“ | Choreografie | doppelt zu `references/lauftafel.md` |
| 31 | „Das ist der Schritt, der am leichtesten ausfällt, weil sich der Lauf nach dem Pull Request fertig anfühlt.“ | Choreografie | Rhetorik ohne Vorfall |
| 32 | „lügt wie eine Tafel, die stehen bleibt“ | Choreografie | Rhetorik |
| 33 | „Ein Abbruch, der nur im Chat steht, ist von „noch nicht angefangen" nicht zu“ | Choreografie | doppelt zu Regel 8 |
| 34 | „Prüfe die Tabelle nach, statt sie anzunehmen.“ | Choreografie | doppelt zu „Nachzählen“ in Phase 6 |
| 35 | „Der Chat ist weg, sobald die Sitzung endet; die Forge ist der Ort, an dem in einem halben Jahr noch steht,“ | Begründung | auf Halbsatz *(„der Chat endet mit der Sitzung“)* |
| 36 | „Du schneidest, prüfst nach, mergst und schreibst zurück in die Forge.“ | Choreografie | Ablaufnarration, der Rest des Abschnitts sagt es |

## references/

| # | gestrichen | Klasse | Grund |
|---|---|---|---|
| 37 | `lauftafel.md`: „Ohne diesen Wert sieht eine liegengebliebene Tafel aus wie eine laufende.“ | Begründung | auf Halbsatz |
| 38 | `lauftafel.md`: „Eine Tafel, die nach dem dritten Merge noch den Anfang zeigt, ist schlimmer als keine, denn sie“ | Choreografie | Rhetorik |
| 39 | `lauftafel.md`: „Sonst gewöhnt sich der Leser an, über Glut hinwegzulesen.“ | Begründung | auf Halbsatz |
| 40 | `lauftafel.md`: „Eine nackte Gesamtzahl zwingt zum Nachzählen.“ | Choreografie | Rhetorik |
| 41 | `worktree.md`: „Rechne mit dem Fehlschlag.“ | Choreografie | doppelt zum folgenden Satz |
| 42 | `worktree.md`: „statt drei Agenten dieselbe Sackgasse ablaufen zu lassen.“ | Choreografie | doppelt zu SKILL.md 4a |

Nicht gestrichen in `references/`: `adapter.md` (Vertrag), `forge.md` (Vertrag und
Gitea-Eigenheiten), `lauftafel.html` (Vorlage), die Design- und Prüfabschnitte von
`lauftafel.md` (Vertrag mit der Flottentafel).

## Verschieben vom Menschen abgelehnt

**Abgelehnt am 23.10.2026** (Vorab-Tor #32, Frage 2, Option B; Kommentar 28727): Das
A/B-Experiment soll nur die Streichung der Choreografie messen. Nichts wird verschoben; `SKILL.md`
bleibt bei ≈ 640 Zeilen, und „≤ 500 Zeilen“ aus Story 2 bleibt offen. Der Vorschlag lautete:

| verschoben | nach | bleibt in SKILL.md |
|---|---|---|
| „Die Statuslabels“ (Wann-Tabelle, Aufräumen beim Start, fehlende Labels) | `references/statuslabels.md` | die drei Namen, „steuern nichts“, „höchstens eines“, Nachlesen nach jedem Setzen |
| 4a/4b: die ausgeschriebenen Auftragsinhalte für Implementer und Reviewer | `references/auftraege.md` | Agent-Typ, Vordergrund/Hintergrund, Statuslabel beim Start, Reviewer ohne Volllauf, Korrektur nur im Kleinen, `max_rounds` |

## Was als Lehre bleibt (je ein Satz)

Jede Zeile muss in `experimente/epic-schlank/` noch zu finden sein (Suchwort in der dritten Spalte).

| Lehre | Herkunft | Suchwort |
|---|---|---|
| Gitea: nur englische Schließwörter, 412 bei offenen Blockern, Listen bei 50 gedeckelt, `WIP:` = Entwurf, 404 statt 401 | Werkzeug-Eigenheit | `HTTP 412` |
| Gesunkene Suiten- oder Testzahl ist ein Befund, auch wenn alles grün ist | Werkzeug-Eigenheit | `gesunkene` |
| Reviewer-Diff `git -C <worktree> diff HEAD`, nicht gegen den Epic-Branch | Werkzeug-Eigenheit | `diff HEAD` |
| Neue Dateien stehen in keinem Diff, darum namentlich übergeben | Werkzeug-Eigenheit | `in keinem` |
| Ein Trockenlauf sieht die schreibenden Aufrufe nicht | Werkzeug-Eigenheit | `Trockenlauf` |
| Rot nur in unberührten Dateien und einzeln grün = Lastflake | Werkzeug-Eigenheit | `Lastflake` |
| Junction aus Git Bash wird still zur Kopie; rekursives Löschen folgt der Junction (KOKOS, 18.09.2026) | Vorfall | `18.09.2026` |
| `git branch -d` aus dem Hauptverzeichnis prüft gegen dessen Zweig | Werkzeug-Eigenheit | `branch -d` |
| Nach einem Revert bleibt der Branch: zurückholen = Revert des Reverts | Werkzeug-Eigenheit | `Revert des Reverts` |
| `EnterWorktree` scheitert im Repository-Hauptverzeichnis | Werkzeug-Eigenheit | `EnterWorktree` |
| Kommentare und Bodys aus einer Datei, die Shell zerlegt Backticks still (#31, zwei Vorfälle) | Vorfall | `aus einer Datei` |
| Gitea ignoriert einen Label-Filter auf ein fehlendes Label | Werkzeug-Eigenheit | `Gitea ignoriert einen Label-Filter` |
| Ohne gezeichnetes Fenster: „per Test belegt, nicht gesichtet“ | Werkzeug-Eigenheit | `nicht gesichtet` |
| Squash gegen `--merged` (in `epic-aufraeumen`, nicht Teil dieser Fassung) | Werkzeug-Eigenheit | — |
| `python -I` (Systemumgebung, nicht Teil dieser Fassung) | Werkzeug-Eigenheit | — |

## Prüfung

Aus dem Wurzelverzeichnis des Repositorys; Exit-Code ungleich 0, sobald (a), (b) oder (c) etwas
meldet. Die Ausschnitte sind der Text zwischen „ und “ in Spalte 2 der beiden Tabellen oben;
Zeilenumbrüche, Einrückung und Mehrfach-Leerzeichen zählen als ein Leerzeichen.

```bash
node - <<'EOF'
const fs = require('fs'), path = require('path');
const norm = s => s.replace(/\s+/g, ' ');
const files = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]);
const text = (d, skip) => norm(files(d).filter(f => /\.(md|html|ps1)$/.test(f) && path.basename(f) !== skip)
  .map(f => fs.readFileSync(f, 'utf8')).join('\n'));
const liste = fs.readFileSync('experimente/epic-schlank/STREICHLISTE.md', 'utf8').split(/\r?\n/);
const original = text('epic'), schlank = text('experimente/epic-schlank', 'STREICHLISTE.md');
const stellen = liste.filter(z => /^\| \d+ \|/.test(z)).flatMap(z =>
  [...z.split(' | ')[1].matchAll(/„([^“]*)“/g)].map(m => [z.split(' | ')[0].slice(2), norm(m[1])]));
const woerter = liste.slice(liste.indexOf('## Was als Lehre bleibt (je ein Satz)'))
  .map(z => z.match(/\| `([^`]+)` \|$/)).filter(Boolean).map(m => m[1]);
let fehler = 0;
const melde = s => { fehler++; console.log(s); };
for (const [nr, s] of stellen) {
  if (!original.includes(s)) melde(`(a) Zeile ${nr} nicht im Original: ${s}`);
  if (schlank.includes(s)) melde(`(b) Zeile ${nr} noch da: ${s}`);
}
for (const w of woerter) if (!schlank.includes(w)) melde(`(c) Lehre fehlt: ${w}`);
const zeilen = fs.readFileSync('experimente/epic-schlank/SKILL.md', 'utf8').split('\n').length - 1;
console.log(`(d) SKILL.md: ${zeilen} Zeilen (Story 2 verlangt ≤ 500; vom Menschen bewusst offen gelassen)`);
console.log(`${stellen.length} Ausschnitte, ${woerter.length} Suchwörter, ${fehler} Fehlschläge`);
process.exit(fehler ? 1 : 0);
EOF
```
