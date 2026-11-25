---
name: bereitschaftsraum
description: Bereitschaftsraum — das Gespräch, aus dem eine Mission, ein Missionsziel oder nichts entsteht. Fragt in Runden mit Optionen und Empfehlung, schneidet vertikal, hält Entscheidungen als ADR und Fachbegriffe in CONTEXT.md fest (eigener Doku-PR) und legt am Ende über `flotte auftrag` an. Angelegt wird nie von Hand.
disable-model-invocation: true
---

# Bereitschaftsraum

Der Mensch bringt ein Anliegen — eine Idee, ein Problem, einen halben Plan. Du klärst es mit ihm, bis
klar ist, **was daraus wird**: nichts, ein Missionsziel oder eine Mission mit Zielen. Was entsteht,
legt der Auftragsschreiber (`flotte auftrag`) an, nie du von Hand.

Sprache: der Sprachraum aus `CONTEXT.md` von agent-skills (Mission, Missionsziel, Sternzeit-Notiz,
Warp frei, Außeneinsatz, Lagebesprechung, Ingenieur, Erster Offizier, Andockprüfung). Labels und
Adapterschlüssel bleiben technisch.

Lies zuerst, bevor du fragst: `CONTEXT.md`, `docs/adr/` (mit README, falls vorhanden), `.claude/epic.md` des
Ziel-Repositorys und `mission/references/adapter.md` („Issues“), dazu den Code, um den es geht. Fehlen
`CONTEXT.md` oder `docs/adr/` im Ziel-Repository, legt sie der Doku-Pull-Request (Abschnitt 4) bei
Bedarf an, im Format derselben Dateien von agent-skills.
**Was du im Repository nachlesen kannst, fragst du nicht.**

## 1 — Fragen in Runden

**Eine Runde** hat bis zu **fünf** Fragen. Je Frage:

- ein Titel und der Sachverhalt in ein, zwei Sätzen,
- Optionen **A–C** (weniger, wenn es weniger gibt), jede mit ihrer Folge,
- die **Empfehlung**, markiert, mit einem Satz Grund,
- **Einzelwahl** oder **Mehrfachwahl** — sag bei jeder Frage, welche gilt.

Der Mensch darf jederzeit **frei antworten**, statt zu wählen; das gilt immer, auch ohne dass die
Frage es sagt. Eine Frage, die er offen lassen will, wird **zurückgestellt**: Sie steht in der
Zusammenfassung als „zurückgestellt“ und wandert, wenn sie blockiert, in den Abschnitt „Offene
Punkte“ des Entwurfs. Zurückgestellt ist nicht verworfen.

**Wie gestellt wird.** Mit `AskUserQuestion`, wenn die Sitzung es hat: die empfohlene Option mit
„(Empfehlung)“ im Label, höchstens vier Optionen je Frage (A–C plus „zurückstellen“ ergibt vier),
mehr als vier Fragen auf mehrere Aufrufe verteilt. **Ohne das Werkzeug** — etwa im Chat auf der
Flottenbrücke — dieselbe Runde als Text:

```
❓ **Q1** — **<Titel>** (Einzelwahl): <Sachverhalt>
   A — <Option, Folge>
   B — <Option, Folge>
   C — <Option, Folge>
➡️ Empfehlung A: <Grund in einem Satz>
```

Der Skill hängt nie an `AskUserQuestion`; die Textform ist gleichwertig. Die Antwort des Menschen
(„Q1 B, Q2 A und C, Q3 zurückstellen“ oder Freitext) gilt als ausdrückliche Entscheidung.

**Klar Entscheidbares wird nicht gefragt.** Gibt es eine eindeutige Empfehlung (die Alternativen
sind offensichtlich schlechter oder gleichwertig), die Wirkung ist lokal und umkehrbar und sie
widerspricht keinem ADR, entscheidest du selbst und listest sie in der Runde als eine Zeile:

```
✔ <Entscheidung> — <Grund>
```

Der Mensch kann jede ✔-Zeile widerrufen; widerspricht er nicht, gilt sie. **Fragen bleibt:** Unumkehrbares oder nach außen Sichtbares
(Push, Freigabe, Löschung, Zugang, Geld), Änderungen an einem ADR, Produktrichtung und Missionsumfang,
Sicherheit und Datenschutz, mehrere vertretbare Wege, deren Abwägung der Mensch tragen muss.

**Reihenfolge:** erst, was andere Fragen entscheidet (Ziel, Umfang, Grenzen), dann Einzelheiten.
Ist eine Frage durch die Antwort einer anderen erledigt, stellst du sie nicht mehr. Die Fragen
enden, wenn nichts Entscheidendes mehr offen ist — nicht, wenn dir die Fragen ausgehen.

## 2 — Die Form wählen

Du wählst, was am Ende entsteht, und sagst es mit Grund:

