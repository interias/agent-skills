---
name: persona-review
description: Eine Funktion von 4–7 Persona-Agenten an synthetischen Fällen auf einer lokalen Instanz durchspielen lassen — Klickprotokolle, Befunde im Code nachgeprüft, Entscheidungen und Tickets daraus, danach eine neue Runde mit denselben Fällen zum Vergleich und eine Abnahme-Probe mit Gegenprobe.
disable-model-invocation: true
---

# Persona-Review

Mehrere **Personas** — Subagenten in festen Rollen — bedienen eine Funktion wie Menschen: Sie sehen
Screenshots an, zählen jeden Klick und schreiben einen Bericht in fester Form. Du bist der **Host**:
Du legst Personas und Fälle fest, startest die Runde, prüfst jeden Fehlerbefund im Code nach und
machst daraus Entscheidungen, Tickets und die nächste **Runde**. Erst der Vergleich über Runden mit
denselben Fällen zeigt, ob eine Änderung die Bedienung leichter gemacht hat.

Argument des Aufrufs ist die Funktion oder der Pull Request, um den es geht, optional `runde <N>`
für eine Folgerunde. Fehlt beides, frag danach.

**Nur lokal.** Jeder Klick geht gegen eine lokale Instanz mit Datenbankkopie, jeder Fall ist
synthetisch. Das Kit verweigert jede Basis-URL außer `localhost`, `127.0.0.1`, `[::1]`,
`*.localhost` und `*.test`.

**Zwei Halte.** Gefragt wird in Schritt 3 (Startvorlage) und in Schritt 7 (Entscheidungen), nach den
Regeln „Wie gefragt wird“ des Skills `epic` (Optionen, markierte Empfehlung, `AskUserQuestion`).
Dazwischen läuft die Runde durch.

Skripte liegen neben dieser Datei unter `scripts/`, Vorlagen unter `references/`. Python mit `-P`
aufrufen, Pfade als Argumente; gebraucht werden Playwright und ein Chromium. `scripts/selftest.py`
prüft das Kit gegen eine Testseite auf `127.0.0.1`.

**Denkstufe des Hosts:** Fable 5.2, hoch (`/model fable`, `/effort high`). Der Host hat wenige,
folgenreiche Züge — Fälle schneiden, Befunde nachprüfen, gewichten.

## 0 — Vorbereiten

- **Adapter lesen:** `.claude/persona-review.md` des Zielprojekts (Vertrag:
  `references/adapter.md`). Fehlt er, leite ab, was ableitbar ist (Startweg der Anwendung aus
  `.claude/launch.json` oder README, Login aus dem Code), und lege den Rest in Schritt 3 vor.
- **Lokal belegen:** Läuft die Anwendung unter `base_url`, und zeigt sie auf die Datenbankkopie aus
  `local_db`? Prüfe es an der Konfiguration der laufenden Instanz, nicht am Adapter allein. Ohne
  Beleg keine Runde.
- **Rundenordner** anlegen: `<scratchpad>/persona-review/runde<N>/` mit `kit/` und `berichte/`.
  Bei einer Folgerunde die `ZUSAMMENFASSUNG.md`, `personas.md` und `cases.json` der Vorrunde aus
  `archive_dir` lesen.
- **Zielbild sammeln:** was die Funktion laut Spec, Issue oder Pull Request können soll — in den
  Worten, in denen es den Anwendern angekündigt wird, nicht in Code-Begriffen.

## 1 — Perspektiven festlegen

Wähle 4–7 Personas nach `references/persona.md`. Eine Folgerunde übernimmt die Personas der Vorrunde
unverändert; eine neue Persona kommt nur für eine neue Funktion dazu und zählt nicht in den
Vergleich.

Fertig, wenn `personas.md` je Persona einen Steckbrief hat und die Besetzung die Streuung der
Vorlage abdeckt: mindestens ein Neuling, ein Erfahrener, eine Person, die fremde Arbeit prüft, und
keine zwei Personas mit derselben Eigenheit.

## 2 — Fälle anlegen

Je Persona ein **realistischer Fall** aus ihrem Alltag, optional ein **Sonderfall**, der gezielt die
neue Funktion trifft. Angelegt wird über `case_setup` des Adapters — ein Skript gegen die lokale
API oder die Oberfläche, nie von Hand in der Datenbank. Jeder Fall trägt `case_marker` im Namen.

