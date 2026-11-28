# Die Blöcke

Ein Lauf unter dem Treiber fragt den Admiral, nicht den Menschen (`mission/SKILL.md`, „Wie gefragt
wird"). Am Vorab-Tor, in einer Fragerunde der Nacharbeit und bei jeder Abbruchbedingung **beendet
der Lauf seinen Zug** mit dem Frageblock unten, als Text, nie mit `AskUserQuestion`. Der Treiber
liest den Block (`flotte bloecke`, `src/werkzeuge/bloecke.ts`), holt die Antworten des Admirals
(`entscheidungsrecht.md`) und setzt den Lauf mit `--resume` fort; er arbeitet mit seinem ganzen
Kontext weiter.

Der Frageblock, mit dem ein Lauf seinen Zug beendet:

```
FLOTTE-FRAGE <epic> <phase: tor | nacharbeit | abbruch | ram>
1. <Frage> — Betrifft: <Pakete samt Nachfolgern | Lauf> — Lage: <Sachverhalt mit Fundstellen> — Optionen: A) <…, Folge> B) <…, Folge> — Empfehlung: <Buchstabe> — Grund: <ein Satz> — Regel/Quelle: <Skill, Adapter, ADR> — Kurz: <die Frage in einem Satz, höchstens 90 Zeichen>
2. …
STAND: <ein Satz, wo der Lauf steht>  TAFEL: <URL der Lauftafel>
```

Eine Frage darf auch als Überschrift mit Folgezeilen kommen (`Q1 — <Frage>`, `**Q1** <Frage>` oder
`❓ **Q1** — <Frage>`). Die Zeilen darunter gehören zu ihr: `Betrifft:`, `Lage:`, `Empfehlung:` usw.
als Felder (auch fett, `**Lage:** …`), Optionen als Liste `- A) …` oder `- **A)** …`. Lässt sich ein
Block gar nicht in Fragen zerlegen, geht sein Wortlaut als eine Frage an den Admiral, nicht gleich an
den Menschen.

`Kurz` ist die Frage als ganzer Satz von höchstens 90 Zeichen, so wie sie auf der Karte „Braucht dich“
und in der Push-Meldung steht (#243); länger oder ohne das Feld zeigt die Brücke die Frage selbst.

Optionen sind Großbuchstaben ab `A`, beliebig viele. Darf die Antwort mehrere Optionen zugleich
wählen, steht nach den Optionen `— Auswahl: mehrere`; die Empfehlung nennt dann alle Buchstaben,
durch Komma getrennt (`— Empfehlung: A, C`), und so kommt auch die Antwort (`A, C`, mit eigenem
Text `A, C — Antwort: <…>`). Ohne das Feld gilt Einzelwahl.

Die Optionen braucht der Admiral, um die Frage dem Menschen vorzulegen; an sie gebunden ist er
nicht. `Lage` nennt deshalb den Sachverhalt so, dass er ohne Nachlesen auch anders antworten kann.
Seine Antwort ist ein Buchstabe oder ein eigener Text (`Antwort: <…>`, siehe
`entscheidungsrecht.md`, „Eigene Antwort"); der Lauf arbeitet mit beidem gleich weiter und nennt
die Entscheidungen des Admirals im Body seines Pull Requests (`mission/SKILL.md`, Phase 6). Widerruft
der Mensch später eine Entscheidung, kommt das als `widerruf: <Frage> → <neue Entscheidung>`; wie
es umgesetzt wird, steht in `entscheidungsrecht.md`, „Widerruf".

Was `Betrifft:` anhält: `mission/SKILL.md`, „Eine Frage hält nur an, was von ihr abhängt".

**Meldet ein Lauf `hold`** der RAM-Bremse (`mission/SKILL.md`, „Die RAM-Bremse"), fragt er nicht selbst,
sondern beendet seinen Zug mit einem Frageblock der Phase `ram`: Messwert, Optionen „warten bis
`ok`" (Empfehlung) und „trotz `hold` starten". Die Antwort steht in `bremsen.md`, „RAM-Bremse".

Endet ein Lauf regulär, beendet er seinen Zug mit `FLOTTE-ENDE <epic>`, dem Link auf den Pull
Request und dem Abschnitt `### Was das Epic offen lässt` im Wortlaut.

Endet er ohne Pull Request, weil erst der Mensch etwas tun muss (die Mission parkt), steht direkt
unter der Kopfzeile eine Zeile für ihn:

```
FLOTTE-ENDE <epic>
Mensch: <warten-auf | pr-andocken | label-setzen | entscheiden> [#<n> | <owner/repo>#<n>] — <ein Satz, was der Mensch tun muss>
```

Der Treiber setzt die Mission dann auf „geparkt, wartet auf dich“ statt „blockiert“; der Satz ist
auf der Brücke „Dein Schritt“ und führt zum genannten Ticket oder PR, an der Mission steht er als
Kommentar. Neu eingereiht wird erst, wenn der Schritt getan ist. Ohne die Zeile bleibt es bei
„blockiert, Ursache anderes“.
