# Probe Missions-Programm (agent-skills#69): vorher und nachher

Dieselben drei Mini-Missionen laufen in `interias/flotte-probe` zweimal **vorher** (Stufe 0, #64:
heutiges `/mission` unter dem Treiber) und zweimal **nachher** (Stufe 4, #68: `flotte mission` unter dem
Treiber). Gemessen wird beide Male mit `flotte messen`, Abschnitt `epic_laeufe`.

## Aufbau

| Datei | wohin | was |
|---|---|---|
| `epic.md` | `.claude/epic.md` | Adapter: `issue_form: tickets`, `window: 3`, `merge: nach_gate`, Andockprüfung als einziger Testbefehl, Bereiche `obst/`, `verse/`, `thema/` |
| `gate.ps1` | `werkzeug/gate.ps1` | Andockprüfung in der Form von Probe 3, ohne Compose-Dienst |
| `regeln.ps1` | `<git common dir>/probe-regeln.ps1` | verdeckte Regeln und Auslöser, außerhalb des Arbeitsbaums |
| `basis/` | `obst/`, `verse/`, `thema/` | Ausgangsstand der Bereiche |
| `mini-epic-a.md` … `-c.md` | Issues | Mission und Missionsziele, angelegt über die GitHub-API |
| `vorbereiten.ps1` | – | richtet alles ein, ein Commit auf `main`, legt die Issues an, schreibt die Auslöser |
| `versuche.ps1` | – | die vier Versuche mit `claude -p` (unten) |
| `einsatz.vorlage.json` | – | Vorlage für `flotte messen` |

`vorbereiten.ps1` kopiert dazu den Skill `mission` dieses Repositorys als Projekt-Skill
`.claude/skills/epic-stapel/` (geändert sind nur `name` und der Pfad des Hooks) und die Agenten aus
`agents/` **unverändert mit ihren Modellen** nach `.claude/agents/` (Sonnet und Opus je Paketklasse,
nicht Haiku wie in Probe 3).

**Verdeckte Regeln.** Die Issues nennen sie nicht, der Adapter sagt nur „Was die Andockprüfung darüber
hinaus verlangt, sagt ihre Ausgabe“. Im Vorlauf standen sie in der Andockprüfung selbst. Die Läufe lasen sie
dort, serialisierten die Pakete und hielten die Auslöser zu Recht für Lastflakes. Seitdem liegen
sie in der Git-Ablage.

## Mini-Missionen und welche Fälle sie tragen

| Mini-Mission | Pakete | Kante | gedacht für |
|---|---|---|---|
| A Obstkorb | a1, a2, a3: je eine Datei in `obst/` | keine | volles Fenster; verdeckt muss jede Datei in `obst/REGISTER.md` stehen, parallele Pakete fügen an derselben Stelle ein: **P14** Konflikt mechanisch |
| B Verse mit Wächter | b1 Wächter in der Andockprüfung (*Urteil*), b2 Vierzeiler, b3 Zweizeiler | b2 nach b1 | harte Kante, eine Urteil-Klasse (Opus); Auslöser `probe-rot-epic`: der erste Kopf des Missions-Branches, der b3 angedockt hat (das Andocken bringt `verse/fruehling.txt`), macht `verse` rot, bis zum Revert; fest an b3, in beiden Motoren gleich: **P13** |
| C Themen | c1 Thema nacht, c2 Thema sommer | keine | verdeckt verlangt `thema/STAND.md` eine höhere Version und einen Grund, beide Pakete schreiben verschiedene Gründe in dieselben Zeilen: **P15** Konflikt inhaltlich; Auslöser `probe-rot-paket` an c1: ab dem zweiten Lauf der Andockprüfung ist `thema` rot, bis `thema/KONTRAST.md` die Zeile `- nacht` hat: **P10** |

Ob ein Fall eintritt, entscheidet der Lauf: Erkennt der Orchestrator die Kopplung vorher, legt er
eine Kollisionskante und es gibt keinen Konflikt. Was je Lauf eintrat, steht unten.

## Aufruf

Ein Klon von `flotte-probe` unter `<probe>`, ein Treiber zur Zeit. Alle Vorher- und Nachher-Läufe
fahren auf Konto 2 (`--konten 2` ist `~/.claude-arbeitspferd`, `flotte/src/werkzeuge/konten.ts`);
der Vorlauf auf Konto 3 ist nur Referenz:

