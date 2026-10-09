# Die Lauftafel

Die Lauftafel ist die einzige Fläche, auf der jemand den Stand des Laufs sieht, ohne den Chat zu
lesen: was gerade läuft, was geklappt hat, wo es hakt. Alles steht auf **einer Bildschirmhöhe**
(ausgelegt auf 1440p, ohne Scrollen), in vier Blöcken, ohne Graphfigur. Alles Weitere steht im
Issue.

Die Tafel liegt immer im Scratchpad der Sitzung, nie im Repository. Mit `plan_artifact: publish`
(Standard) wird sie als Artifact veröffentlicht, und ihre URL geht in den Eröffnungskommentar. Mit
`file` wird die Datei nur geschrieben und ihr Pfad genannt. Ein alter Wert `off` gilt als `file`.

## Die Vorlage

`lauftafel.html` neben dieser Datei ist die vollständige Seite im Design „Konsole": ein dunkler
Konsolenrahmen mit Ellbogen, die Kennzahlen als Kacheln in der Seitenleiste. Es gilt für alle
Projekte und hat nur eine, dunkle Fassung. Die Vorlage wird kopiert, nicht nachgebaut:

```bash
cp ~/.claude/skills/epic/references/lauftafel.html "<scratchpad>/lauftafel-<nr>.html"
```

**Der `<style>`-Block wird nicht angefasst.** Er *ist* das einheitliche Aussehen. Sein erster
Teil, der **gemeinsame Block** zwischen `GEMEINSAMER BLOCK · Anfang` und `· Ende` (Schrift, Farben,
Zustände, Animation), steht wortgleich in der Flottentafel
(`epic-flotte/references/flottentafel.html`) und wird nur in beiden Dateien zugleich geändert.
Ändert sich das Design, wird die Vorlage nachgezogen, nie die einzelne Tafel. Dass beide Blöcke
gleich sind, zeigt ein leeres `diff`:

```bash
r=~/.claude/skills; b='/GEMEINSAMER BLOCK · Anfang/,/GEMEINSAMER BLOCK · Ende/p'
diff <(sed -n "$b" $r/epic/references/lauftafel.html) <(sed -n "$b" $r/epic-flotte/references/flottentafel.html)
```

Die Überschriftenschrift Antonio (SIL Open Font License, Hinweis im Block) ist als data-URI
eingebettet, nur Latin, Schnitte 600–700; die Seite lädt zur Laufzeit nichts nach. Fließtext und
Monoschrift sind Systemschriften.