| Form | Wann |
|---|---|
| **nichts** | Das Anliegen ist erledigt, schon da, widerspricht einem ADR oder `out_of_scope`, oder der Mensch verwirft es. Dann kein Auftrag; ein Satz, warum. Entscheidungen und Fachbegriffe aus dem Gespräch gehören trotzdem in die Doku (Abschnitt 4). |
| **ein Missionsziel** | Ein Außeneinsatz kann es in einem Zug abnehmen: ein Ergebnis, eine Verifikation, wenige Module. |
| **eine Mission mit Zielen** | Mehrere abnehmbare Ergebnisse, oder eines, das ein Außeneinsatz nicht in einem Zug schafft. |

**Nur Software** (`mission/SKILL.md`, Regel 14). Ein Auftrag baut Software: Code, Tests und Doku. Was
für die Software gemacht wird, baut die Flotte, auch beschlossene Gestaltung wie Piktogramme, Farben oder
Oberflächentexte. Ist das Ergebnis Inhalt, den der Mensch in der Software erarbeitet und dort pflegt —
Konzeptrunden, Konstruktionen, Stamm- und Geschäftsdaten, Recherche dafür —, wird daraus kein Missionsziel; das arbeitet der Mensch in einem eigenen Chat aus. Bei einem gemischten
Anliegen wird nur der Softwareanteil Auftrag, der Inhaltsanteil steht als zurückgestellt in der
Zusammenfassung. Maßstab ist das Ergebnis, nicht ein Wort im Text. Soll ein Inhaltsziel trotzdem als
Issue stehen, nur „anlegen“, nie „anlegen und starten“: Die Triage empfiehlt dann `ready-for-human`,
nicht `ready-for-agent`; das Label setzt der Mensch.

**Schnittregeln** für die Missionsziele:

1. **Vertikal.** Jedes Ziel liefert einen dünnen, durchgehenden Streifen — vom Eingang bis zu dem,
   was der Mensch sieht oder testet —, nicht eine Schicht („erst alle Tabellen, dann alle
   Oberflächen“). Ein Ziel, das erst mit dem nächsten nutzbar wird, ist falsch geschnitten.
2. **Je Ziel verifizierbar.** Jedes Ziel hat Abnahmekriterien, die ein Erster Offizier einzeln prüfen
   kann, und einen Verifikationsweg, den der Außeneinsatz fahren kann (Werkzeug, Zugang, Ablage
   vorhanden). Gibt es keinen, ist das eine Frage an den Menschen, kein Missionsziel.
3. **Löschungen zuletzt.** Was entfernt, ersetzt oder abgeschaltet wird, steht in den letzten Zielen,
   nachdem der Ersatz läuft und nachgewiesen ist.

Dazu: die Reihenfolge der Ziele ist die Reihenfolge der Abhängigkeiten; Ziele, die dieselben Dateien
berühren, bekommen `## Betroffene Module` — das Wort `Exklusiv` dort heißt: läuft allein.

## 3 — Was ein Missionsziel braucht

`/mission` nimmt ein Ziel nur auf, wenn es die Pflichtabschnitte des Adapters hat. Lies deren Namen aus
`.claude/epic.md` (Schlüssel `acceptance_section`, `verification_section`, `modules_section`); die
Standards stehen in `mission/references/adapter.md`. Ein Missionsziel im Entwurf hat:

- `## Was` — ein bis drei Sätze, im Sprachraum, ohne Lösungsvorgabe, wo keine nötig ist.
- `## Abnahmekriterien` — prüfbare Aufzählung; jedes Kriterium so, dass ein Erster Offizier „erfüllt“
  oder „nicht erfüllt“ sagen kann.
- `## Verifikationsweg` — wie es geprüft wird, mit Fundstelle (Befehl, Datei, Seite). Liegt das
  Ergebnis außerhalb dessen, was die Tests oder die Andockprüfung des Repositorys erfassen, nennt er
  den Weg von Hand ausdrücklich (was wird angesehen oder verglichen, womit).
- `## Betroffene Module` — freiwillig, aber gesetzt, wenn es Ziele gibt, die sich überschneiden.
- bei Bedarf `## Entscheidungen` (was gilt, mit Grund — die Antworten aus dem Gespräch) und
  `## Out of Scope`.

Die Mission selbst trägt ein, zwei Absätze: worum es geht und warum. Die Liste der Ziele und die
Zeile zur Reihenfolge ergänzt der Auftragsschreiber.

**Nichts ins Missionsziel, was nur im Gespräch stand.** Der Ingenieur sieht das Gespräch nicht;
Entscheidungen, auf die er sich stützt, stehen im Body oder in einem ADR, auf das der Body verweist.
Keine Transkriptausschnitte, keine lokalen Pfade mit Benutzernamen, keine IPs, keine Zugangsdaten.

## 4 — ADR und Fachbegriffe

Aus dem Gespräch fällt Dauerhaftes ab. Es kommt **nicht** in den Auftrag, sondern in die Doku des
Ziel-Repositorys, als **eigener Doku-Pull-Request** (eigener Branch, nur `docs/adr/…` und
`CONTEXT.md`, keine Codeänderung):

- **ADR** nur, wenn alle drei zutreffen: **schwer umkehrbar**, **überraschend** (ein Neuer würde es
  anders erwarten) und es gab ein **echtes Abwägen** zwischen vertretbaren Wegen. Sonst bleibt die
  Entscheidung im Body des Missionsziels. Form und Nummerierung nach den vorhandenen ADRs (und
  `docs/adr/README.md`, falls es eines gibt); nächste freie Nummer, Datei `NNNN-<kurzer-name>.md`.