```
pwsh -NoProfile -File flotte/probe/programm/vorbereiten.ps1 -Probe <probe> -Lauf vorher-1
cd flotte
bun src/cli.ts fahren <probe> --forge interias/flotte-probe --epics <A>,<B>,<C> --konten 2 \
  --skill epic-stapel --modell opus --admiral-modell haiku --admiral-effort keine --obergrenze 3 \
  --leerlauf-min 15 --takt-s 15 --ohne-docker --ohne-nacharbeit --max-min 120
```

`--max-min 120` statt des Richtwerts 90, weil drei Missionen gleichzeitig laufen. Nach dem Lauf
`<probe>/.git/flotte` sichern (der nächste Lauf schreibt dort weiter). Nachher (Stufe 4) gilt
derselbe Aufruf; nur der Schalter in `flotte-probe` wechselt von `/mission` zu `flotte mission`:
`vorbereiten.ps1 … -Lauf nachher-1 -Motor programm` (Abschnitt „Der Schalter“).

Messen: `einsatz.vorlage.json` ausfüllen (Nummern aus `vorbereiten.ps1`, Kante b2 → b1), dann
`bun src/cli.ts messen <einsaetze.json> --name vorher-1`.

## Läufe vorher

| Lauf | Missionen | Treiber | PRs | Ergebnis |
|---|---|---|---|---|
| Vorlauf (21.11.2026, Konto 3) | #54, #58, #62 | 14:27–14:36 UTC | #66, #67, #65 | alle angedockt; Regeln noch in der Andockprüfung |
| vorher-1 (21.11.2026, Konto 2) | #68, #72, #76 | 15:46–15:57 UTC | #79, #80, #81 | #80 und #81 angedockt; #68 lieferte PR #79, der Treiber wertete es als blockiert (unten), #79 blieb offen |
| vorher-2 (21.11.2026, Konto 2) | #82, #86, #90 | 15:59–16:24 UTC, erster Start 16:13 | #95, #94, #93 | alle angedockt; bis 16:13 hielt die Verbrauchsbremse von Konto 2 die Starts an |

Der erste Versuch von vorher-1 auf Konto 3 hielt vor dem ersten Start an, weil das Kontingent
nicht reichte; die Issues blieben unverbraucht und liefen danach auf Konto 2.

**Vorlauf, gemessen mit `flotte messen`** (3 Missionen, 8 Pakete; Basis Index 100; mit dem
korrigierten „bis nächster Start“ nachgemessen, alle Werte unverändert):

| Kennzahl | Vorlauf |
|---|---|
| Verbrauch je Mission / je Paket | Index 100 / 100 |
| Anteil Orchestrierung (Orchestrator 85,1 %, Admiral 0,5 %) | 85,6 % |
| Ingenieur / Erster Offizier an der Mission | 7,4 % / 7,0 % |
| Ingenieur und Erster Offizier je Paket | 14,4 % des Paketverbrauchs (Index 100) |
| Durchlauf je Mission | Mittel 7,7 min (7,1 / 8,7 / 7,3) |
| angedockt bis nächster Start | Median 32 s, P90 43 s (n = 5) |
| Erster Offizier zurück bis nächster Start | Median 62 s, P90 100 s (n = 5) |
| Prüfzeit Erster Offizier zurück bis angedockt | Median 14,5 s, P90 68 s (n = 8); Modellzeit darin 46 % |
| Fensterverlust (obere Schranke) | 50,6 % |
| Ingenieur-Aufträge je Paket / Eskalationen | 1,0 / 0 |
| Ungültige Ausgaben (Admiral, `--json-schema`) | 0 von 3 |

Was eintrat: A und C liefen nacheinander, weil der Orchestrator die Regeln in der Andockprüfung las und
Kollisionskanten legte; daher kein P14/P15 und der hohe Fensterverlust. Beide Auslöser feuerten
(`wurzel` rot); die Läufe werteten das Rot nach der Lastflake-Regel (unberührter Kontext, einzeln
grün), also P11 statt P10/P13. Die Mini-Missionen sind so klein, dass der Orchestrator den Verbrauch
beherrscht; die Vorher-Zahl gilt nur für diesen Aufbau.

