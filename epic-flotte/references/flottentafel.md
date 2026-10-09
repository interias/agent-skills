# Die Flottentafel

Die Flottentafel ist der Leitstand des Admirals für den Menschen: welche Epics laufen, wo jeder
Lauf steht, was der Admiral selbst entschieden hat, wie nah die Verbrauchsbremse ist und was beim
Menschen liegt. Sie ist ein **fester Bildschirm ohne Scrollen**: Oben steht immer dasselbe, den
unteren Bereich blättern Knöpfe in der Seitenleiste um. Die Lauftafeln der einzelnen Läufe bleiben
daneben bestehen (`epic/references/lauftafel.md`); die Flottentafel verlinkt sie, statt sie zu
wiederholen.

Die Tafel liegt im Scratchpad des Admirals, nie im Repository. Mit `plan_artifact: publish`
(Standard) wird sie als Artifact veröffentlicht, die URL bleibt über den ganzen Einsatz gleich und
wird dem Menschen genannt. Mit `file` wird die Datei nur geschrieben und ihr Pfad genannt.

## Die Vorlage

`flottentafel.html` neben dieser Datei ist die vollständige Seite im Design „Konsole", demselben
wie die Lauftafel. Sie wird kopiert, nicht nachgebaut:

```bash
cp ~/.claude/skills/epic-flotte/references/flottentafel.html "<scratchpad>/flottentafel.html"
```

