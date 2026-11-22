# Die Blöcke

Ein Lauf unter dem Treiber fragt den Admiral, nicht den Menschen (`epic/SKILL.md`, „Wie gefragt
wird"). Am Vorab-Tor, in einer Fragerunde der Nacharbeit und bei jeder Abbruchbedingung **beendet
der Lauf seinen Zug** mit dem Frageblock unten, als Text, nie mit `AskUserQuestion`. Der Treiber
liest den Block (`flotte bloecke`, `src/werkzeuge/bloecke.ts`), holt die Antworten des Admirals
(`entscheidungsrecht.md`) und setzt den Lauf mit `--resume` fort; er arbeitet mit seinem ganzen
Kontext weiter.

Der Frageblock, mit dem ein Lauf seinen Zug beendet:

```
FLOTTE-FRAGE <epic> <phase: tor | nacharbeit | abbruch | ram>
1. <Frage> — Betrifft: <Pakete samt Nachfolgern | Lauf> — Lage: <Sachverhalt mit Fundstellen> — Optionen: A) <…, Folge> B) <…, Folge> — Empfehlung: <Buchstabe> — Grund: <ein Satz> — Regel/Quelle: <Skill, Adapter, ADR>
2. …
STAND: <ein Satz, wo der Lauf steht>  TAFEL: <URL der Lauftafel>
```

Optionen sind Großbuchstaben ab `A`, beliebig viele. Darf die Antwort mehrere Optionen zugleich
wählen, steht nach den Optionen `— Auswahl: mehrere`; die Empfehlung nennt dann alle Buchstaben,
durch Komma getrennt (`— Empfehlung: A, C`), und so kommt auch die Antwort (`A, C`, mit eigenem
Text `A, C — Antwort: <…>`). Ohne das Feld gilt Einzelwahl.

Die Optionen braucht der Admiral, um die Frage dem Menschen vorzulegen; an sie gebunden ist er
nicht. `Lage` nennt deshalb den Sachverhalt so, dass er ohne Nachlesen auch anders antworten kann.
Seine Antwort ist ein Buchstabe oder ein eigener Text (`Antwort: <…>`, siehe
`entscheidungsrecht.md`, „Eigene Antwort"); der Lauf arbeitet mit beidem gleich weiter und nennt
die Entscheidungen des Admirals im Body seines Pull Requests (`epic/SKILL.md`, Phase 6). Widerruft
der Mensch später eine Entscheidung, kommt das als `widerruf: <Frage> → <neue Entscheidung>`; wie
es umgesetzt wird, steht in `entscheidungsrecht.md`, „Widerruf".

Was `Betrifft:` anhält: `epic/SKILL.md`, „Eine Frage hält nur an, was von ihr abhängt".

**Meldet ein Lauf `hold`** der RAM-Bremse (`epic/SKILL.md`, „Die RAM-Bremse"), fragt er nicht selbst,
sondern beendet seinen Zug mit einem Frageblock der Phase `ram`: Messwert, Optionen „warten bis
`ok`" (Empfehlung) und „trotz `hold` starten". Die Antwort steht in `bremsen.md`, „RAM-Bremse".

Endet ein Lauf regulär, beendet er seinen Zug mit `FLOTTE-ENDE <epic>`, dem Link auf den Pull
Request und dem Abschnitt `### Was das Epic offen lässt` im Wortlaut.
