# Probe Epic-Programm (agent-skills#69): vorher und nachher

Dieselben drei Mini-Epics laufen in `interias/flotte-probe` zweimal **vorher** (Stufe 0, #64:
heutiges `/epic` unter dem Treiber) und zweimal **nachher** (Stufe 4, #68: `flotte epic` unter dem
Treiber). Gemessen wird beide Male mit `flotte messen`, Abschnitt `epic_laeufe`.

## Aufbau

| Datei | wohin | was |
|---|---|---|
| `epic.md` | `.claude/epic.md` | Adapter: `issue_form: tickets`, `window: 3`, `merge: nach_gate`, Gate als einziger Testbefehl, Bereiche `obst/`, `verse/`, `thema/` |
| `gate.ps1` | `werkzeug/gate.ps1` | Gate in der Form von Probe 3, ohne Compose-Dienst |
| `regeln.ps1` | `<git common dir>/probe-regeln.ps1` | verdeckte Regeln und Auslöser, außerhalb des Arbeitsbaums |
| `basis/` | `obst/`, `verse/`, `thema/` | Ausgangsstand der Bereiche |
| `mini-epic-a.md` … `-c.md` | Issues | Epic und Kinder, angelegt über die GitHub-API |
| `vorbereiten.ps1` | – | richtet alles ein, ein Commit auf `main`, legt die Issues an, schreibt die Auslöser |
| `versuche.ps1` | – | die vier Versuche mit `claude -p` (unten) |
| `einsatz.vorlage.json` | – | Vorlage für `flotte messen` |

`vorbereiten.ps1` kopiert dazu den Skill `epic` dieses Repositorys als Projekt-Skill
`.claude/skills/epic-stapel/` (geändert sind nur `name` und der Pfad des Hooks) und die Agenten aus
`agents/` **unverändert mit ihren Modellen** nach `.claude/agents/` (Sonnet und Opus je Paketklasse,
nicht Haiku wie in Probe 3).

**Verdeckte Regeln.** Die Issues nennen sie nicht, der Adapter sagt nur „Was das Gate darüber
hinaus verlangt, sagt seine Ausgabe“. Im Vorlauf standen sie im Gate selbst. Die Läufe lasen sie
dort, serialisierten die Pakete und hielten die Auslöser zu Recht für Lastflakes. Seitdem liegen
sie in der Git-Ablage.

## Mini-Epics und welche Fälle sie tragen

| Mini-Epic | Pakete | Kante | gedacht für |
|---|---|---|---|
| A Obstkorb | a1, a2, a3: je eine Datei in `obst/` | keine | volles Fenster; verdeckt muss jede Datei in `obst/REGISTER.md` stehen, parallele Pakete fügen an derselben Stelle ein: **P14** Konflikt mechanisch |
| B Verse mit Wächter | b1 Wächter im Gate (*Urteil*), b2 Vierzeiler, b3 Zweizeiler | b2 nach b1 | harte Kante, eine Urteil-Klasse (Opus); Auslöser `probe-rot-epic`: der erste Kopf des Epic-Branches mit einem Paket-Merge macht `verse` rot, bis zum Revert: **P13** |
| C Themen | c1 Thema nacht, c2 Thema sommer | keine | verdeckt verlangt `thema/STAND.md` eine höhere Version und einen Grund, beide Pakete schreiben verschiedene Gründe in dieselben Zeilen: **P15** Konflikt inhaltlich; Auslöser `probe-rot-paket` an c1: ab dem zweiten Gate-Lauf ist `thema` rot, bis `thema/KONTRAST.md` die Zeile `- nacht` hat: **P10** |

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

`--max-min 120` statt des Richtwerts 90, weil drei Epics gleichzeitig laufen. Nach dem Lauf
`<probe>/.git/flotte` sichern (der nächste Lauf schreibt dort weiter). Nachher (Stufe 4) gilt
derselbe Aufruf; nur der Schalter in `flotte-probe` wechselt von `/epic` zu `flotte epic`.

Messen: `einsatz.vorlage.json` ausfüllen (Nummern aus `vorbereiten.ps1`, Kante b2 → b1), dann
`bun src/cli.ts messen <einsaetze.json> --name vorher-1`.

## Läufe vorher

