# `persona-review` für Menschen

4–7 Persona-Agenten in festen Rollen (Neuling, Spezialist, Leitung, „nur Maus“, „liest wörtlich“ …)
spielen synthetische Fälle auf einer **lokalen** Instanz mit Datenbankkopie durch. Sie sehen
Screenshots wie ein Mensch, zählen jeden Klick, getrennt nach reiner Sucherei, und schreiben Berichte
in fester Form. Der Host prüft jeden Fehlerbefund im Code nach, bevor er als Fehler gilt, legt dir
die offenen Entscheidungen vor und macht daraus Tickets für `/mission`. Nach den Fixes läuft eine neue
Runde mit denselben Fällen auf neuen Datensätzen; erst der Vergleich zeigt, ob die Bedienung
leichter wurde. Eine Abnahme-Probe mit Gegenprobe schließt ab. Die Anweisungen an den Agenten
stehen in [`SKILL.md`](SKILL.md).

- **Starten:** die Sitzung auf Fable stellen (`/model fable`, `/effort high`), dann
  `/persona-review <Funktion oder PR>`, für eine Folgerunde mit `runde <N>`.
- **Du entscheidest zweimal:** bei der Startvorlage (Personas, Fälle, Modell der Personas — eine
  Kostenfrage) und bei den Befunden, die eine Entscheidung brauchen.
- **Projekt:** Adapter `.claude/persona-review.md` mit Basis-URL, Login, Anlage der Fälle,
  verbotenen Werten und Ablage ([Vertrag](references/adapter.md)). Die Ablage liegt außerhalb
  jedes öffentlichen Repositorys; Screenshots können vertrauliche Werte zeigen.
