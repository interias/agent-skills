# agent-skills

Die Skills, mit denen Agenten freigegebene Epics aus der Forge umsetzen, und der Leitstand, der
mehrere solcher Läufe gleichzeitig führt.

## Language

### Was ein Lauf bearbeitet

**Epic**:
Das Zielissue eines Laufs — entweder ein Sammelticket mit Kindern oder eine Spec. Es trägt das
Label `epic`, sobald ein Lauf es aufnimmt.
_Avoid_: PRD, Sammel-Issue, Projekt

**Kind**:
Ein Ticket, das ein Epic blockiert und als eigenes Paket umgesetzt wird.
_Avoid_: Unterticket, Subtask, Story

**Spec**:
Ein Epic, das in sieben festen Abschnitten beschreibt, was gebaut wird. Hat es keine Kinder,
schneidet der Lauf die Pakete selbst daraus.
_Avoid_: PRD, Konzept

### Arbeitsteilung

**Paketklasse**:
Die Einstufung eines Pakets beim Schneiden — *mechanisch*, *Standard* oder *Urteil* —, nach der
sich Modell und Denkstufe von Implementer und Reviewer richten. Der Adapter darf sie nur hochstufen.
_Avoid_: Schwierigkeit, Komplexität, Tier

**Kundschafter**:
Ein Subagent, der nur liest und Fundstellen liefert; er schreibt keinen Code, nimmt nichts ab und
schreibt nicht in die Forge. Ein „nichts gefunden“ wird ungeprüft übernommen, ein Fund nur dann
nachgeprüft, wenn ein Tor-Punkt, ein Befund oder eine Löschung daraus folgt.
_Avoid_: Recherche-Agent, Scout, Helfer

**Eskalation**:
Die Wiederholung einer Implementer-Runde eine Paketklasse höher, nachdem der Reviewer einen
strukturellen Befund gemeldet hat. Sie gilt als Hinweis, dass die Klasse falsch geschätzt war.
_Avoid_: Retry, Upgrade
