# Persona-Steckbrief

Eine Persona ist eine **Rolle**, kein Mensch: Nie den Namen, die Eigenheiten oder Zitate echter
Kollegen übernehmen. Ein Vorname macht den Bericht lesbar; er bleibt erfunden.

## Steckbrief

```markdown
### <Kurzname> — <Rolle>

- **Rolle und Alltag:** was sie tut, wofür sie die Software braucht, wie oft.
- **Erfahrung:** Jahre im Fach; ob sie den Prozess kennt, den die Funktion abbildet.
- **Softwaregewandtheit:** 1 (meidet Software) bis 5 (sucht Tastenkürzel).
- **Eigenheit:** die eine Gewohnheit, die ihr Verhalten in der Oberfläche prägt.
- **Was ihr wichtig ist:** woran sie das Ergebnis misst.
- **Fall:** Kennung aus `cases.json`, ein Satz Umfang.
```

## Streuung

Die Besetzung soll die Arten abdecken, wie Menschen an einer Oberfläche scheitern. Wähle aus diesen
Achsen so, dass keine zwei Personas gleich sind:

| Achse | Pole |
|---|---|
| Erfahrung im Fach | Berufsanfänger … erfahrener Spezialist |
| Gewandtheit | „klickt alles an“ … „gibt nach dem zweiten Fehlversuch auf“ |
| Blick | erfasst eigene Arbeit … prüft fremde Arbeit (Leitung, Freigabe) |
| Umfang | kleiner Fall mit drei Schritten … großer Fall über mehrere Objekte |

## Eigenheiten

Je Persona eine; sie steuert, was die Persona übersieht und woran sie hängen bleibt.

| Eigenheit | Wirkt so |
|---|---|
| **nur Maus** | keine Tastenkürzel, kein Tab; Doppelklick und Kontextmenü erst nach Suche |
| **liest wörtlich** | nimmt Beschriftungen beim Wort; ein Symbol ohne Text ist für sie kein Knopf |
| **Tabellenkalkulations-Denker** | erwartet Zeilen, Tab, Einfügen aus der Zwischenablage, Summen unten |
| **Leiter, der fremde Pläne prüft** | sucht Übersicht, Summen und Abweichungen, gibt selbst wenig ein |
| **misstrauisch gegenüber Zahlen** | rechnet nach; ein Wert ohne Herleitung senkt das Vertrauen |
| **eilig** | nimmt den ersten Weg, der passt, liest keine Hinweise |
| **gründlich** | erfasst alles, auch was der Fall nur andeutet; findet Grenzen der Eingabe |
| **Fachsprache statt Softwaresprache** | scheitert an Begriffen, die der Betrieb anders nennt |

## Beispielbesetzung (fiktiv, für eine Bestellverwaltung)

| Persona | Rolle | Gewandtheit | Eigenheit |
|---|---|---|---|
| Ana | Sachbearbeiterin, zwei Jahre | 3 | Tabellenkalkulations-Denkerin |
| Ben | Einkäufer, zwanzig Jahre | 2 | liest wörtlich |
| Cem | Auszubildender | 4 | eilig |
| Dora | Teamleiterin, gibt Bestellungen frei | 3 | Leiterin, die fremde Pläne prüft |
| Emil | Lagerist, selten am Rechner | 1 | nur Maus |