**vorher-1 und vorher-2, gemessen mit `flotte messen`** (je 3 Missionen, 8 Pakete; Index: Mittel der
beiden Vorher-Läufe = 100; Mittel der Zeiten und Quoten ist das Mittel der beiden Werte, Durchlauf
über alle Missionen; Zeiten als Median / P90):

| Kennzahl | vorher-1 | vorher-2 | Mittel | Vorlauf (Referenz) |
|---|---|---|---|---|
| Verbrauch je Mission / je Paket | Index 105 / 105 | 95 / 95 | 100 / 100 | 106 / 106 |
| Ingenieur und Erster Offizier je Paket | Index 101 | 99 | 100 | 87 |
| Anteil Orchestrierung | 83,2 % | 81,5 % | 82,4 % | 85,6 % |
| davon Orchestrator / Admiral | 82,8 % / 0,4 % | 81,5 % / 0 % | 82,2 % / 0,2 % | 85,1 % / 0,5 % |
| Ingenieur / Erster Offizier an der Mission | 8,3 % / 8,5 % | 9,9 % / 8,6 % | 9,1 % / 8,6 % | 7,4 % / 7,0 % |
| Ingenieur und Erster Offizier am Paketverbrauch | 16,8 % | 18,5 % | 17,7 % | 14,4 % |
| Durchlauf je Mission | 9,2 min (n = 2) | 8,8 min (n = 3) | 8,9 min (n = 5) | 7,7 min (n = 3) |
| angedockt bis nächster Start | 80 / 88 s (n = 3) | 45 / 72 s (n = 5) | 62,5 / 80 s | 32 / 43 s (n = 5) |
| Erster Offizier zurück bis nächster Start | 114 / 116 s (n = 3) | 65 / 127 s (n = 5) | 89,5 / 121,5 s | 62 / 100 s (n = 5) |
| Prüfzeit Erster Offizier zurück bis angedockt | 28 / 70 s (n = 8) | 14,5 / 64 s (n = 8) | 21,3 / 67 s | 14,5 / 68 s (n = 8) |
| Modellzeit in der Prüfzeit | 49 % | 47 % | 48 % | 46 % |
| Fensterverlust (obere Schranke) | 40,0 % | 58,7 % | 49,4 % | 50,6 % |
| Ingenieur-Aufträge je Paket / Eskalationen | 1,1 / 0 | 1,0 / 0 | 1,05 / 0 | 1,0 / 0 |
| Ungültige Ausgaben (Admiral, `--json-schema`) | 0 von 2 | 0 von 0 | 0 von 2 | 0 von 3 |
| Doppelt gestartete / doppelt angedockte Pakete | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

Der Durchlauf von vorher-1 fehlt für #68, weil der Treiber für eine blockierte Mission keine Messung
schreibt. In vorher-2 entschieden die Orchestratoren die Tor-Fragen selbst (✔-Zeilen), der Admiral
wurde nie gefragt.

Was eintrat:

| Fall | vorher-1 | vorher-2 |
|---|---|---|
| P14 Konflikt mechanisch (A) | ja: a1–a3 liefen parallel, beim zweiten und dritten Andocken Konflikt in `obst/REGISTER.md`, der Orchestrator behielt alle Zeilen | nein: der Orchestrator ließ a1–a3 nacheinander laufen, jedes Paket setzte auf das vorige |
| P13 Missions-Branch rot (B) | ja: nach dem Andocken von b3 `verse` rot, Revert, b3 mit `status/haengt` zurückgelassen, PR mit `WIP:` | ja: genauso (b3 zurückgelassen) |
| P10 Paket rot (C) | ja: c1 im zweiten Lauf der Andockprüfung rot, der Ingenieur lieferte `thema/KONTRAST.md` in Runde 2 | Auslöser feuerte im Ingenieur selbst, behoben in einer Runde |
| P15 Konflikt inhaltlich (C) | nein: Kollisionskante über `thema/`, c1 und c2 nacheinander | nein: dito |
| P11 Lastflake | nein | nein |