Die Vorlage trägt die Musterdaten eines erfundenen Laufs (Epic #942) und zeigt darin **jede** Form
einmal: alle fünf Paketzustände, ein exklusives Paket, beide Sorten offener Punkte, eine Kennzahl
unter Ziel. Das ist eine Formenlehre, kein Anfangszustand. Im Anfangszustand stehen alle Pakete auf
„wartend", die Zeitleiste ist leer, und unter „Offene Punkte" steht die eine Zeile `Nichts offen.`
nach dem auskommentierten Muster im Block. Ein leerer Block bleibt stehen, denn weggelassen sieht
er aus wie vergessen.

Anzupassen sind außerdem `<title>` (`Lauftafel #<nr>`) und der Name des Repositorys in der
Kopfleiste (`.topbar .t span`).

## Die vier Blöcke

Die Reihenfolge ist die Leserichtung: *Was ist der Lauf → wo steht er → wer lag wann worauf → was
liegt beim Menschen.*

1. **Kopfzeile**: die Kopfleiste im Konsolenrahmen (Repository, darunter `.stamp`), die
   Issue-Zeile `.meta` mit Issue-Nummer und Titel, Basis (`base_branch`), Epic-Branch, Pull
   Request, darunter die Segmentleiste über alle Pakete. Die Kennzahlkacheln (`.read`) stehen in
   der Seitenleiste links.
2. **Stand der Pakete**: je Paket Nummer, Zielsatz, Module, Zustand, Runden, Merge-Commit. Der
   `.sub`-Untertitel trägt, was die Zeile erklärt: Platz und Runde bei laufenden Paketen, den
   Reviewer-Befund bei mehreren Runden, das blockierende Paket bei blockierten.
3. **Belegung der Plätze**: die Zeitleiste, darunter die Abweichungszeile.
4. **Offene Punkte**: der Abschluss, in Spalten nebeneinander.

## Laufzustand

Über den Blöcken steht in `.stamp` zuerst der Zustand des ganzen Laufs, dann Stand,
Fortschreibung und Sternzeit. **Jede Uhrzeit auf der Tafel stammt aus einem Aufruf der Systemuhr unmittelbar vor
dem Rendern** (`date`, `Get-Date`) und wird nie geschätzt oder aus dem Verlauf hochgerechnet; die
Zeitzone steht dabei. Das gilt auch für die Uhrzeit in der Kachel „Tests" und die Zeitleiste.
Drei Werte, je mit eigener Klasse:

| Laufzustand | Markup | wann |
|---|---|---|
| Lauf im Gang | `<b class="lauf live">Lauf im Gang</b>` | ab der ersten Veröffentlichung bis zum Pull Request |
| Beendet | `<b class="lauf done">Beendet</b>` | die letzte Fortschreibung vor dem Pull Request |
| Abgebrochen | `<b class="lauf fail">Abgebrochen</b>` | der Lauf endet vor dem Pull Request; der Grund steht als Glut-Punkt unter „Offene Punkte" |

Ohne diesen Wert sieht eine liegengebliebene Tafel aus wie eine laufende.

**Sternzeit.** Neben dem Stand steht `Sternzeit <b>…</b>`, berechnet aus **demselben**
Uhrenaufruf wie der Stand: `41000 + 1000 · (Jahr − 1987) + 1000 · Jahresanteil`, eine
Nachkommastelle; der Jahresanteil sind die seit dem 1. Januar 00:00 Ortszeit verstrichenen
Sekunden geteilt durch die Sekunden des Jahres. Ein Befehl liefert beides:

```bash
n=$(date +%s); y=$(date -d @$n +%Y)
s=$(date -d "$y-01-01" +%s); e=$(date -d "$((y+1))-01-01" +%s)
date -d @$n '+%d.%m.%Y, %H:%M %Z'
awk -v y=$y -v s=$s -v e=$e -v n=$n 'BEGIN { printf "Sternzeit %.1f\n", 41000 + 1000*(y-1987) + 1000*(n-s)/(e-s) }'
```

```powershell
$n = Get-Date; $s = [datetime]::new($n.Year, 1, 1)
$f = ($n.ToUniversalTime() - $s.ToUniversalTime()).TotalSeconds / ($s.AddYears(1).ToUniversalTime() - $s.ToUniversalTime()).TotalSeconds
$n.ToString('dd.MM.yyyy, HH:mm') + ' · Sternzeit ' + (41000 + 1000*($n.Year - 1987) + 1000*$f).ToString('F1', [cultureinfo]::InvariantCulture)
```

Der Punkt als Dezimalzeichen ist Absicht. Die Zeitzone steht wie beim Stand dabei (`MESZ`).

## Was ein Paket ist

Das hängt an `issue_form`:

| Modus | Kopf `.no` | Paket | Nr.-Spalte | Zielsatz | Module |
|---|---|---|---|---|---|
| `tickets` | `Epic #<nr>` | ein Kind-Ticket | Issue-Nummer, `#943` | Titel des Kindes | aus seinem `modules_section` |
| `spec` | `Spec #<nr>` | ein vom Orchestrator geschnittenes Paket | `P1`, `P2`, … | Ziel aus dem Schnitt | aus dem Schnitt |

Übersprungene Kinder stehen nicht in der Tabelle. Sie gehören in den Eröffnungskommentar.

## Die Spalte „Module"

Sie nennt die Module, die ein Paket berührt, kurz und in der Schreibweise des Repositorys
(`server/export`, `client/list`). Ein exklusives Paket trägt dahinter das Wort `<b>exklusiv</b>`.
Am Ende steht die Paketklasse, `· mechanisch`, `· standard` oder `· urteil`; nach einer
Eskalation beide, `· standard → urteil`.

Die Spalte ersetzt den Graphen. Aus ihr liest ein Mensch, ob eine Kollisionskante fehlt: Zwei
Pakete, die in der Zeitleiste gleichzeitig liegen und ein Modul teilen, hätten nicht nebeneinander
laufen dürfen. Sieht der Lauf das selbst, gehört es in die Abweichungszeile.

## Zustände eines Pakets

| Zustand | Chip | Segment | wann |
|---|---|---|---|
| wartend | `.state.wait` | `.pip.wait` | harte Vorgänger nicht gemergt, oder kein Platz frei |
| in Arbeit | `.state.live` | `.pip.live` | Subagent läuft; der Untertitel nennt Platz und Runde seit wann |
| abgenommen | `.state.done` | `.pip.done` | in den Epic-Branch gemergt; der Merge-Commit steht in der Zeile |
| nicht abgenommen | `.state.fail` | `.pip.fail` | `max_rounds` erschöpft, nicht mechanischer Konflikt, Worktree nicht sauber entfernbar, Epic-Branch nach dem Merge rot (Merge per Revert zurückgenommen), oder im Lauf zeigt sich ein Zugriff oder eine Freigabe, die am Tor nicht vorlag |
| blockiert | `.state.block` | `.pip.block` | ein Vorgänger ist nicht abgenommen; der Untertitel nennt ihn |

Die **Form** trägt die Aussage, die Farbe bestätigt sie nur: wartend ein leerer Kreis, in Arbeit
ein voller, glühender Punkt, abgenommen ein voller Punkt, nicht abgenommen ein Kreuz, blockiert
ein leeres Quadrat. In der Segmentleiste ist „nicht abgenommen" gestreift, „in Arbeit" voll und
glühend. So bleiben Glut und Rot auch ohne Farbsehen unterscheidbar. Glut hat zwei Töne und
markiert ausschließlich zweierlei: `--live` (Orange, glüht) „läuft gerade", `--you` (Gelb, blinkt)
die Punkte, die auf den Menschen warten. Andere Animation gibt es nicht, und
`prefers-reduced-motion` schaltet beide ab.

Die Segmentleiste im Kopf (`.pips`) hat **genau so viele Segmente wie Pakete**, in der Reihenfolge
der Tabelle, und jedes Segment trägt eine der fünf Klassen. Ein Segment ohne Klasse gibt es nicht.
Ihr `aria-label` und die Zeile daneben nennen dieselben Zahlen.

## Offene Punkte

Zwei Sorten. Die Schiene links sagt, welche:

- `.item.you` (Glut, Gelb): **Ohne den Menschen geht es nicht weiter.** Das sind Entscheidungen,
  Freigaben und nicht abgenommene Pakete. Bricht der Lauf ab, wird der Grund ebenfalls ein
  Glut-Punkt. Diese Punkte zählt die Kachel „Wartet auf dich".
- `.item.run` (Blau): **Der Lauf hebt es selbst**, vorerst. Ein Beispiel ist eine Kennzahl unter
  Ziel, die ein laufendes Paket heben soll.

Ein Punkt, der den Lauf nicht anhält, gehört trotzdem auf die Tafel, aber in die blaue Sorte.
Sonst gewöhnt sich der Leser an, über Glut hinwegzulesen. **Ein blauer Punkt kippt zu Glut**, wenn
das Paket, das ihn heben sollte, abgenommen ist und der Befund bleibt. Der Satz sagt dann, was
entschieden werden muss.

Je Punkt: eine Überschrift (*was* es ist), ein Wort für die Art in `.owner` (Entscheidung /
Freigabe / im Lauf; bei Glut mit `blink-dot`), **ein** Satz mit dem Befund und seiner Folge, und
die Monozeile `.meta2` mit dem Harten: seit wann, welcher Branch, was dadurch hängt.

Die Kachel liest sich `2` über `von 3 offenen Punkten · 1 hebt der Lauf`. Eine nackte Gesamtzahl
zwingt zum Nachzählen. Ist nichts offen, trägt der Block die Zeile `Nichts offen.`

## Kennzahlen

Die Kachel „Tests" gibt es immer: Zahl jetzt, Zahl zu Beginn, grün oder nicht, Suiten, Uhrzeit.

Die **Kennzahlkachel ist optional** (`.read.metric`). Sie gehört auf die Tafel, wenn das Issue eine
Kennzahl des Epics nennt, samt Ziel. Nennt es keine, wird die Kachel ganz entfernt. Jede Zahl trägt
ihre Basis in `.basis`: n, Satz, Datum, Einheit.

Die Kennzahlkachel ist die **einzige** Fläche mit Hitze-Tönung; ihr `style="--tint: …"` färbt die
ganze Kachel. Ohne sie gibt es auf der Tafel keine Hitze. Getönt wird nach dem Abstand zum Ziel:

| Abstand | `--tint` |
|---|---|
| Ziel erreicht | `var(--heat-3)` |
| knapp darunter (Schwelle aus dem Issue, sonst 3 Punkte) | `var(--heat-5)` |
| mehr | `var(--heat-7)` |

Der Balken ist `.meter`: `<i style="width: <wert>%">` der Wert, `<u style="left: <ziel>%">` die
Zielmarke.

## Zeitleiste

Eine Spur je Platz des Fensters (`window`), also bei `window: 1` genau eine. Die Überschrift nennt
die Zahl der Plätze.

Zwölf Spalten, `grid-column: <von> / <bis>`, ab 1 gezählt. Läuft alles an einem Tag, sind die
Achsenbeschriftungen Stunden. Zieht sich der Lauf über mehrere Tage, sind es Tage (`22.9.`,
`23.9.`), und ein Balken darf über mehrere Spalten laufen. Ein leerer Platz bleibt leer. Das ist
kein Fehler, und die Abweichungszeile darunter sagt, warum er leer ist.

## Fortschreiben

Dieselbe Datei, derselbe `file_path`, dieselbe URL. `icon` und `<title>` bleiben gleich, denn
Leser finden ihre Registerkarte daran. Ein `label` je Fortschreibung (`stand-nach-943`,
`endstand`) erscheint in der Versionswahl.

Fortgeschrieben wird bei **jedem** Merge und ein letztes Mal vor dem Pull Request. Nachzuziehen
sind jedes Mal:

- Laufzustand, Stand-Zeitstempel, Nummer der Fortschreibung und Sternzeit in `.stamp`
- Zustände, Merge-Commits, Runden und Untertitel in der Tabelle; die Segmentleiste samt
  `aria-label`
- Teststand und Kennzahl samt Basis in den Kacheln der Seitenleiste
- die offenen Punkte: dazugekommene, erledigte, gekippte
- Balken und Achse der Zeitleiste, die Abweichungszeile

Eine Tafel, die nach dem dritten Merge noch den Anfang zeigt, ist schlimmer als keine, denn sie
sieht aktuell aus.

## Vor der ersten Veröffentlichung prüfen

- Der Musterstempel `<span class="demo">Musterbelegung</span>` ist entfernt, der Laufzustand
  steht auf `Lauf im Gang`.
- Keine Musterdaten mehr auf der Seite. Die Ausgabe muss leer sein:
  ```bash
  grep -n "Musterbelegung\|Beispielrepo\|Auftragsliste\|1&nbsp;438\|#9[45][0-9]\|release/9.4\|epic/942-\|agent/949-\|1a2b3c4\|5d6e7f8\|9a0b1c2\|export_legacy\|Exporte unter 2 s\|= 318\|>318<\|88,7\|22.09.2026, 14:05\|80724.8" "<scratchpad>/lauftafel-<nr>.html"
  ```
  Trägt der echte Lauf selbst eine Nummer zwischen #940 und #959, meldet das Muster `#9[45][0-9]`
  auch echte Treffer. Dann jede Zeile einzeln ansehen.
- Zahl der Pakete = Zeilen der Tabelle = Segmente in `.pips`.
- Die Kachel „Wartet auf dich" zählt dieselben Punkte, die unten Glut tragen.
- Stand und Sternzeit stammen aus demselben Uhrenaufruf.
- Gibt es keine Kennzahl, ist die Kennzahlkachel samt Kommentar entfernt.
