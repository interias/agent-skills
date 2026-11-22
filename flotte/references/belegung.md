# Belegung — wer gleichzeitig laufen darf

Was der Treiber daraus macht: `flotte/SKILL.md`, „Was der Treiber tut", Punkt 2; im Programm
`src/werkzeuge/belegung.ts` (`flotte belegung`).

**Kandidaten:** ohne `--epics` alle offenen Epics, an denen oder an deren Kindern `ready_label`
steht. Je Epic: Kinder, berührte Module (`modules_section`), Reihenfolge-Kanten zu anderen Epics,
`exclusive_paths` und `always_collide`, die es berührt, geplante Migrationen.

Zwischen zwei Epics gilt eine **Reihenfolge-Kante** (`epic/SKILL.md`, Phase 1) hart: das spätere
startet erst, wenn der Pull Request des früheren **gemergt** ist. Für alle übrigen Paare bestimmt
der Treiber die **Kollisionsstufe** aus den berührten Modulen und Dateien:

| Stufe | Merkmal des Paares | gleichzeitig höchstens |
|---|---|---|
| **keine** | keine gemeinsamen Module, keine gemeinsame Datei aus `exclusive_paths` | 4 |
| **klein** | gemeinsam nur mechanische Dateien: `always_collide`, Registrierungs- oder Importlisten, Doku | 3–4 |
| **mittel** | dasselbe Modul, aber andere Dateien; oder eines der beiden ändert einen Pfad aus `exclusive_paths` | 2 |
| **groß** | dieselben Dateien, Schema-Migration in beiden, querschnittlicher Umbau, oder ein Exklusivknoten in einem der beiden | 1 — nacheinander |

Die Belegung ist die größte Menge von Epics, in der **jedes Paar** die Grenze seiner Stufe
einhält; maßgeblich ist das schlechteste Paar. Bei Wahl gewinnt, wer die meisten anderen Epics
entsperrt, bei Gleichstand die kleinere Nummer. **Nie mehr als vier.**

> **Entwurf.** Die Grenzen zwischen klein, mittel und groß sind noch zu schärfen. Bis dahin
> nennt die Belegung je Paar die Stufe **mit Beleg** (welche Module, welche Dateien), und
> im Zweifel gilt die höhere Stufe.

Gemeinsame Laufzeit-Ressourcen zählen mit: Teilen sich Läufe einen Compose-Stack, eine
Testdatenbank oder feste Ports, und isoliert der Adapter das nicht über Läufe hinweg, ist das
mindestens Stufe mittel.