| Lauf | Epics | Treiber | PRs | Ergebnis |
|---|---|---|---|---|
| Vorlauf (21.11.2026, Konto 3) | #54, #58, #62 | 14:27–14:36 UTC | #66, #67, #65 | alle gemergt; Regeln noch im Gate |
| vorher-1 (21.11.2026, Konto 2) | #68, #72, #76 | 15:46–15:57 UTC | #79, #80, #81 | #80 und #81 gemergt; #68 lieferte PR #79, der Treiber wertete es als blockiert (unten), #79 blieb offen |
| vorher-2 (21.11.2026, Konto 2) | #82, #86, #90 | 15:59–16:24 UTC, erster Start 16:13 | #95, #94, #93 | alle gemergt; bis 16:13 hielt die Verbrauchsbremse von Konto 2 die Starts an |

Der erste Versuch von vorher-1 auf Konto 3 hielt vor dem ersten Start an, weil das Kontingent
nicht reichte; die Issues blieben unverbraucht und liefen danach auf Konto 2.

**Vorlauf, gemessen mit `flotte messen`** (3 Epics, 8 Pakete; Basis Index 100; mit dem
korrigierten „bis nächster Start“ nachgemessen, alle Werte unverändert):

| Kennzahl | Vorlauf |
|---|---|
| Verbrauch je Epic / je Paket | Index 100 / 100 |
| Anteil Orchestrierung (Orchestrator 85,1 %, Admiral 0,5 %) | 85,6 % |
| Implementer / Reviewer am Epic | 7,4 % / 7,0 % |
| Implementer und Reviewer je Paket | 14,4 % des Paketverbrauchs (Index 100) |
| Durchlauf je Epic | Mittel 7,7 min (7,1 / 8,7 / 7,3) |
| gemergt bis nächster Start | Median 32 s, P90 43 s (n = 5) |
| Reviewer zurück bis nächster Start | Median 62 s, P90 100 s (n = 5) |
| Prüfzeit Reviewer zurück bis gemergt | Median 14,5 s, P90 68 s (n = 8); Modellzeit darin 46 % |
| Fensterverlust (obere Schranke) | 50,6 % |
| Implementer-Aufträge je Paket / Eskalationen | 1,0 / 0 |
| Ungültige Ausgaben (Admiral, `--json-schema`) | 0 von 3 |

Was eintrat: A und C liefen nacheinander, weil der Orchestrator die Regeln im Gate las und
Kollisionskanten legte; daher kein P14/P15 und der hohe Fensterverlust. Beide Auslöser feuerten
(`wurzel` rot); die Läufe werteten das Rot nach der Lastflake-Regel (unberührter Kontext, einzeln
grün), also P11 statt P10/P13. Die Mini-Epics sind so klein, dass der Orchestrator den Verbrauch
beherrscht; die Vorher-Zahl gilt nur für diesen Aufbau.

**vorher-1 und vorher-2, gemessen mit `flotte messen`** (je 3 Epics, 8 Pakete; Index: Mittel der
beiden Vorher-Läufe = 100; Mittel der Zeiten und Quoten ist das Mittel der beiden Werte, Durchlauf
über alle Epics; Zeiten als Median / P90):

| Kennzahl | vorher-1 | vorher-2 | Mittel | Vorlauf (Referenz) |
|---|---|---|---|---|
| Verbrauch je Epic / je Paket | Index 105 / 105 | 95 / 95 | 100 / 100 | 106 / 106 |
| Implementer und Reviewer je Paket | Index 101 | 99 | 100 | 87 |
| Anteil Orchestrierung | 83,2 % | 81,5 % | 82,4 % | 85,6 % |
| davon Orchestrator / Admiral | 82,8 % / 0,4 % | 81,5 % / 0 % | 82,2 % / 0,2 % | 85,1 % / 0,5 % |
| Implementer / Reviewer am Epic | 8,3 % / 8,5 % | 9,9 % / 8,6 % | 9,1 % / 8,6 % | 7,4 % / 7,0 % |
| Implementer und Reviewer am Paketverbrauch | 16,8 % | 18,5 % | 17,7 % | 14,4 % |
| Durchlauf je Epic | 9,2 min (n = 2) | 8,8 min (n = 3) | 8,9 min (n = 5) | 7,7 min (n = 3) |
| gemergt bis nächster Start | 80 / 88 s (n = 3) | 45 / 72 s (n = 5) | 62,5 / 80 s | 32 / 43 s (n = 5) |
| Reviewer zurück bis nächster Start | 114 / 116 s (n = 3) | 65 / 127 s (n = 5) | 89,5 / 121,5 s | 62 / 100 s (n = 5) |
| Prüfzeit Reviewer zurück bis gemergt | 28 / 70 s (n = 8) | 14,5 / 64 s (n = 8) | 21,3 / 67 s | 14,5 / 68 s (n = 8) |
| Modellzeit in der Prüfzeit | 49 % | 47 % | 48 % | 46 % |
| Fensterverlust (obere Schranke) | 40,0 % | 58,7 % | 49,4 % | 50,6 % |
| Implementer-Aufträge je Paket / Eskalationen | 1,1 / 0 | 1,0 / 0 | 1,05 / 0 | 1,0 / 0 |
| Ungültige Ausgaben (Admiral, `--json-schema`) | 0 von 2 | 0 von 0 | 0 von 2 | 0 von 3 |
| Doppelt gestartete / doppelt gemergte Pakete | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

