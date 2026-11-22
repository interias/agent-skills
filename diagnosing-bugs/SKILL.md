---
name: diagnosing-bugs
description: Einen roten Test, einen Fehler oder eine Verlangsamung eingrenzen, bevor etwas geändert wird. Wenn die Ursache nicht auf der Hand liegt, auch für Rot, das nach einer Änderung oder einem Andocken auftaucht.
---

# Fehler eingrenzen

Die Ursache liegt selten dort, wo man zuerst hinsieht. Wer zuerst Code liest und dann ändert,
repariert oft den falschen Ort und verdeckt den Fehler. Dieser Skill ordnet die Arbeit nach einer
Frage: **Was hat sich zwischen „grün“ und „rot“ geändert, und kann ich das auf Knopfdruck zeigen?**

## Erst einordnen: welches Rot ist das?

Bevor du suchst, entscheide, zu welchem Fall das Rot gehört. Jeder Fall hat einen anderen ersten
Schritt.

- **Rot in Dateien, die dein Paket nicht berührt.** Fahr genau diese Datei einzeln. Grün: Lastflake
  (die Maschine war voll), im Bericht vermerken, nicht beheben. Rot: Es ist echt, weiter mit den
  nächsten Fällen.
- **Schon auf dem Hauptzweig rot.** Sieh in den Ausgangszahlen nach, und fahr die Datei im
  Ausgangsstand des Pakets (Änderung vorübergehend zurücknehmen; nicht im Hauptverzeichnis, dort
  laufen andere Pakete). Ist sie dort rot, gehört das Rot nicht zu dir: Du vergleichst gegen die
  Ausgangszahlen und behebst es nicht, außer die Abnahmeliste verlangt es.
- **Rot nach dem Andocken eines anderen Pakets auf dem Missionszweig.** Beide Pakete waren je für
  sich grün; gesucht ist das Zusammenspiel. Fahr die Datei im Stand vor und nach dem Andocken, dann
  vergleiche, was das andere Paket an gemeinsamen Dateien, Fixtures und Einstellungen berührt hat.
- **Weniger Tests als in den Ausgangszahlen, aber alles grün.** Das ist kein Grün. Suche, welche
  Datei oder welcher Test fehlt (gelöscht, übersprungen, durch einen Fehler beim Einlesen nie
  gestartet) und stelle ihn wieder her.
- **Rot nur im Volllauf, einzeln grün.** Verdacht auf Abhängigkeit zwischen Tests oder auf Last;
  Abschnitt „Flackern“ unten.
- **Ein echter, neuer Fehler** oder eine Verlangsamung: weiter mit der Probe.

## Die Probe

Eine Probe ist **ein Befehl**, den du schon gefahren hast und der genau diesen Fehler rot zeigt.
Sie muss das Symptom des Auftrags treffen (nicht ein ähnliches), bei gleicher Eingabe gleich
antworten, in Sekunden laufen und ohne Mensch auskommen. „Läuft ohne Absturz“ ist keine Probe.

Vorschläge für ihre Form, nimm die nächstliegende:

- die schon rote Testdatei, einzeln und mit dem Namen des Tests gefahren,
- ein Aufruf des Werkzeugs mit einer festen Eingabe, dessen Ausgabe du neben die des letzten
  grünen Stands legst,
- ein Stand-Vergleich: derselbe Befehl im Stand vor und im Stand nach der Änderung (Änderung
  vorübergehend zurücknehmen; kein `git stash`, sein Stapel gilt für alle Worktrees der Pakete,
  und das Hauptverzeichnis nicht umschalten),
- eine nachgespielte Eingabe: das Ereignisprotokoll oder die Nutzlast, bei der es passierte,
  durch den betroffenen Pfad geschickt.

Ohne Probe keine Ursachenforschung: Jede Vermutung bleibt dann ungeprüft.

### Wenn keine Probe gelingt

Hier sitzt niemand am Bildschirm, den du fragen könntest. Nenne im Bericht, was du versucht hast
und was dir fehlt (Zugang zur Umgebung, ein Mitschnitt, die Eingabe des Falls), und ändere nichts
auf Verdacht. Das Fehlende ist der Befund.

## Verkleinern

Mach die Probe kleiner, solange sie rot bleibt: Eingaben, Schritte, Einstellungen, Daten einzeln
streichen und jedes Mal neu fahren. Übrig bleibt, was für den Fehler nötig ist, und das ist die
Vorlage für den späteren Test. Achte darauf, dass das Rot dasselbe bleibt; ein anderes Rot ist ein
anderer Fehler.

## Flackern

Rot, das nicht bei jedem Lauf kommt, braucht zuerst eine **Quote** statt eines Falls: Fahr dieselbe
Datei dreißigmal hintereinander und zähl. Danach treibst du die Quote hoch, bis ein Lauf sich lohnt:
gleichzeitig fahren, die Maschine belasten (ein zweiter Volllauf nebenher), Zeitvorgaben
verkürzen, die Reihenfolge der Tests vertauschen. Entscheidend ist, ob das Rot an der **Last**
hängt (Zeitgrenzen, Wartezeiten) oder an der **Reihenfolge** (ein Test hinterlässt Zustand). Lastflakes
behebst du nur, wenn die Abnahmeliste es verlangt; sonst steht der Befund im Bericht, mit der
Quote.

## Vermuten und messen

Halte zuerst mehrere Vermutungen nebeneinander und sortiere sie nach Wahrscheinlichkeit. Zu jeder
gehört, was du **ändern oder messen** wirst und was daraufhin geschehen müsste. Eine Vermutung,
bei der du nichts vorhersagen kannst, streichst du.

Dann je Probe eine Änderung. Muss etwas ausgegeben werden, dann an der Stelle, die zwei
Vermutungen unterscheidet, und mit einer Marke, die du später mit einem Suchbefehl findest
(`ZZ-DIAG`). Bei Verlangsamung zuerst die **Zeit oder Zahl vor der Änderung** festhalten, sonst
fehlt der Vergleich.

## Beheben und festhalten

1. Die verkleinerte Probe wird ein Test, und zwar dort, wo der Fehler so auftritt, wie ein
   Aufrufer ihn erlebt. Findest du keinen solchen Ort, vermerke es im Bericht.
2. Rot sehen, beheben, Grün sehen. Dann die ursprüngliche Probe noch einmal, unverkleinert.
3. Gegen die Ausgangszahlen vergleichen: Die Zahl der Tests darf nicht gesunken, die der roten
   nicht gestiegen sein (`tdd`, „Tests im Auftrag“).
4. Die Marken suchen und entfernen, Wegwerf-Dateien löschen.
5. Im Bericht in zwei Sätzen: woran es lag, woran du es erkannt hast.

## Was nicht in den Bericht darf

Schlüssel, Token und Anmelde-Kopfzeilen in Ausgaben schwärzt du, bevor du sie zeigst. Zitiere nur
die Zeilen, die den Fehler tragen.
