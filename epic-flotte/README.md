# `/epic-flotte` für Menschen

Mehrere Epics gleichzeitig, geführt von einem Admiral-Chat. Die Anweisungen an den Agenten stehen
in [`SKILL.md`](SKILL.md). Dasselbe als Programm statt als Chat ist der Flotten-Treiber
[`flotte`](../flotte/SKILL.md); umschalten: [`flotte/references/umschalten.md`](../flotte/references/umschalten.md).

![Flottenbild: /epic-flotte, der Admiral mit Zufallsnamen, startet drei /epic-Läufe A bis C nebeneinander; ein vierter wartet, bis ein Platz frei wird. Jeder Lauf fragt am Vorab-Tor den Admiral, endet mit offenem Pull Request, durchläuft /epic-nacharbeit, wartet auf deinen Merge und endet mit /epic-aufraeumen. Darunter die Kollisionsstufen (keine 4, klein 3–4, mittel 2, groß 1 gleichzeitig) und das Entscheidungsrecht des Admirals (selbst, mit Präzedenz, immer du).](../assets/flotte/flotte.png)

- **Starten:** die Sitzung auf Fable stellen (`/model fable`, `/effort high`), dann
  `/epic-flotte #15 #21 #32` oder ohne Argument für alle freigegebenen Epics.
- **Jedes Epic läuft als eigene Sitzung,** die du in der Seitenleiste öffnen kannst; im Terminal
  ohne Sitzungswerkzeuge als Subagent. Wie viele gleichzeitig laufen, bestimmt die Kollisionsstufe
  je Paar, nie mehr als vier. Der Träger Sitzung ist an einem echten Einsatz noch nicht erprobt
  (Stand 12.11.2026).
- **Entscheidungsrecht:** Der Admiral entscheidet die Fragen der Läufe endgültig; du bestätigst
  nichts vorab, sondern liest nach und widerrufst, was dir nicht passt. Die Grenze: Was sich nach
  dem Fakt nicht widerrufen lässt, bleibt bei dir, und der Lauf wartet.

  | Der Admiral entscheidet | Immer du |
  |---|---|
  | jede Frage eines Laufs, die bis zum Merge umkehrbar ist, auch gegen die Empfehlung des Laufs und mit eigener Antwort; Belegung und Reihenfolge; Handgriffe der Nacharbeit | Produktiv- und Stammdaten, Zugriffe, Freigaben aus `gate_approvals`, das Lockern einer Regel, eine Freigabe trotz RAM-Bremse, Mergen, Remote-Branch löschen, alles nach dem Merge |

- **Nachlesen:** Jede Entscheidung steht als Kommentar am betroffenen Issue und im Pull Request
  des Epics. Die einflussreichen — Abweichung von der Empfehlung des Laufs, eigenes Urteil,
  geänderter Umfang, etwas bleibt ungeprüft — stehen zusätzlich im **Entscheidungsprotokoll**, den
  Kommentaren am Issue `Flottenlogbuch`: Frage, Lage, Optionen, Entscheidung, Warum.
- **Widerrufen:** im Chat, in der Lagebesprechung oder als Kommentar. Der Admiral gibt den
  Widerruf an den Lauf und schlägt die Regel vor, die ihn künftig erspart: für das Projekt im
  Abschnitt „Entscheidungsregeln" des Adapters, oder für alle Projekte als Änderung dieses Skills.
- **Bremsen:** Die Verbrauchsbremse liest 5-Stunden- und Wochenlimit (bei Gelb nichts Neues, bei
  Rot Pause bis zum Reset), die RAM-Bremse den Speicher. Den Stand schreibt der Admiral als Stufe
  ins Issue `Flottenlogbuch`.

Die **Flottentafel** zeigt dir im Browser, wo jeder Lauf steht und was bei dir liegt, hier mit
den Musterdaten der Vorlage:

![Flottentafel mit Musterdaten: Kennzahlen links, oben die Läufe als Schiffe in Formation hinter dem Admiral, darunter die Verbrauchsbremse, der Stand der Läufe mit Zustand und Paketen, rechts was beim Menschen liegt, unten die Belegung der drei Plätze als Zeitleiste.](../assets/flotte/flottentafel.png)
