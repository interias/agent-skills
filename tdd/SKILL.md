---
name: tdd
description: Testgetrieben arbeiten. Zum Umsetzen von Funktionen oder Fehlerbehebungen mit Test zuerst, bei „Rot, Grün“ oder wenn ein Verhalten durch Tests festgehalten werden soll.
---

# Test zuerst

Ein Test ist hier die **ausführbare Fassung eines Abnahmepunkts**: Er geht rot, solange der Punkt
nicht erfüllt ist, und grün, wenn er es ist. Wer erst den Code schreibt, prüft hinterher, was er
gebaut hat, nicht, was verlangt war.

## Der Takt

Je Abnahmepunkt eine Runde, nie alle Tests auf einmal:

1. **Rot.** Schreib den einen Test für den nächsten Abnahmepunkt und fahr ihn. Er muss aus dem
   richtigen Grund fehlschlagen — an der fehlenden Funktion, nicht an einem Tippfehler im Test.
   Geht er sofort grün, prüft er nichts Neues: schärfen oder streichen.
2. **Grün.** Gerade so viel Code, dass dieser Test besteht. Nichts für Tests, die noch kommen.
3. **Aufräumen im Kleinen** nur am Code, den du in dieser Runde geschrieben hast, und nur bei
   grünem Test. Ein Umbau darüber hinaus ist eine eigene Entscheidung, kein Teil des Takts.

## Wo getestet wird

Teste am **Rand des Bausteins**, so wie ein Aufrufer ihn benutzt, nicht in seinem Inneren. Ein
guter Test überlebt den Umbau der Innereien; bricht er bei einem Umbau, der nichts am Verhalten
ändert, hing er am Falschen.

- Die Naht ist meist schon da: Der Verifikationsweg der Abnahmeliste und die bestehenden Testdateien
  neben dem Code zeigen, wo das Projekt testet. Nimm sie, lege keine neue Ebene an.
- Interne Helfer nicht nachspielen und nichts über Nebenwege prüfen (die Ausgabedatei öffnen statt
  den Befehl zu fahren, den der Aufrufer benutzt). Doppelgänger nur an der Grenze zum Fremden:
  Netz, Uhr, Plattenfüllstand.
- Steht die Form der Schnittstelle selbst infrage, hilft `codebase-design`.

## Was ein Test nicht sein darf

- **Ein Zählertest, der seinen Sollwert aus dem Code holt:** Wer prüft, dass der Bericht „7
  Dateien“ nennt, und die 7 mit derselben Zählfunktion bildet, bekommt nie Rot. Schreib die Zahl
  aus einem Beispiel hin, das du von Hand nachgezählt hast.
- **Ein Test, der sofort grün ist:** Läuft er nach deiner Änderung schon beim ersten Mal grün,
  prüft er sie nicht. Setz die Änderung testweise zurück; bleibt er grün, ist er zu schwach oder
  trifft die falsche Stelle. Hast du Rot künstlich erzwungen, vergleiche gegen den unveränderten
  Stand, bevor du dem Rot traust.
- **Ein Test, der die Maschine voraussetzt:** Er ist nur grün, wenn er allein läuft oder die
  Maschine leer ist. Er wird im Volllauf irgendwann zur Lastflake. Uhr, Zufall und Wartezeiten
  legst du im Test fest.
- **Alle Tests vorab:** Schreibst du die Tests für alle Abnahmepunkte, bevor ein Punkt gebaut ist,
  prüfen sie die Form, die du dir vorstellst. Je Punkt eine Runde, die nächste lernt aus der
  letzten.

## Fehlerbehebung

Ein Fehler wird zuerst ein roter Test, dann behoben. Ist das Rot nicht zu bekommen, ist die
Ursache noch nicht gefunden: dann gehört `diagnosing-bugs` davor.

## Tests im Auftrag

Gezielt iterieren, einmal voll: Während der Arbeit läuft nur die betroffene Testdatei, am Ende
einmal jede betroffene Suite ganz, und das Ergebnis geht gegen die **Ausgangszahlen** der Suite.
Ein Test wird für das Grün weder gelöscht noch übersprungen noch gelockert.

Kann ein Abnahmepunkt nicht per Test gefasst werden (Dokumentation, Konfiguration, ein
Installationsschritt), steht im Bericht, womit er stattdessen belegt ist — der Verifikationsweg des
Auftrags, mit echter Ausgabe.