- Inhalt plausibel und vollständig genug, dass die Persona den Prozess bis zum Ende gehen kann;
  Namen, Nummern und Werte erfunden.
- **Folgerunde:** dieselben Fälle (gleicher Umfang, gleicher Text) auf **neuen** Datensätzen, damit
  keine Persona auf dem Stand der Vorrunde weiterarbeitet.

Fertig, wenn `cases.json` je Persona Kennung, URL-Pfad und Umfang nennt und du jeden Fall einmal im
Browser geöffnet hast.

## 3 — Auftrag, Kit und Startvorlage

- **Auftrag** aus `references/auftrag.md` nach `runde<N>/AUFTRAG.md` schreiben: Zielbild, Aufgabe,
  Klickprotokoll, Grenzen, Berichtsform (`references/bericht.md`), Technik mit absoluten Pfaden.
  In einer Folgerunde ändert sich nur das Zielbild um das, was neu ist.
- **Kit:** `scripts/personakit.py` nach `runde<N>/kit/` kopieren, den Block `kit` des Adapters als
  `kit/kit.json` schreiben. Dann selbst einmal `run()` mit einem Screenshot fahren und ihn ansehen:
  angemeldet, Fall offen, keine Einblendung davor. Fertig erst mit diesem Bild.
- **Halt — Startvorlage:** Lege in einer Nachricht vor: Personas, Fälle, Zielbild, Werkzeugbudget,
  Modell der Personas (Abschnitt „Modellwahl“). Frage, was offen ist; bei „Wird angepasst“
  einarbeiten und erneut vorlegen.

## 4 — Runde starten

Alle Personas **in einer Nachricht** als Hintergrund-Subagenten starten (`general-purpose`, Modell
nach der Startvorlage), je mit der Startnachricht aus `references/auftrag.md`: Steckbrief, Fall,
absolute Pfade zu `AUFTRAG.md`, Kit und Berichtsdatei.

- **Stand melden**, solange die Runde läuft: bei jedem eingehenden Bericht eine Zeile „x von n
  fertig, offen: …“.
- Kommt ein Subagent ohne Bericht zurück, setze ihn einmal fort; bleibt er leer, starte die Persona
  neu und vermerke es.
- Greift eine Persona über ihre Grenzen (fremder Fall, Stammdaten, git), ist ihr Lauf ungültig:
  Folgen auf der lokalen Instanz zurücksetzen, die Persona mit verschärftem Auftrag neu starten.

Fertig, wenn je Persona `berichte/<persona>.md` vorliegt.

## 5 — Konsolidieren

`runde<N>/ZUSAMMENFASSUNG.md` nach `references/zusammenfassung.md`: Kopf, Vergleichstabelle,
Befunde nach Gruppen, Grenzen. Lies jeden Bericht ganz und sieh dir die Screenshots der
Stolpersteine an, die als „blockiert“ markiert sind.

**Befunde einordnen:**

| Gruppe | Was hineingehört |
|---|---|
| **A — im Code bestätigt** | Fehler mit Fundstelle `datei:zeile` und Mechanismus, der das Berichtete erklärt |
| **B — nur laut Berichten** | Fehler, die du im Code nicht belegen konntest; mit dem Grund |
| **C — Konzept, Entscheidung nötig** | Das System tut, was gebaut wurde, aber es passt nicht zur Arbeit der Personas |
| **D — Testdaten, Stammdaten** | liegt an den Daten der lokalen Instanz, kein Code |
| **E — Kleinigkeiten** | Beschriftung, Symbole, Reihenfolge |
| **nicht als Befund gewertet** | mit Grund: lokales Entwicklungs-Overlay, Glossar-Schreibweise, Wunsch außerhalb des Umfangs |

**Jeden Fehlerbefund prüfst du selbst nach, bevor er in A steht.** Den Weg zur Stelle darf ein
lesender Subagent suchen (`epic-kundschafter`); die Stelle liest du selbst. Wo der Code allein nicht
reicht, stellst du den Fall mit dem Kit nach. Zählt eine Persona etwas als Fehler, das gewollt ist,
gehört es nach C mit der Stelle, die es so festlegt (ADR, Spec, Kommentar).

