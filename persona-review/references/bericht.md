# Berichtsform

Jede Persona schreibt ihren Bericht genau in dieser Form, in Ich-Form und in ihrer Stimme. Die
feste Form macht Berichte über Personas und Runden vergleichbar; der Host liest die Zahlen aus
Abschnitt 1 und 2 in die Vergleichstabelle.

```markdown
# Bericht <Kurzname> (<Rolle>) — Fall <Kennung>

## 1. Kurzurteil

Drei Sätze: ans Ziel gekommen oder nicht, was am meisten gekostet hat, ob ich dem Ergebnis traue.

- Verständlichkeit: **<1–5>**
- Klickaufwand: **<1–5>**
- Vertrauen ins Ergebnis: **<1–5>** (<ein Halbsatz warum>)

1 = sehr gut, 5 = schlecht.

## 2. Ablauf mit Klickzahlen

| Schritt | Klicks/Eingaben | Zeitgefühl | Was bremste |
|---|---|---|---|
| … | … | kurz / mittel / lang / Schreck | … |
| **Gesamt** | **<n>** | | davon **<m> reine Sucherei** |

Darunter: Anzahl der erfassten Einheiten (<z. B. Positionen, Schritte>), Fehlversuche, die nicht
mitgezählt sind.

## 3. Stolpersteine

Nummeriert, je mit Ort in der Oberfläche, Screenshot-Pfad und Schwere:
**blockiert** (allein hätte ich aufgegeben) / **nervt** / **Kleinigkeit**.

## 4. Begriffe

| In der Anwendung | Unklar, weil | Ich würde sagen |
|---|---|---|

Auch Symbole ohne Beschriftung.

## 5. Was gut war

## 6. Vorschläge für weniger Klicks

Konkret und nach Wirkung sortiert, je mit geschätzter Ersparnis.

## 7. Vorlagen-Ideen

Welche Vorlagen, Pakete oder Voreinstellungen mir die Arbeit abgenommen hätten; was an Auswahl
fehlte.

## 8. Erfasstes Ergebnis

Was am Ende gespeichert ist, je Objekt, und der angezeigte Endwert — ohne die Werte, die der
Auftrag verbietet.
```

**Zählregel:** Die Zahlen sind Schätzungen aus Skripten. Gezählt wird, was ein Mensch getan hätte,
nicht, wie viele Playwright-Aufrufe das Skript brauchte. Ein Schritt, den das Skript technisch
anders lösen musste (etwa per Selektor statt per Suche), zählt so, wie ein Mensch ihn gefunden
hätte.
