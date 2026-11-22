# Flottenlogbuch

Die Tafel des Treibers liegt auf dem Rechner und ist für KIBO und das Team unsichtbar. Den Stand
der Flotte schreibt der Treiber deshalb auch in die Forge, in **ein dauerhaft offenes Issue je
Repository** mit dem Label `flotte` (Titel `Flottenlogbuch`). KIBO liest es und zeigt daraus
Flottenabzeichen, Flottenband und Erfolge (KIBO ADR-0017); es zählt dort nirgends als Ticket. Im
Programm: `src/treiber/forge.ts`.

- **Finden oder anlegen:** offenes Issue mit Label `flotte`. Fehlt das Label, wird es angelegt
  (Farbe `#00f0ff`, Beschreibung „Flottenlogbuch, kein Ticket"). Es gibt höchstens eines.
- **Nie schließen**, auch nach dem Einsatz nicht: Ein geschlossenes zählte in KIBO als erledigt. Am Ende
  steht `active: false`.
- **Seine Kommentare sind das Entscheidungsprotokoll** (`entscheidungsrecht.md`, „Was
  aufgeschrieben wird"): je einflussreicher Entscheidung einer, nie bearbeitet oder gelöscht; ein
  Widerruf kommt als Zeile darunter. Den Body mit dem Block berührt das nicht.
- **Body:** oben ein Satz für Menschen, dann die Marke und der Block. Der Treiber ersetzt den
  ganzen Body bei jedem Ereignis, in dem er die Tafel fortschreibt.

````
Stand der Flotte vom Treiber `flotte`. Wird automatisch fortgeschrieben; KIBO liest den Block.

<!-- kibo:flotte -->
```json
{
  "version": 1,
  "active": true,
  "admiral": "Pike",
  "brake": "gelb",
  "ram": [
    { "at": "2026-10-23T14:05", "epic": 21, "level": "ok", "percent_used": 62.4, "free_gb": 11.9 }
  ],
  "epics": [
    { "number": 21, "stage": "packages", "carrier": "agent", "paused": false, "note": "" }
  ],
  "questions": [ { "number": 15, "text": "Frage, die nur der Mensch entscheidet" } ],
  "history": { "deployments": 0, "max_runs": 4, "all_green": 0 }
}
```
````

| Feld | Inhalt |
|---|---|
| `brake` | Stufe der Verbrauchsbremse: `gruen`, `gelb`, `rot`. **Nur die Stufe, nie Prozente** — das Planlimit sind Kontodaten einer Person, Gitea liest das Team |
| `ram` | **Jeder Messwert der RAM-Bremse** beim Epic-Start dieses Einsatzes (#37), älteste zuerst, je `at` (Ortszeit aus der Systemuhr), `epic` (das Epic, dessen Start gemessen wurde, sonst `0`), `level` (`ok`, `warn`, `hold`), `percent_used`, `free_gb`. RAM-Werte sind Maschinendaten, keine Kontodaten, deshalb dürfen Zahlen hinein. Mit `epics` wird die Liste beim Start des nächsten Einsatzes geleert |
| `epics[].stage` | Etappe: `waiting`, `gate`, `packages`, `pr`, `followup` (Nacharbeit), `merge` (wartet auf den Merge), `cleanup`, `done` |
| `epics[].carrier` | `agent` (ein Lauf des Treibers); `chat` stammt aus Einsätzen des früheren Admiral-Chats |
| `epics[].paused` | `true` während einer Pause |
| `epics[].note` | ein kurzer Satz, etwa worauf ein wartendes Epic wartet |
| `questions` | was nach dem Entscheidungsrecht beim Menschen liegt und offen ist; erledigt → raus |
| `history` | über alle Einsätze: `deployments` +1 beim Abschluss, `max_runs` die höchste Zahl gleichzeitiger Läufe, `all_green` +1, wenn ein Einsatz die Bremse nie verlassen hat. Der Treiber schreibt `deployments` und `all_green` bisher als `0` (`logbuchText` in `src/treiber/treiber.ts`) |

Ein Epic, das fertig ist (`done`), bleibt bis zum Ende des Einsatzes im Block; danach wird `epics`
geleert.
