---
name: codebase-design
description: Gemeinsamer Wortschatz für tiefe Module. Zum Entwerfen oder Verbessern einer Modulschnittstelle, zum Finden von Vertiefungen, zur Frage, wo eine Naht hingehört, und wenn Code leichter testbar oder für Agenten auffindbar werden soll.
---

# Codebase-Design

Entwirf **tiefe Module**: viel Verhalten hinter einer kleinen Schnittstelle, an einer sauberen Naht,
durch diese Schnittstelle testbar. Der Gewinn: Hebel für Aufrufer, Ortsnähe für Wartende,
Prüfbarkeit für alle. Gilt für den Ingenieur beim Entwerfen ebenso wie für den Ersten Offizier beim
Beurteilen eines Schnitts.

Die Begriffe unten gelten genau so; ersetze sie nicht durch „Komponente“, „Service“, „API“ oder
„Grenze“. Fachbegriffe des Projekts stehen in dessen `CONTEXT.md` und haben Vorrang, wo sie
kollidieren.

## Begriffe

- **Modul:** alles mit Schnittstelle und Implementierung, ohne Größenvorgabe — Funktion, Klasse,
  Paket, ein Schnitt durch mehrere Schichten.
- **Schnittstelle:** alles, was ein Aufrufer wissen muss, um das Modul richtig zu benutzen: Typen,
  aber auch Invarianten, Reihenfolgen, Fehlerfälle, nötige Konfiguration, Laufzeitverhalten.
  Nicht „Signatur“ — das ist nur die Typebene.
- **Implementierung:** was im Modul steckt.
- **Tiefe:** Hebel an der Schnittstelle — wie viel Verhalten ein Aufrufer oder Test je gelerntem
  Stück Schnittstelle ausüben kann. **Tief**, wenn viel Verhalten hinter wenig Schnittstelle liegt;
  **flach**, wenn die Schnittstelle fast so verwickelt ist wie die Implementierung.
- **Naht** (nach Michael Feathers): eine Stelle, an der sich Verhalten ändern lässt, ohne dort zu
  editieren — der Ort, an dem die Schnittstelle liegt. Wohin die Naht kommt, ist eine eigene
  Entscheidung, getrennt von dem, was dahinter liegt.
- **Adapter:** etwas Konkretes, das an einer Naht die Schnittstelle erfüllt. Er beschreibt die
  Rolle, nicht den Inhalt: ein kleiner Adapter mit großer Implementierung (Datenbank) oder ein
  großer mit kleiner (Attrappe im Speicher).
- **Hebel:** was Aufrufer aus der Tiefe ziehen. Eine Implementierung zahlt sich an N Aufrufstellen
  und M Tests aus.
- **Ortsnähe:** was Wartende aus der Tiefe ziehen. Änderung, Fehler, Wissen und Prüfung bündeln sich
  an einer Stelle statt bei den Aufrufern.

## Grundsätze

- **Tiefe gehört zur Schnittstelle, nicht zur Implementierung.** Ein tiefes Modul darf innen aus
  kleinen, austauschbaren Teilen bestehen; sie gehören nur nicht zur Schnittstelle. Es hat eine
  äußere Naht und darf innere haben, die nur seine eigenen Tests nutzen.
- **Löschprobe.** Denk dir das Modul gelöscht. Verschwindet die Komplexität, war es ein
  Durchreicher. Taucht sie bei N Aufrufern wieder auf, hat es sich verdient.
- **Die Schnittstelle ist die Testfläche.** Aufrufer und Tests überschreiten dieselbe Naht. Willst
  du an der Schnittstelle vorbei testen, hat das Modul vermutlich die falsche Form.
- **Ein Adapter ist eine Vermutung, zwei sind eine Naht.** Führ keine Naht ein, solange nichts
  über sie hinweg variiert.
- **Tiefe ist kein Zeilenverhältnis.** Wer Implementierungszeilen gegen Schnittstellenzeilen zählt,
  belohnt Aufblähen. Gemessen wird der Hebel.

## Beim Entwerfen fragen

- Lassen sich Methoden einsparen?
- Lassen sich Parameter vereinfachen?
- Lässt sich mehr Komplexität nach innen verlagern?

**Prüfbarkeit:**

1. Abhängigkeiten **annehmen**, nicht selbst erzeugen (`verarbeite(bestellung, zahlung)` statt
   `new Zahlungsdienst()` im Rumpf).
2. Ergebnisse **zurückgeben**, statt Nebenwirkungen zu erzeugen (`rabatt(warenkorb)` liefert den
   Rabatt, statt den Korb zu verändern).
3. **Kleine Oberfläche.** Weniger Methoden brauchen weniger Tests, weniger Parameter weniger Aufbau.

## Vertiefen und Alternativen

**Ein Bündel flacher Module vertiefen:** Sortiere die Abhängigkeiten. Was im Prozess liegt und rein
rechnet, lässt sich direkt zusammenlegen und über die neue Schnittstelle testen. Was außerhalb
liegt (Datenbank, Netz, Uhr), bekommt eine Naht mit einem echten und einem Test-Adapter — erst wenn
beide gebraucht werden. Die alten Tests auf den flachen Modulen **ersetzt** du durch Tests an der
neuen Schnittstelle, du schichtest sie nicht darüber.

**Alternativen erkunden:** Bei einer unklaren Schnittstelle entwirf sie mehrmals grundverschieden —
bei Bedarf als parallele Kundschafter-Aufträge, die nur Entwürfe liefern, keinen Code — und
vergleiche nach Tiefe, Ortsnähe und Nahtlage. Die Wahl samt Grund hältst du fest; ist sie schwer
umkehrbar und überraschend, gehört sie als ADR in die Doku des Projekts.
