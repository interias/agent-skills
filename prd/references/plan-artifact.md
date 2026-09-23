# Das Laufartefakt

Eine Seite, zwei Tabellen, zwei Figuren. Sie beantwortet genau drei Fragen: *Wo stehen wir
gerade?*, *Was hängt woran?* und *Was läuft wann neben was?* Alles andere steht im PRD-Issue und
gehört nicht hierher.

Die erste Frage ist der Grund, warum die Seite **mitläuft** und kein Standbild vom Anfang ist.
Sie wird nach jedem Merge fortgeschrieben (Phase 5) und ein letztes Mal am Ende (Phase 6). Wer
während eines mehrstündigen Laufs hineinschaut, will den Stand sehen; ein Plan, der noch den
Anfangszustand zeigt, ist schlimmer als keiner, weil er aktuell aussieht.

Datei in das Scratchpad-Verzeichnis schreiben, dann `Artifact` mit `favicon` und einer
Beschreibung in einem Satz. Die URL geht in den Eröffnungskommentar am PRD-Issue. Sagt der
Adapter, dass der Plan das Repository nicht verlassen darf: Datei schreiben, Pfad nennen,
nicht veröffentlichen.

**Aussehen:** Der Standard unten ist „Breuckmann Klar" (`DESIGN.md`): helle Arbeitsfläche,
dunkelblauer Kopf, kompakte Tabellen, keine Spielereien. Nennt der Projektadapter einen
eigenen Dokumentstandard, gilt der — dann von dort den Style-Block übernehmen, statt ihn neu
zu erfinden.

## Inhalt

1. **Kopf** — `PRD <n>: <Titel>`, darunter eine Zeile: wie viele Kinder bearbeitet werden, wie
   viele übersprungen, wie viele Plätze das Fenster hat. Die Kopfzeile (`.eyebrow`) trägt den
   Laufzustand: `PRD-PLANUNG · LAUF IM GANG`, am Ende `· LAUF BEENDET`, bei Abbruch
   `· LAUF ABGEBROCHEN`.
2. **Der Standkasten** (`.meta`) — vier Zeilen, und sie sind das, was sich am häufigsten ändert:
   wie viele gemergt sind, wie viele laufen, der Teststand (Suiten und Tests, vorher → jetzt),
   und **ob es eine Abweichung vom Plan gab**. „Keine Abweichung bisher" ist eine Aussage und
   muss dastehen — sonst weiß ein Leser nicht, ob niemand nachgesehen hat.
3. **Tabelle: Stand je Ticket** — Nummer und Titel, Zustand als Pille, Merge-Commit,
   Implementer-Runden, eine knappe Anmerkung (was es freischaltet, welche ADR es auf `accepted`
   setzt, was offen blieb). Diese Tabelle ist der eigentliche Kern der Seite; die Figuren
   erklären sie.
4. **Figur 1 — der Graph.** Knoten links nach rechts nach frühestem Start. Durchgezogener Pfeil
   `blockiert`, gestrichelte Linie `dieselben Module`, gestrichelter Rahmen `exklusiv`. Unter
   jedem Ticketnamen die betroffenen Module — daraus liest ein Mensch sofort, ob eine
   Kollisionskante fehlt. Jeder Knoten trägt zusätzlich seinen **Zustand** (siehe unten).
5. **Figur 2 — die Belegung.** Drei Spuren über eine Zeitachse, darunter die Epic-Linie. Jeder
   Balken ein Ticket **in seinem Zustand**, jeder Merge ein Pfeil nach unten auf die Epic-Linie
   — erfolgte Merges durchgezogen und mit ihrem Commit beschriftet, ausstehende gestrichelt und
   blass. Leere Plätze als gestrichelter Kasten mit „kein Kandidat". Die Breiten sind eine
   Schätzung — das in der Bildunterschrift sagen.
6. **Tabelle der übersprungenen Tickets** — Nummer, Grund, was es freischaltet. Entfällt, wenn
   keins übersprungen wird.

Jede Figur bekommt eine Bildunterschrift, die die Legende in Worten enthält (was ein
durchgezogener Pfeil bedeutet, was eine gestrichelte Linie, was ein grüner Rahmen). Eine Figur,
die man erst entschlüsseln muss, hat ihren Zweck verfehlt.

## Die Zustände

Vier, und jeder erscheint an drei Orten — als Pille in der Standtabelle, als Knotenrahmen in
Figur 1, als Balkenrahmen in Figur 2. Sie müssen überall dasselbe sagen.

| Zustand | Rahmen / Füllung | Pille | wann |
|---|---|---|---|
| **gemergt** | `--ok` 1.5px auf `--ok-bg` | `.z-ok` | im Epic-Branch, Test grün |
| **in Arbeit** | `--brand-500` 2px auf `--brand-100` | `.z-lauf` | Implementer oder Reviewer läuft |
| **wartet** | `--line` gestrichelt `4 3` auf `#fff` | `.z-plan` | noch nicht begonnen |
| **nicht abgenommen** | `--warn` 2px auf `#fff` | `.z-offen` | zwei Runden erfolglos, Branch bleibt liegen |