**Kontamination.** In beiden Läufen lasen die Orchestratoren (in vorher-2 alle drei, dazu einzelne
Ingenieure und Erste Offiziere) beim Rüsten `<git common dir>/probe-regeln.ps1`, weil die Andockprüfung diese
Datei lädt, und meldeten es offen. Die Regeln liegen also nicht verdeckt; „Was eintrat“ ist mit
diesem Wissen entstanden (vorher-2: A seriell). Nachher läuft mit demselben Aufbau, die Läufe
bleiben damit vergleichbar.

**Treiber, beobachtet.** #68 endete mit `FLOTTE-ENDE` und PR #79, hatte aber zwei abgelehnte
Bash-Aufrufe (zusammengesetzte Befehle, danach einzeln ausgeführt, also in anderer Form). Der
Treiber wertete das nach D19 als „blockiert: Erlaubnis verweigert“ und dockte #79 nicht an. Die Ereignisse nennen das einzige Konto
von `--konten 2` „Konto 1“ (Zählung in der Liste, nicht die Kontonummer).

## Der Schalter

`vorbereiten.ps1 -Motor programm` legt statt der Kopie von `/mission` die Hülle aus `huelle/` als
Projekt-Skill `epic-stapel` an (gleicher Name, gleiche `references/` und `scripts/`, dazu
`scripts/programm.ps1`) und schreibt den Pfad von `flotte/src/cli.ts` (`-Cli`) nach
`<git common dir>/probe-programm.txt`, außerhalb des Arbeitsbaums. Treiber, Aufruf, Agenten,
Adapter, Andockprüfung und verdeckte Regeln bleiben gleich; `-Motor skill` (Standard) stellt `/mission` wieder her.

Die Hülle tut keine Paketarbeit. Ihr einziger Befehl ist `programm.ps1 -Epic <nr>`:

- Läuft `flotte mission` nicht und ist die Mission nicht fertig, startet das Skript es hinter einem
  Zwischenprozess, der sofort endet: `--mechanik echt --aufrufe echt --konto <Konto des Laufs>
  --branch epic/<nr>-programm --antworten <epic dir>/antworten.txt --max-min 120`. So beendet weder
  das Zugende noch die Zeitgrenze des Shell-Werkzeugs das Programm; es läuft zwischen den Zügen weiter.
- Dann wartet es bis zu 500 s auf den nächsten Block in `bloecke.txt` und gibt ihn wörtlich aus. Die
  Hülle beendet ihren Zug mit genau diesem Text. Ohne Block meldet das Skript `LAEUFT`, und die
  Hülle ruft es sofort wieder auf. Ein Bash-Aufruf dauert so höchstens rund neun Minuten mit
  lebendem Kindprozess; der Treiber wertet das nicht als Leerlauf (Grenze 15 min).
- Antworten des Treibers (`1. A — Herkunft: …`) gibt die Hülle je Zeile mit `-Antwort '<Zeile>'`
  weiter. Das Skript schreibt `1: A` in die Antwortdatei, die das laufende Programm liest. Zeilen,
  die beim Menschen liegen, lässt es aus.
- Ist das Programm ohne Block gestorben, startet das Skript es neu; das Programm setzt seine
  Aufrufe mit `--resume` fort. Nach vier Starts meldet es `PROGRAMM GESCHEITERT`, und die Hülle
  endet ohne Block.

Jeder Befehl ist ein einfacher Aufruf ohne `cd`, `&&` oder Umleitung, und er steht in
`allowed-tools`. Ein abgelehnter zusammengesetzter Befehl (D19, vorher-1) kommt in der Hülle nicht
vor; in den Nachher-Läufen gab es keine Verweigerung und keine Hook-Sperre in einem Zug der Hülle.

**Modell der Hülle: Opus, wie der Orchestrator vorher.** Der Treiber startet jeden Lauf mit
`--modell opus`. `model: haiku` im Frontmatter des Skills hat `claude -p` in einem Vorversuch gegen
eine Attrappe des Programms nicht übernommen: Alle Nachrichten liefen weiter mit Opus. Haiku ginge nur über `--modell haiku` im Aufruf
des Treibers, und der bleibt vorher und nachher gleich. Die Hülle zählt als Orchestrierung (Rolle
Orchestrator) und ist unten mitgemessen.