**Vertrauliches prüfen:** Berichte und Zusammenfassung nach `forbidden_patterns` des Adapters und
nach Prozentangaben durchsuchen, etwa
`rg -n -e '<muster>' -e '\d+([.,]\d+)?\s?%' runde<N>/berichte runde<N>/ZUSAMMENFASSUNG.md`.
Jeden Treffer ansehen und schwärzen, was vertraulich ist. Screenshots lassen sich nicht durchsuchen:
Sie bleiben in `archive_dir` und gehen in kein Ticket.

Fertig, wenn jeder Stolperstein jeder Persona in genau einer Gruppe steht oder unter einem
gemeinsamen Befund mit Personenzahl, jeder A-Befund eine Fundstelle hat und die Suche nach
Vertraulichem ohne offenen Treffer ist.

## 6 — Ablegen

Den Rundenordner nach `archive_dir/runde<N>/` kopieren — außerhalb jedes öffentlichen Repositorys.
Berichte verweisen auf Screenshots mit Pfaden im Scratchpad; ersetze den Präfix durch den
Ablagepfad.

## 7 — Rückfluss

- **Halt — Entscheidungen:** Lege jeden C-Befund als Frage vor, mit Optionen, Folgen und
  Empfehlung; dazu, welche A- und B-Befunde vor dem Merge behoben werden sollen.
- **Tickets und Nacharbeit:** Aus den Antworten werden Tickets in der Forge des Projekts (Adapter
  `.claude/epic.md`), nur nach ausdrücklicher Entscheidung. Jedes Ticket nennt Befund, Personen,
  Fundstelle und als Verifikation den Fall der Persona. Umsetzen mit `/epic` oder
  `/epic-nacharbeit`. D-Befunde gehen an den, der die Stammdaten pflegt.
- **Nächste Runde:** nach den Fixes dieselben Personas und Fälle auf neuen Datensätzen (Schritt 2,
  Folgerunde). Die Zusammenfassung vergleicht dann je Persona mit der Vorrunde.

## 8 — Abnahme-Probe nach Fixes

Jede Probe braucht eine **Gegenprobe**, die anschlagen muss. Ein Overlay, eine Erinnerung oder ein
verspätetes Laden kann einen Klick schlucken; die Probe meldet dann „alles ruhig“, weil sie nichts
hören konnte. Ohne Gegenprobe merkt man das nicht.

Für den häufigsten Fall — eine Warnung vor ungespeicherten Änderungen, die nicht grundlos kommen
darf — gibt es `scripts/probe.py`:

```bash
python -P <runde>/kit/probe.py <runde>/kit <id>,<id> <runde>/probe.json
```

Vorher `scripts/probe.py` neben `personakit.py` kopieren. Je Fall: öffnen, warten, ohne Änderung
verlassen (keine Warnung, Seite wirklich verlassen); Tab schließen (kein nativer Dialog); echte
Änderung, dann verlassen (Warnung muss kommen). Urteile und Exit-Codes stehen im Kopf des Skripts.
Eine Probe mit Urteil `deaf` oder `not_left` belegt nichts; erst Ursache beheben (meist
`overlay_buttons` oder `wait_ms`), dann neu.

Für andere Abnahmen baue die Probe nach demselben Muster: Ruhefall, Gegenprobe mit echter Wirkung,
Nachweis, dass die Aktion wirklich stattfand.

Fertig, wenn jeder geprüfte Fall `ok` ist oder ein Befund daraus als Ticket steht.

## Modellwahl

Das Modell der Personas ist eine **Kostenfrage**, die der Mensch in der Startvorlage entscheidet.
Eine Runde kostet etwa Personas × Werkzeugbudget Aufrufe, die meisten mit Screenshot.

- Ein stärkeres Modell erkennt Symbole und Begriffe genauer und urteilt sicherer über Vertrauen;
  ein günstigeres bedient den Browser ebenso, verfehlt aber eher, was ein Mensch übersieht oder
  missversteht.
- **Innerhalb einer Vergleichsreihe bleibt das Modell gleich**, sonst misst der Rundenvergleich
  den Modellwechsel mit.
- Unsicher? Eine Persona in Runde 1 auf zwei Modellen fahren und die Berichte vergleichen, bevor
  die Reihe festgelegt wird.

## Abschluss

Berichte in dieser Reihenfolge: Vergleichszeile der Runde (Summe Klicks, Suche, mittleres
Vertrauen, bei Folgerunden mit Vorrunde), die drei schwersten A-Befunde, offene Entscheidungen,
angelegte Tickets als Links, Pfad der Zusammenfassung.
