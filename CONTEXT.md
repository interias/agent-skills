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

### Sprachraum (Oberfläche, Skills, Texte)

Seit agent-skills/ADR-0003 gilt dieser Wortschatz überall außer in Labels und Adapter-Schlüsseln.

| Begriff | Bedeutet | Label / Schlüssel |
|---|---|---|
| **Mission** | ein Epic | `epic` |
| **Missionsziel** | ein Kind einer Mission | – |
| **Sternzeit-Notiz** | eine Idee, noch nicht freigegeben | `needs-triage` |
| **Warp frei** | freigegeben für die Flotte | `ready-for-agent` |
| **Außeneinsatz** | ein Lauf an einer Mission | – |
| **Lagebesprechung** | das Vorab-Tor eines Außeneinsatzes | – |
| **Ingenieur** / **Erster Offizier** | Implementer / Reviewer | – |
| **Andockprüfung** / **Andocken** | Gate / Merge | `gate_command` / `merge` |
| **Schilde** | freier Kontext einer Sitzung; je voller der Kontext, desto schwächer | – |
| **Hauptenergie** / **Reserveenergie** | 5-Stunden- / Wochenlimit eines Kontos | – |
| **Bereitschaftsraum** | das Gespräch, aus dem eine Mission, ein Missionsziel oder nichts entsteht | – |
| **Werft** | `flotte werft`, zieht nach einem Merge auf `main` die betroffenen Stacks nach (agent-skills/ADR-0005) | `deploy` |
| **Auftragsschreiber** | `flotte auftrag`, das einzige Werkzeug, das Missionen anlegt | – |

_Avoid_: Epic, Gate, Merge, Implementer, Reviewer, Grilling in Oberfläche und Texten.