Am Anfang steht alles auf *wartet* außer den drei Startern. Das ist ein gültiger Anfangszustand
und kein Sonderfall, der erst beim ersten Merge eingebaut wird — die Zustandsklassen gehören von
der ersten Fassung an in die Seite, sonst ist die erste Fortschreibung ein Umbau.

Ein Zustandswort steht **zusätzlich** im Knoten (11px, rechtsbündig, in der Farbe des Zustands).
Farbe allein trägt die Aussage nicht.

## Fortschreiben

Dieselbe Datei ändern und mit demselben `file_path` erneut veröffentlichen — **das hält die
URL**, und die steht bereits im Eröffnungskommentar am PRD-Issue. Zwei Dinge dürfen sich dabei
nie ändern: der `favicon` (Leser finden ihre Registerkarte daran) und der `<title>`. Ein `label`
je Fortschreibung ist nützlich (`stand-nach-144`, `endstand`) — es erscheint in der Versionswahl.

Anzufassen ist bei jedem Merge:

- **Standkasten:** Zähler, Teststand, Abweichungszeile.
- **Standtabelle:** die Zeile des gemergten Tickets (Zustand, Merge-Commit, Runden, Anmerkung),
  die Zeilen der neu gestarteten Tickets.
- **Figur 1:** Rahmen und Zustandswort der betroffenen Knoten.
- **Figur 2:** Rahmen der betroffenen Balken; der Merge-Pfeil des gemergten Tickets wird
  durchgezogen und bekommt sein Commit-Kürzel als Beschriftung.
- **Fußzeile:** der aktuelle Epic-Kopf.

Was **nicht** angefasst wird: die Kanten des Graphen und die geplanten Balkenbreiten. Der Plan
bleibt sichtbar, auch wo die Wirklichkeit von ihm abweicht — sonst kann niemand mehr sehen, dass
sie abwich. Weicht die Belegung ab, sagt das die Abweichungszeile im Standkasten, nicht eine
stillschweigend verschobene Figur.

## Lesbarkeit — die Punkte, an denen es sonst scheitert

- **Keine Schrift unter 11px** und **keine Deckkraft unter 1** für Text. Zurückgenommene
  Angaben bekommen die Farbe `--soft`, nicht `opacity`.
- **Kein Farbcode ohne Wort.** Jede Kantenart steht zusätzlich in der Bildunterschrift.
- **Feste Textfarben**, nicht `currentColor` — sonst hängt die Lesbarkeit am Kontext.
- **Figuren scrollen**, statt zu schrumpfen: `min-width` am SVG plus `overflow-x:auto` am
  Rahmen. Ein auf Handybreite gequetschter Graph ist unlesbar.
- **Kein Dunkelmodus.** Der Standard legt sich auf eine helle Fassung fest; Hintergrund und
  Textfarbe stehen deshalb fest am `body` und werden nicht über Medienabfragen gedreht.

## Gerüst

Keine externen Fonts, keine Skripte, keine Bibliotheken — die CSP blockt sie, und der Standard
verbietet sie ohnehin. SVG von Hand, Farben ausschließlich aus den Tokens unten.

```html
<title>PRD 6: …</title>
<style>
  :root {
    --brand-900:#0C3B69; --brand-700:#14508F; --brand-500:#1B67B5;
    --brand-300:#7FA8D9; --brand-100:#DCE8F5; --brand-050:#EFF5FB;
    --ink:#1A2B3C; --soft:#5A7186; --line:#C9D4DC; --bg:#FBFCFD;
    --ok:#1F6E5C; --ok-bg:#E4F0EC; --warn:#A66B00; --warn-bg:#FBF1DE;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.58 system-ui,-apple-system,"Segoe UI",sans-serif; }
  header { background:linear-gradient(135deg,var(--brand-900),var(--brand-700));
           color:#fff; padding:30px 24px 26px; }
  .header-inner, main, footer { max-width:1040px; margin:auto; }
  .eyebrow { color:var(--brand-300); font-size:12px; font-weight:750;
             letter-spacing:.1em; text-transform:uppercase; }
  header h1 { margin:7px 0 5px; font-size:29px; line-height:1.18; font-weight:650; }
  header p { margin:0; color:var(--brand-100); }
  main { padding:28px 22px 55px; }
  h2 { color:var(--brand-900); font-size:19px; margin:32px 0 12px;
       padding-bottom:6px; border-bottom:2px solid var(--brand-900); }
  p { margin:0 0 11px; }
  .meta { background:#fff; border-left:4px solid var(--brand-500);
          border-radius:0 6px 6px 0; padding:13px 14px; margin:0 0 18px; }
  .meta p { margin:0 0 5px; }
  .meta p:last-child { margin:0; }
  code { font-family:ui-monospace,"Cascadia Code",Consolas,monospace;
         background:#EEF2F5; border-radius:3px; padding:1px 4px; }
  table { width:100%; border-collapse:collapse; background:#fff;
          font-size:13.5px; margin:9px 0 19px; }
  th, td { border:1px solid var(--line); padding:8px 9px; text-align:left; vertical-align:top; }
  th { background:var(--brand-050); color:var(--soft); font-size:11px;
       letter-spacing:.045em; text-transform:uppercase; }
  tbody tr:nth-child(even) { background:#FCFDFE; }
  td.num { font-variant-numeric:tabular-nums; }
  .zust { font-size:11px; font-weight:700; letter-spacing:.03em;
          padding:2px 7px; border-radius:9px; white-space:nowrap; }
  .z-ok { background:var(--ok-bg); color:var(--ok); }
  .z-lauf { background:var(--brand-100); color:var(--brand-900); }
  .z-plan { background:#F0F3F6; color:var(--soft); }
  .z-offen { background:var(--warn-bg); color:var(--warn); }
  .figure { margin:14px 0 18px; overflow-x:auto; }
  .figure svg { display:block; min-width:640px; max-width:100%; height:auto; }
  figcaption { color:var(--soft); font-size:12.5px; margin-top:6px; }
  footer { color:var(--soft); font-size:12px; border-top:1px solid var(--line);
           padding:15px 22px 30px; }
  @media (max-width:760px) {
    header h1 { font-size:23px; }
    main { padding-left:15px; padding-right:15px; overflow-x:auto; }
    table { min-width:650px; }
  }
  @media print {
    body { background:#fff; font-size:10.5pt; }
    header { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    table, h2, .figure { break-inside:avoid; }
    tr { break-inside:avoid; }
    a { color:inherit; text-decoration:none; }
  }
</style>
```