- **Fachbegriffe** in `CONTEXT.md`, im Format dieser Datei (Begriff, Bedeutung, `_Avoid_`). Ein
  Begriff, den du im Gespräch geprägt oder präzisiert hast und den die Mission nutzt, gehört hinein;
  ein vorhandener wird geschärft, nicht doppelt angelegt. Kollidiert ein Begriff mit dem Sprachraum
  der Flotte (etwa „Logbuch“), kommt das als Frage oder ✔-Zeile in die Runde, und `CONTEXT.md` grenzt
  ihn ausdrücklich ab.

**Wann und wie.** Den Text der Doku-Änderung zeigst du im Wortlaut mit dem Entwurf (Abschnitt 5,
Punkt 2); sichtbar wird er erst nach der Wahl des Menschen. Dann, **vor** `flotte auftrag`: ein
eigener Branch in einem eigenen Worktree (nie `git switch` im Checkout des Menschen), Commit, Push,
Pull Request; den Worktree entfernst du danach wieder. Verweist der Auftrag auf den Doku-PR, trägst du
dessen Nummer in den Entwurf ein und lässt den Trockenlauf erneut laufen. Andocken tut der Mensch,
nicht du.

**Darfst du nicht schreiben** (Chat auf der Flottenbrücke: im Repository nur lesen; anlegen tut der Dienst, wenn der Mensch in der Brücke „anlegen“ drückt): Es gibt
keinen Doku-Pull-Request. Dann steht jedes ADR als fertiger Text und jede Begriffsänderung als
fertiger Absatz im Entwurf unter `## Doku (nachzutragen)` des Missions- oder Zieltexts, und die
Zusammenfassung nennt es als offenen Punkt. Behaupte nie, etwas sei festgehalten, was nicht
geschrieben wurde.

## 5 — Ende des Gesprächs

1. **Zusammenfassung** in wenigen Absätzen: das Anliegen, die gewählte Form mit Grund, die
   Entscheidungen (✔-Zeilen eingeschlossen), das **Zurückgestellte**, die Doku-Änderungen.
2. **Entwurf** im Format von `flotte/README.md` („Aufträge“): jede Überschrift erster Ebene beginnt
   ein Issue — höchstens eine `# Mission: <Titel>` ganz oben, darunter `# Missionsziel: <Titel>`;
   ohne Mission genau ein Missionsziel; sonst keine Überschrift erster Ebene (auch nicht in
   Beispielen außerhalb eines Codezauns). Schreibe ihn in eine Datei außerhalb des Repositorys
   (Temp-Verzeichnis), lass den **Trockenlauf** (Punkt 4) laufen und zeige ihn dem Menschen erst
   dann, vollständig, mit dem Text der Doku-Änderung — so fallen Lücken vor der Wahl auf.
3. **Der Mensch wählt**, jeweils mit der Empfehlung:
   - **„anlegen“** → `needs-triage` (Sternzeit-Notiz): die Issues stehen, die Flotte rührt sie nicht
     an, bis sie freigegeben sind.
   - **„anlegen und starten“** → `ready-for-agent` (Warp frei): die Flotte darf sie aufnehmen.
   - Änderungswünsche → Entwurf anpassen, erneut zeigen. Verwerfen ist immer möglich.
4. Zuerst als **Trockenlauf**, dann — nach der Wahl und dem Doku-Pull-Request (Abschnitt 4) — echt:

   ```powershell
   bun "$HOME\.claude\skills\flotte\src\cli.ts" auftrag <repo> <entwurf.md> --trocken
   bun "$HOME\.claude\skills\flotte\src\cli.ts" auftrag <repo> <entwurf.md> [--starten]
   ```

   `<repo>` ist der Checkout des Ziel-Repositorys; `--starten` nur bei „anlegen und starten“. Der
   Trockenlauf legt nichts an; er meldet fehlende Pflichtabschnitte („Nichts angelegt,
   Pflichtabschnitte fehlen: …“) und `hinweise`. Beheben, erneut trocken laufen lassen, erst dann
   echt. Die Hinweise gehören in die Zusammenfassung an den Menschen.
5. **Ergebnis** an den Menschen: Links der angelegten Issues (aus der Ausgabe), Labels, Hinweise,
   Link des Doku-Pull-Requests, Zurückgestelltes.

**Nie** legst du Missionen oder Ziele anders an: kein `gh issue create`, kein `tea issue create`,
kein `glab issue create`, kein Schreibaufruf an die Issue-Schnittstelle der Forge (agent-skills/
ADR-0002). Scheitert `flotte auftrag`, melde den Fehler wörtlich und frag; du weichst nicht aus. Ist
`flotte auftrag` im Chat nicht verfügbar, bleibt der Entwurf das Ergebnis — der Mensch legt ihn an.

Der Auftrag entsteht erst nach der Antwort des Menschen auf Punkt 3, nie davor.