**Der `<style>`-Block und das `<script>` werden nicht angefasst.** Der gemeinsame Block am Anfang
des Styles steht wortgleich in `epic/references/lauftafel.html` und wird nur in beiden Dateien
zugleich geändert; die Prüfung mit `diff` steht in `lauftafel.md` („Die Vorlage"). Das Script
zeichnet die Formation und blättert den unteren Bereich; der Admiral pflegt nur HTML-Daten.

Die Vorlage trägt die Musterdaten eines erfundenen Einsatzes und zeigt darin **jede** Form einmal:
alle fünf Laufzustände, alle fünf Paketformen, drei Kollisionsstufen, eine vorläufige
Entscheidung, beide Sorten Punkte beim Menschen, eine gelbe Bremse. Das ist eine Formenlehre, kein
Anfangszustand. Im Anfangszustand stehen die Epics der Belegung auf „läuft" mit allen Paketen
„wartend", die übrigen im Dock; unter „Beim Menschen" steht `Nichts offen.` nach dem
auskommentierten Muster, unter „Entscheidungen" `<p class="none">Noch keine.</p>`, unter „Bremse"
die erste Messung. Ein leerer Block bleibt stehen.

Anzupassen sind außerdem `<title>` (`Flottentafel <Repo>`) und in der Kopfleiste der Name des
Repositorys und `<span id="admiral">Admiral <Name></span>`. Aus diesem Span liest das Script den
Namen am Flaggschiff.

## Aufbau

Immer sichtbar, in Leserichtung:

1. **Kopf** im Konsolenrahmen: Repository, Admiral, darunter `.stamp` mit Einsatzzustand, Stand,
   Fortschreibung, Sternzeit.
2. **Kennzahlen** als Kacheln in der Seitenleiste, darunter die Blätterknöpfe.
3. **Formation**: die Läufe als Schiffe, gezeichnet aus der Tabelle.
4. **Verbrauchsbremse** als Leiste.
5. **Stand der Läufe** und daneben **Beim Menschen**.

Darunter der **untere Bereich** mit drei Seiten, von denen eine sichtbar ist: **Belegung**
(Standard), **Entscheidungen**, **Bremse**. Die gewählte Seite merkt sich der Browser
(`localStorage`, Schlüssel `flottentafel-seite`); ohne Speicher oder ohne JavaScript bleibt
Belegung stehen, und die Knöpfe sind ohne JavaScript ausgeblendet.

Die Tafel füllt genau die Fensterhöhe (ausgelegt auf 1440p). Reicht der Platz nicht, scrollt nur
der untere Bereich in sich; unter 900 px Breite fließt die Seite normal und scrollt.

## Einsatzzustand und Sternzeit

In `.stamp` steht zuerst der Zustand des ganzen Einsatzes, dann Stand, Fortschreibung und
Sternzeit. Stand und Sternzeit stammen aus **einem** Uhrenaufruf unmittelbar vor dem Rendern; die
Befehle und die Formel stehen in `lauftafel.md` („Laufzustand"). Jede andere Uhrzeit auf der Tafel
kommt ebenfalls von der Systemuhr oder aus `get_usage`, nie aus einer Schätzung.

| Einsatzzustand | Markup | wann |
|---|---|---|
| Einsatz läuft | `<b class="lauf live">Einsatz läuft</b>` | ab dem Flotten-Tor bis Phase 5 |
| Beendet | `<b class="lauf done">Beendet</b>` | Endstand nach Phase 5 |
| Abgebrochen | `<b class="lauf fail">Abgebrochen</b>` | der Einsatz endet vorher; der Grund steht als Glut-Punkt unter „Beim Menschen" |

## Kennzahlen

| Kachel | Wert | `.basis` |
|---|---|---|
| Läufe | belegte Plätze `/` Obergrenze der Flotte (nach Kollisionsstufe und Wochenfenster) | Zahl der Epics im Dock |
| Pakete | abgenommene Pakete `/` alle Pakete, über alle Läufe | „über alle Läufe" |
| Selbst entschieden | Zahl der Zeilen auf der Seite Entscheidungen | davon vorläufig |
| Wartet auf dich | Zahl der Glut-Punkte unter „Beim Menschen" | von wie vielen Punkten, wie viele die Flotte hebt |

Die Pakete-Kachel ist die Summe der Mini-Segmentleisten. Hitze-Tönung gibt es auf der
Flottentafel nicht; Kennzahlen der Epics stehen auf deren Lauftafeln.

## Stand der Läufe — die Datenquelle

Je Epic eine Zeile `<tr data-epic="<nr>">`, in der Reihenfolge des Flottenplans. **Aus diesen
Zeilen zeichnet das Script die Formation**; was hier steht, steht dort. Die Spalten:

- **Epic** und **Ziel** mit `.sub`: Welle, Platz und seit wann; bei wartenden worauf; bei fertigen
  der Merge-Stand (PR offen, gemergt, aufgeräumt).
- **Module · Kollision**: die berührten Module wie in der Lauftafel (`<b>exklusiv</b>` bei
  Exklusivknoten), darunter die Kollisionsstufe zum schlechtesten Partner als Chip:
  `<span class="coll keine|klein|mittel|gross">mittel zu #<nr></span>` (`keine` ohne Partner).
- **Zustand**, ein Chip je Lauf:

| Laufzustand | Chip | in der Formation | wann |
|---|---|---|---|
| im Dock | `.state.wait` | im Dock links | wartet auf eine Reihenfolge-Kante, eine Kollision oder die Bremse; `data-wartet="#<nr>"` an der Zeile nennt den Grund im Dock |
| läuft | `.state.live` | Schiff glüht | der Lauf-Agent oder übernommene Chat arbeitet |
| wartet auf dich | `.state.you` | Schiff blinkt | eine Frage, auf die der Lauf wartet, liegt beim Menschen |
| fertig | `.state.done` | Schiff blau | `FLOTTE-ENDE` ist da; der `.sub` sagt, ob PR offen, gemergt oder aufgeräumt |
| abgebrochen | `.state.fail` | Schiff rot | der Lauf endet ohne Block oder mit Abbruch; Glut-Punkt unter „Beim Menschen" |

- **Pakete**: eine Mini-Segmentleiste `<span class="pips mini">` mit genau einem `.pip` je Paket
  des Epics, in der Reihenfolge und im Zustand seiner Lauftafel (`wait`, `live`, `done`, `fail`,
  `block`), dahinter `<span class="mono">abgenommen/gesamt</span>`. Die Zahlen stehen auch im
  `aria-label`.
- **Lauf**: die Agent-ID (die ersten sieben Zeichen), bei einem übernommenen Chat ein Link auf die
  Sitzung, dann der Link auf die Lauftafel des Laufs.
- **PR**: Link auf den Pull Request, sonst `—`.

Glut tragen auch hier nur „läuft" und „wartet auf dich" (`--live`, `--you`).

## Formation

Die Formation wird **nie von Hand gezeichnet**. Das Script liest beim Laden die Zeilen von „Stand
der Läufe" und zeichnet:

- ein Schiff je Zeile, deren Chip nicht `wait` ist, untereinander; Farbe und Animation nach dem
  Chip;
- hinter jedem Schiff je Paket einen Punkt in der Form seines Segments: wartend Kreis, in Arbeit
  glühender Punkt, abgenommen voller Punkt, nicht abgenommen Kreuz, blockiert Quadrat;
- daneben `#<nr> · abgenommen/gesamt`;
- links das Dock mit allen Zeilen im Zustand `wait`, beschriftet mit `data-wartet`;
- rechts das Flaggschiff mit dem Namen aus `#admiral`.

Stimmt die Formation nicht, stimmt die Tabelle nicht. Ohne JavaScript steht statt der Formation
ein Hinweis auf die Tabelle.

## Verbrauchsbremse

Die Leiste `<section class="brake <stufe>">` mit `gruen`, `gelb` oder `rot` gibt die letzte Messung
wieder (`SKILL.md`, „Verbrauchsbremse"):

- `.lvl`: `Bremse grün`, `Bremse gelb` oder `Bremse rot`.
- Zwei Balken, 5-Stunden- und Wochenfenster: `<b style="width: <verbraucht>%">`, daneben
  `<verbraucht> % · hochgerechnet <Hochrechnung> %`; in den ersten 30 Minuten eines Fensters
  steht statt der Hochrechnung `—`.
- `.note`: Reset des 5-Stunden-Fensters und die geschätzten Kosten der nächsten Welle
  (`nächste Welle ≈ <n> %`) nach „Aus Erfahrung schätzen".

Das Gelb der Bremse ist ein ruhiger Ton und blinkt nie; es ist keine Glut. Prozente stehen nur auf
der Tafel, nie im Flottenlogbuch.

## Beim Menschen

Wie „Offene Punkte" der Lauftafel, mit derselben Schiene links:

- `.item.you` (Glut): Was nach „Entscheidungsrecht" beim Menschen liegt — offene Fragen,
  vorläufige Entscheidungen zum Bestätigen oder Kippen, Pull Requests zum Mergen, Abbrüche.
  Diese Punkte zählt die Kachel „Wartet auf dich".
- `.item.run` (Blau): Was die Flotte selbst hebt, etwa eine Pause der Bremse.

Je Punkt eine Überschrift mit Epic, ein Wort für die Art in `.owner` (bei Glut mit `blink-dot`),
**ein** Satz, die Monozeile `.meta2` mit seit wann und welchem Lauf. Ist nichts offen, steht dort
`Nichts offen.`

## Die drei Seiten unten

**Belegung** (Standard): die Zeitleiste wie in `lauftafel.md` („Zeitleiste"), eine Spur je Platz
der Obergrenze, ein Balken je Epic-Lauf mit der Klasse seines Zustands (`done`, `live`, `you`,
`fail`). Darunter die Abweichungszeile: geplante gegen tatsächliche Belegung, Pausen der Bremse,
warum ein Platz leer ist.

**Entscheidungen**: **alle** eigenen Entscheidungen des Einsatzes, neueste oben, je eine
`<div class="d">` mit dem Epic (oder `Flotte`) in `.lbl`, der Entscheidung in einem Satz und in
`.hard` Herkunft, „Aufheben" (was ein Mensch tun müsste) und dem Link auf den Forge-Kommentar —
dieselben Felder wie der Kommentar in `SKILL.md`. Eine vorläufige trägt `class="d vorl"` und
`<span class="vk">vorläufig</span>`; bestätigt der Mensch, wird daraus `bestätigt`, kippt er sie,
`gekippt` mit der neuen Option im Satz. Gestrichen wird keine.

**Bremse**: der Verlauf der Messungen, je Aufwachen eine Zeile, neueste unten: Zeit, Stufe
(`<span class="stufe gruen|gelb|rot">`), 5 Stunden verbraucht, hochgerechnet, Woche, Zuwachs seit
der letzten Messung, Pakete dazwischen (Zahl, Paketklassen, Runden oder Eskalationen). Darunter
eine Zeile mit den Kosten je Paket bisher, getrennt nach Paketklasse — die Grundlage der Schätzung
in der Leiste und des Vorschlags für `verbrauch.md` im Abschlussbericht.

## Fortschreiben

Dieselbe Datei, derselbe `file_path`, dieselbe URL; `icon` und `<title>` bleiben gleich, ein
`label` je Fortschreibung. Fortgeschrieben wird bei **jedem** Ereignis aus `SKILL.md`, Phase 3,
im selben Zug wie das Flottenlogbuch. Nachzuziehen sind jedes Mal:

- Einsatzzustand, Stand, Nummer der Fortschreibung und Sternzeit in `.stamp`
- die Zeilen von „Stand der Läufe": Zustand, Mini-Segmente aus der jeweiligen Lauftafel, `.sub`,
  PR; neue Epics aus dem Dock, freie Plätze
- die Kacheln
- die Bremse-Leiste und eine neue Zeile auf der Seite Bremse bei jeder Messung
- eine neue Zeile auf der Seite Entscheidungen bei jeder eigenen Entscheidung, Bestätigung oder
  jedem Veto
- „Beim Menschen": dazugekommene, erledigte Punkte
- Balken und Abweichungszeile der Belegung

## Vor der ersten Veröffentlichung prüfen

- Der Musterstempel `<span class="demo">Musterbelegung</span>` ist entfernt, der Einsatzzustand
  steht auf `Einsatz läuft`.
- Keine Musterdaten mehr auf der Seite. Die Ausgabe muss leer sein:
  ```bash
  grep -n "Musterbelegung\|Beispielrepo\|Auftragsliste\|Rechnungen gesammelt\|Lieferscheine\|Rollenrechte\|Exportformat XLSX\|Testkonto\|#9[4-7][0-9]\|data-epic=\"9[4-7][0-9]\"\|a7f3e21\|c21e9d0\|5be8f13\|9b04c77\|#212\|22.09.2026, 14:10\|80724.8\|hochgerechnet 101 %" "<scratchpad>/flottentafel.html"
  ```
  Trägt ein echtes Epic eine Nummer zwischen #940 und #979 oder ein echter Pull Request #212,
  meldet das Muster auch echte Treffer. Dann jede Zeile einzeln ansehen. Der Admiralsname der
  Musterdaten wird nicht gesucht, weil die Ziehung ihn auch echt liefern kann.
- Zeilen in „Stand der Läufe" = Epics des Einsatzes; jede Mini-Segmentleiste hat so viele
  Segmente wie ihre Lauftafel.
- Die Kachel „Pakete" ist die Summe der Segmente, „Wartet auf dich" zählt die Glut-Punkte,
  „Selbst entschieden" die Zeilen der Seite Entscheidungen.