## Läufe nachher

| Lauf | Missionen | Treiber | PRs | Ergebnis |
|---|---|---|---|---|
| nachher-1, erster Versuch (21.11.2026, Konto 2) | #108, #112, #116 | 20:42–20:46 UTC | – | technisch abgebrochen: drei Programme legten gleichzeitig ihre Missions-Worktrees an, `git worktree add -b` von A fand `.git/config` gesperrt, A endete sofort. B und C von Hand beendet, Issues bleiben unverbraucht offen |
| nachher-1 (Wiederholung) | #119, #123, #127 | 20:48–20:53 UTC | #131, #130, #132 | alle angedockt; Neustart echt ausgelöst (unten) |
| nachher-2 | #133, #137, #141 | 20:54–21:02 UTC | #144, #146, #145 | alle angedockt |

Die Ursache des Abbruchs ist im Programm behoben: `git` und `worktree.ps1 Up` versuchen es bei
einer Sperre von `.git/config` oder einer anderen `.lock`-Datei bis zu viermal
(`src/epic/mechanik.ts`, Test in `test/epic-mechanik.test.ts`). Der erste Start der Wiederholung
brach im Treiber ab, weil dessen Zustand die von Hand beendeten Läufe noch als laufend führte; sie
stehen dort jetzt auf `abgebrochen`, gestartet hatte noch nichts.

