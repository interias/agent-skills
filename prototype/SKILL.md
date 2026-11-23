---
name: prototype
description: Einen Wegwerf-Prototyp bauen, um eine Entwurfsfrage zu beantworten. Zum Prüfen, ob ein Zustandsmodell oder eine Logik stimmt, oder zum Erkunden, wie eine Oberfläche aussehen soll.
---

# Prototyp

Ein Prototyp ist **Wegwerfcode, der eine Frage beantwortet**. Die Frage bestimmt die Form. Stell sie
zuerst fest — aus dem Auftrag, dem umgebenden Code oder per Rückfrage, wenn der Mensch erreichbar
ist.

## Zwei Fragen, zwei Formen

- **„Stimmt diese Logik, dieses Zustandsmodell?“** Baue **eine einzige HTML-Datei**, die der Mensch
  per Doppelklick öffnet: freie Schaltflächen und geführte Abläufe, die das Modell durch die Fälle
  treiben, die sich auf dem Papier schwer durchdenken lassen. Nach **jeder** Aktion zeigt sie den
  vollständigen, relevanten Zustand, damit man sieht, was sich geändert hat.
- **„Wie soll das aussehen?“** Baue **mehrere grundverschiedene Varianten** derselben Oberfläche an
  einer Stelle, umschaltbar über einen URL-Parameter und eine schwebende Leiste am unteren Rand. Bei
  jedem Wechsel ist die Variante sichtbar benannt.

Die Formen sind nicht austauschbar; die falsche vergeudet den ganzen Prototyp. Ist die Frage
unklar und niemand erreichbar, richte dich nach dem umgebenden Code (Modul im Hintergrund → Logik,
Seite oder Bauteil → Oberfläche) und schreib die Annahme oben in den Prototyp.

## Ablage

**HTML-Prototypen** legst du in den Ordner `prototype_dir` des Adapters (`.claude/epic.md`; Standard
`prototypen/`, relativ zur Wurzel des Repositorys; Schlüssel in `mission/references/adapter.md`). Dort
zeigt sie das Holodeck der Flottenbrücke: Der Flotten-Treiber schickt jede HTML-Datei **direkt** in
diesem Ordner an die Brücke — keine Unterordner, keine Verknüpfungen, höchstens 50 Dateien zu je
2 MB. Der Dateiname besteht nur aus Buchstaben, Ziffern, `.`, `_` und `-`; sonst wird die Datei
übersprungen. Also: eine in sich geschlossene Datei (Stil und Skript eingebettet, nichts von außen
nachgeladen), ohne Netzverbindungen — die Brücke sperrt sie —, die auch auf dem Telefon bedienbar
bleibt.

**Code-Prototypen** (Oberfläche in der echten Anwendung) liegen nahe an dem, was sie erkunden, und
folgen dem Routing, das das Projekt schon hat; keine neue Struktur auf oberster Ebene. Der Name zeigt
auf den ersten Blick: Prototyp, nicht Produktion.

## Regeln für beide

1. **Von Anfang an Wegwerf, und sichtbar so.** Name und Kopfkommentar sagen es.
2. **Mühelos zu starten.** Logik: Doppelklick. Oberfläche: ein Befehl im Aufgabenläufer des
   Projekts. Kein eigener Server dauerhaft, kein voller Stack.
3. **Keine Ablage von Daten.** Der Zustand liegt im Speicher; Persistenz ist höchstens das, was der
   Prototyp prüft. Betrifft die Frage eine Datenbank, dann eine Wegwerf-Datei oder -Datenbank mit
   dem Namen „PROTOTYP, löschen“.
4. **Kein Feinschliff.** Keine Tests, keine Fehlerbehandlung über das Lauffähige hinaus, keine
   Abstraktionen. Es geht darum, schnell etwas zu lernen.
5. **Festhalten, wenn er fertig ist.** Die bestätigte Entscheidung wandert in den echten Code. Die
   Antwort (Urteil und die Frage, die sie klärte) steht im Missionsziel oder in einem Commit, und
   der Prototyp bleibt als Primärquelle erreichbar: im `prototype_dir`, wenn er dort schon liegt,
   sonst auf einem Wegwerf-Zweig außerhalb von `main`, mit Verweis am Missionsziel. Auf `main` bleibt
   nur die bestätigte Entscheidung.