Rumpf: `header` mit `.eyebrow` (`PRD-PLANUNG · LAUF IM GANG`), `h1` und einer Zeile Untertitel,
dann `main` mit `.meta` (gemergt / laufend / Teststand / Abweichung), der Standtabelle, den
beiden `figure`-Blöcken und der Tabelle der übersprungenen Tickets, dann `footer` mit
Issue-Nummer, Branch und aktuellem Epic-Kopf.

## Zeichenmaße

Damit die Figuren ohne Nachmessen ausgerichtet sind:

- **Graph:** `viewBox="0 0 <60+300·Spalten> <40+90·Zeilen>"`. Spalten bei `x = 40, 340, 640, 940`,
  Knoten `230×52`, Zeilenabstand 90. Ticketnummer 12px in `--brand-900` links, **Zustandswort
  11px rechtsbündig** in der Zustandsfarbe, Titel 13px `--ink`, Module 11px `--soft`.
- **Knotenzustand:** gemergt `fill="--ok-bg" stroke="--ok" stroke-width="1.5"`; in Arbeit
  `fill="--brand-100" stroke="--brand-500" stroke-width="2"`; wartet
  `fill="#fff" stroke="--line" stroke-dasharray="4 3"`; nicht abgenommen
  `fill="#fff" stroke="--warn" stroke-width="2"`.
- **Kantenarten:** harte Kante durchgezogen 1.5px in `--brand-500` mit Pfeilspitze,
  Kollisionskante gestrichelt (`stroke-dasharray="5 4"`) 1.5px in `--warn` ohne Spitze,
  Exklusivknoten zusätzlich mit gestricheltem Rahmen in `--warn` und dem Wort `exklusiv`
  in 11px daneben. Pfeilspitze als `<defs><marker>` mit `orient="auto-start-reverse"`.
  **Die Kanten ändern sich über den Lauf nicht** — nur die Knoten.
- **Belegung:** `viewBox="0 0 940 300"`. Spuren bei `y = 34, 84, 134` (Höhe 30), Zeitachse
  bei `y = 196` von `x = 80` bis `x = 900`, Epic-Linie bei `y = 258` in `--brand-900` 2px.
  Balkenbeschriftung 12px; Balkenzustand mit denselben vier Fassungen wie die Knoten. Leere
  Plätze gestrichelt `--line` mit `--soft`.
- **Merge-Pfeile:** erfolgt — 1.5px durchgezogen in `--ok`, Punkt `r=4` in `--ok` auf der
  Epic-Linie, Commit-Kürzel 11px daneben. Ausstehend — 1.5px `--line` mit
  `stroke-dasharray="4 3"`, Punkt `r=4` in `--line`, ohne Beschriftung. Ein erfolgter Pfeil
  braucht **keine** Pfeilspitze; der Punkt auf der Linie trägt die Aussage, und die Spitze
  überdeckte ihn.
- Beide Figuren mit `role="img"` und `aria-label`, das die Aussage der Figur trägt — beim
  Fortschreiben **mit ändern**, sonst beschreibt der Text den Anfangszustand.
- Vor jeder Veröffentlichung prüfen: passt jede Beschriftung in ihren Knoten, ragt kein Text über
  den `viewBox`-Rand hinaus, überlappen sich keine zwei Linien mit Beschriftung, und fällt kein
  Merge-Pfeil mit einem anderen auf dieselbe `x`-Koordinate (dann eine Balkenbreite um 10–20
  verschieben).