**Neustart.** In nachher-1 wurde `flotte mission` für A (#119) beendet, als drei Ingenieure liefen
(`taskkill /T`). Die Hülle startete es nach 1 s neu; nach weiteren 9 s liefen alle drei Ingenieure
wieder, mit `--resume` ihrer Sitzungen.

**Nachher gemessen mit `flotte messen`** (Index: Mittel der beiden Vorher-Läufe = 100; Zeiten als
Median / P90; Mittel der Quoten ist das Mittel der beiden Werte):

| Kennzahl | Ziel | vorher (Mittel) | nachher-1 | nachher-2 | nachher (Mittel) | Ergebnis |
|---|---|---|---|---|---|---|
| Verbrauch je Mission | ≤ 80 | 100 | 42 | 37 | 40 | erfüllt |
| Verbrauch je Paket | ≤ 85 | 100 | 48 | 43 | 46 | erfüllt |
| Anteil Orchestrierung | ≤ 6 % | 82,4 % | 38,9 % | 45,8 % | 42,4 % | verfehlt |
| davon Hülle / Schnitt / Konflikt / Admiral | – | 82,2 % (Orchestrator) / – / – / 0,2 % | 12,6 / 20,4 / 5,6 / 0,3 % | 14,2 / 26,7 / 4,3 / 0,5 % | 13,4 / 23,6 / 5,0 / 0,4 % | – |
| Ingenieur und Erster Offizier je Paket | ≤ 110 | 100 | 169 | 132 | 151 | verfehlt |
| Durchlauf je Mission | ≤ 75 % | 8,9 min (n = 5) | 3,6 min (n = 3) | 3,4 min (n = 3) | 3,5 min, 39 % | erfüllt |
| angedockt bis nächster Start | Median ≤ 30 s, P90 ≤ 2 min | 62,5 / 80 s | keine Stichprobe | keine Stichprobe | – | nicht messbar |
| Prüfzeit Erster Offizier zurück bis angedockt | ausgewiesen | 21,3 / 67 s | 13 / 61 s (n = 5) | 12 / 63 s (n = 5) | 12,5 / 62 s | ausgewiesen |
| Sprachmodell-Anteil der Prüfzeit | 0 | 48 % | 18 % | 18 % | 18 % | verfehlt |
| Fensterverlust (obere Schranke) | ≤ 5 % | 49,4 % | 28,9 % | 22,0 % | 25,5 % | verfehlt |
| Ingenieur-Aufträge je Paket | ≤ vorher + 0,1 (1,15) | 1,05 | 1,3 | 1,0 | 1,15 | im Mittel erfüllt, nachher-1 verfehlt |
| Eskalationen | gleich oder weniger | 0 | 0 | 0 | 0 | erfüllt |
| Ungültige Ausgaben (alle `--json-schema`-Aufrufe) | ≤ 2 % | 0 von 2 | 0 von 24 | 0 von 20 | 0 % | erfüllt |
| Neustart: bis zum ersten laufenden Worker | ≤ 60 s | 3,7–3,9 min (aus der Mission, nicht in dieser Probe gemessen) | 9 s (n = 1) | – | 9 s | erfüllt |
| Neustart: Sprachmodell-Verbrauch für den Wiederaufbau | 0 | 88 % davon Orchestrator (aus der Mission) | 0 (keine neuen Aufrufe, nur `--resume`) | – | 0 | erfüllt |
| Doppelt gestartete / doppelt angedockte Pakete | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | erfüllt |
| P14 / P15 echt ausgelöst | je einmal | P14 ja, P15 nein | P14 ja, P15 nein | P14 ja, P15 nein | – | P14 erfüllt, P15 verfehlt |
| P10 / P13 echt ausgelöst | je einmal | ja / ja | ja / ja | nein / ja | – | erfüllt |
| Pakete im PR (Ergebnis, kein Ziel der Tabelle) | – | 7 von 8 je Lauf | 5 von 8 | 5 von 8 | – | schlechter |

Gemessen sind nur Pakete mit einem Worker: b2 lief in keinem Nachher-Lauf (7 statt 8 Pakete). Die
Verbrauchs- und Zeitwerte nachher stehen also auf weniger und kürzerer Arbeit; der Index je Paket
gleicht das nur zum Teil aus.

„Angedockt bis nächster Start“ hat nachher keine Stichprobe, weil kein Paket nach einem Andocken startete:
a1–a3 und b1/b3 starteten zu Beginn gemeinsam, b2 blieb blockiert, c2 startete nach dem
Zurücklassen von c1, nicht nach einem Andocken.

Was eintrat:

| Fall | nachher-1 | nachher-2 |
|---|---|---|
| P14 Konflikt mechanisch (A) | ja: a1–a3 parallel, zwei Konflikte in `obst/REGISTER.md`, je ein Konflikt-Aufruf löste sie, Kollisionskanten nachgetragen | ja: genauso |
| P13 Missions-Branch rot (B) | ja: b3 wurde zuerst angedockt, ohne Lauf auf dem Missions-Branch (Baum gleich dem geprüften des Pakets); b1 (*Urteil*, der Wächter) danach mit Lauf, `verse` rot, Revert, b1 zurückgelassen; b2 hängt hart an b1 und blieb blockiert; PR mit `WIP:` | ja: genauso |
| P10 Paket rot (C) | ja: der Volllauf von c1 war rot (`thema/KONTRAST.md`), neue Runde; in Runde 2 wollte der Erste Offizier einen zusammengesetzten Befehl fahren, der Auto-Modus lehnte ab, c1 zurückgelassen | nein: c1 schon in Runde 1 zurückgelassen, der Erste Offizier las `probe-regeln.ps1` mit einem Pfad außerhalb des Worktrees, abgelehnt |
| P15 Konflikt inhaltlich (C) | nein: Kollisionskante über `thema/`, c2 nach c1 | nein: dito |
| P11 Lastflake | nein | nein |

Zwei Befunde erklären die schlechteren Ergebnisse. Erstens lässt das Programm ein Paket zurück,
sobald ein Aufruf eine `permission_denials` meldet (P8); unter `/mission` ändert ein Subagent nach einer
Ablehnung seinen Weg. Zweitens trifft der Auslöser von P13 das erste Andocken, nach dem auf dem
Missions-Branch geprüft wird. Das Programm prüft nach dem ersten Andocken nicht, weil der Baum dem schon
geprüften des Pakets gleicht; so traf es nachher b1, an dem b2 hängt, vorher b3. Das fehlende b2 ist
damit eine Folge des Auslösers der Probe, nicht der Andock-Reihenfolge (b3 wurde auch nachher zuerst
angedockt).
Der Orchestrierungsanteil kommt vor allem vom Schnitt-Aufruf und von der Hülle; ohne Hülle läge er
bei rund 26–32 %, auch dann über dem Ziel. Ingenieur und Erster Offizier kosten als eigener `claude -p` je
Paket mehr als als Subagent einer Sitzung.

Die Kontamination aus „Läufe vorher“ gilt auch nachher: In nachher-1 las der Ingenieur von c1 in
Runde 2 `probe-regeln.ps1`. Am Ergebnis ändert das wenig, weil die rote Meldung die Korrektur ohnehin
nennt.

Die Läufe der Hülle hatten keine Hook-Sperre und keine Verweigerung. Die Vorher-Zahlen rechnet das
erweiterte Werkzeug unverändert nach (Gegenprobe: `epic_laeufe` von vorher-1 und vorher-2 gleich bis
auf den neuen Schlüssel `neue_aufrufe_bis_worker` und den Methodentext).

## HALT 2

Befehle je Nachher-Lauf (Konto 2, ein Treiber zur Zeit):

```
pwsh -NoProfile -File flotte/probe/programm/vorbereiten.ps1 -Probe <probe> -Lauf nachher-1 -Motor programm
cd flotte
bun src/cli.ts fahren <probe> --forge interias/flotte-probe --epics <A>,<B>,<C> --konten 2 \
  --skill epic-stapel --modell opus --admiral-modell haiku --admiral-effort keine --obergrenze 3 \
  --leerlauf-min 15 --takt-s 15 --ohne-docker --ohne-nacharbeit --max-min 120
bun src/cli.ts messen <einsaetze.json> --name nachher-1
```

Ergebnis: nachher-1 (Wiederholung nach einem technischen Abbruch, Ursache im Programm behoben) und
nachher-2 liefen durch, alle sechs PRs angedockt, je 5 von 8 Paketen im PR (vorher 7 von 8). Erfüllt:
Verbrauch je Mission (40) und je Paket (46), Durchlauf (39 %), Eskalationen, ungültige Ausgaben,
Neustart (9 s bis zum ersten Worker, kein Verbrauch für den Wiederaufbau, nichts doppelt), P10, P13,
P14. Verfehlt: Anteil der Orchestrierung (42,4 % statt ≤ 6 %), Ingenieur und Erster Offizier je Paket
(151 statt ≤ 110), Sprachmodell-Anteil der Prüfzeit (18 % statt 0), Fensterverlust (25,5 % statt
≤ 5 %, obere Schranke), P15 nicht ausgelöst; Ingenieur-Aufträge nur im Mittel. „Angedockt bis
nächster Start“ hatte keine Stichprobe. Tabelle und Befunde: Abschnitt „Läufe nachher“. Über das
Umschalten entscheidet der Mensch.

## Verfehlte Ziele: was vor dem Umschalten gilt

Festgeschrieben nach der Triage von #108 und dem Vorab-Tor von Mission #161. Der Auslöser von P13 ist
seitdem fest an b3 (`regeln.ps1`), und P8 ist geändert; die Zahlen oben stammen noch aus der Zeit davor.

| Ziel | nachher (Mittel) | vor dem Umschalten |
|---|---|---|
| Pakete im PR | 5 von 8 je Lauf | **verlangt:** mindestens 7 von 8 je Lauf, nach der P8-Änderung und mit dem festen P13-Auslöser |
| Anteil Orchestrierung (≤ 6 %) | 42,4 % | nicht verlangt, nur ausgewiesen |
| Ingenieur und Erster Offizier je Paket (≤ 110) | Index 151 | nicht verlangt, nur ausgewiesen |
| Sprachmodell-Anteil der Prüfzeit (0) | 18 % | nicht verlangt, nur ausgewiesen |
| Fensterverlust (≤ 5 %) | 25,5 % | nicht verlangt, nur ausgewiesen |
| P15 Konflikt inhaltlich | nicht ausgelöst | nicht verlangt |

Die vier ausgewiesenen Ziele sind Anteile am Gesamtverbrauch. Der Verbrauch je Mission liegt schon bei
Index 40 (Ziel ≤ 80); bei so kleinem Gesamtverbrauch sind die Anteile zwangsläufig größer. P15 tritt
nicht ein, weil beide Motoren die Kollisionskante legen.

Gemessen wird mit `flotte messen`, Abschnitt `epic_laeufe`, an denselben drei Mini-Missionen in zwei
Läufen. Die Neumessung ist ausgelagert in Ticket #194: Die Probe braucht einen eigenen Treiber auf
Konto 2 und kann nicht unter einem laufenden Treiber starten. Ob ein verfehltes Ziel das Umschalten
aufhält, entscheidet der Mensch mit dem Umschalten selbst.

## Methode von `epic_laeufe`

- **Sitzungen** je Mission aus den Treiber-Logs (`laeufe/<nr>-*.jsonl`: Orchestrator,
  `admiral/<nr>-*.jsonl`: Admiral, je `session_id` aus dem `init`-Ereignis) und aus der Liste
  `sitzungen` im Einsatz. Fortsetzungen mit `--resume` bleiben in derselben Sitzung.
- **Rolle:** Subagent nach `agentType`. Eine Sitzung nach der Liste oder nach `agentSetting` im
  Transkript (das schreibt `claude -p --agent <name>`), sonst Orchestrator bzw. Admiral. So misst
  dasselbe Werkzeug heute (Sitzung und `subagents/`) und nachher (ein `claude -p` je Rolle).
- **Verbrauch:** `usage.ps1` je Sitzung mit `-ModelWeights opus=2;sonnet=1;haiku=0.33`. Haiku mit
  einem Drittel ist eine Annahme nach dem Verhältnis der Listenpreise. Orchestrierung umfasst
  Orchestrator, Admiral, Schnitt und Konflikt. Ein Paket trägt seine eigenen Aufrufe und einen
  gleichen Anteil der Orchestrierung.
- **Zeiten:** Ein Worker läuft von der ersten bis zur letzten Transkriptzeile. Ein Paket ist
  angedockt mit dem Ergebnis von `git merge … agent/<nr>-…` im Orchestrator. Gemessen werden
  „angedockt bis zum nächsten Start“ und „Erster Offizier zurück bis zum nächsten Start“, jeweils unter einer
  Stunde und nur bis zum Start eines Pakets, dessen harte Vorgänger beim Andocken angedockt waren. Die Prüfzeit läuft von „Erster Offizier zurück“ bis „angedockt“, mit der Modellzeit des
  Orchestrators darin. Durchlauf ist `arbeitS` aus `messungen.jsonl`.
- **Fensterverlust:** Ein Paket belegt seinen Platz vom ersten Worker bis zum Andocken. Verlust ist die
  Zeit, in der ein Platz frei war, während ein noch nicht gestartetes Paket alle harten Vorgänger
  angedockt hatte, als Anteil an der Zeit vom ersten Paketstart bis zum letzten Paketende. Kollisionskanten
  kennt die Messung nicht; der Wert ist eine obere Schranke.
- **Ungültige Ausgaben:** `result` ohne `structured_output` in den Logs der `--json-schema`-Aufrufe
  (vorher nur der Admiral).
- **Neustart:** Jeder weitere „Lauf gestartet“ des Treibers bis zum nächsten Worker-Start. Doppelt
  gestartet heißt: zwei Ingenieure desselben Pakets überlappen. Doppelt angedockt heißt: zweimal Andocken
  desselben Pakets.
- **`flotte mission` (nachher):** Neben dem Treiber-Zustand liegt `epics/<nr>/` des Programms. Jeder
  Aufruf ist eine Sitzung aus `aufrufe/<rolle>[-<paket>]-r<runde>.jsonl` (Rolle aus dem Dateinamen;
  Schnitt und Konflikt zählen als Orchestrierung ohne Paket). Die Hülle ist die Sitzung aus
  `laeufe/` und zählt als Orchestrator. Angedockt ist ein Paket mit dem Ereignis `gemergt` (ein
  zurückgenommenes Paket hat keins). Die Modellzeit der Prüfzeit kommt aus Schnitt und Konflikt,
  denn die Hülle wartet nur. Ungültige Ausgaben zählen über alle `--json-schema`-Aufrufe, Admiral
  und Programm. Ein Neustart ist das Ereignis `neustart`; gemessen wird bis zum nächsten Aufruf von
  Ingenieur oder Erstem Offizier, `--resume` eingeschlossen. Dazu kommen die Zahl der neu gestarteten
  Aufrufe dazwischen (`neue_aufrufe_bis_worker`) und der Verbrauch der Orchestrierung in diesem
  Zeitraum (`verbrauch_bis_worker`).
