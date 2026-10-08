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