Der Durchlauf von vorher-1 fehlt für #68, weil der Treiber für ein blockiertes Epic keine Messung
schreibt. In vorher-2 entschieden die Orchestratoren die Tor-Fragen selbst (✔-Zeilen), der Admiral
wurde nie gefragt.

Was eintrat:

| Fall | vorher-1 | vorher-2 |
|---|---|---|
| P14 Konflikt mechanisch (A) | ja: a1–a3 liefen parallel, beim zweiten und dritten Merge Konflikt in `obst/REGISTER.md`, der Orchestrator behielt alle Zeilen | nein: der Orchestrator ließ a1–a3 nacheinander laufen, jedes Paket setzte auf das vorige |
| P13 Epic-Branch rot (B) | ja: nach dem Merge von b3 `verse` rot, Revert, b3 mit `status/haengt` zurückgelassen, PR mit `WIP:` | ja: genauso (b3 zurückgelassen) |
| P10 Paket rot (C) | ja: c1 im zweiten Gate-Lauf rot, Implementer lieferte `thema/KONTRAST.md` in Runde 2 | Auslöser feuerte im Implementer selbst, behoben in einer Runde |
| P15 Konflikt inhaltlich (C) | nein: Kollisionskante über `thema/`, c1 und c2 nacheinander | nein: dito |
| P11 Lastflake | nein | nein |

**Kontamination.** In beiden Läufen lasen die Orchestratoren (in vorher-2 alle drei, dazu einzelne
Implementer und Reviewer) beim Rüsten `<git common dir>/probe-regeln.ps1`, weil das Gate diese
Datei lädt, und meldeten es offen. Die Regeln liegen also nicht verdeckt; „Was eintrat“ ist mit
diesem Wissen entstanden (vorher-2: A seriell). Nachher läuft mit demselben Aufbau, die Läufe
bleiben damit vergleichbar.

**Treiber, beobachtet.** #68 endete mit `FLOTTE-ENDE` und PR #79, hatte aber zwei abgelehnte
Bash-Aufrufe (zusammengesetzte Befehle, danach einzeln ausgeführt, also in anderer Form). Der
Treiber wertete das nach D19 als „blockiert: Erlaubnis verweigert“ und mergte #79 nicht. Die Ereignisse nennen das einzige Konto
von `--konten 2` „Konto 1“ (Zählung in der Liste, nicht die Kontonummer).

## Methode von `epic_laeufe`

- **Sitzungen** je Epic aus den Treiber-Logs (`laeufe/<nr>-*.jsonl`: Orchestrator,
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
  gemergt mit dem Ergebnis von `git merge … agent/<nr>-…` im Orchestrator. Gemessen werden
  „gemergt bis zum nächsten Start“ und „Reviewer zurück bis zum nächsten Start“, jeweils unter einer
  Stunde und nur bis zum Start eines Pakets, dessen harte Vorgänger beim Merge gemergt waren. Die Prüfzeit läuft von „Reviewer zurück“ bis „gemergt“, mit der Modellzeit des
  Orchestrators darin. Durchlauf ist `arbeitS` aus `messungen.jsonl`.
- **Fensterverlust:** Ein Paket belegt seinen Platz vom ersten Worker bis zum Merge. Verlust ist die
  Zeit, in der ein Platz frei war, während ein noch nicht gestartetes Paket alle harten Vorgänger
  gemergt hatte, als Anteil an der Zeit vom ersten Paketstart bis zum letzten Paketende. Kollisionskanten
  kennt die Messung nicht; der Wert ist eine obere Schranke.
- **Ungültige Ausgaben:** `result` ohne `structured_output` in den Logs der `--json-schema`-Aufrufe
  (heute nur der Admiral).
- **Neustart:** Jeder weitere „Lauf gestartet“ des Treibers bis zum nächsten Worker-Start. Doppelt
  gestartet heißt: zwei Implementer desselben Pakets überlappen. Doppelt gemergt heißt: zwei Merges
  desselben Pakets.
