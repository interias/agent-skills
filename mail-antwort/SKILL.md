---
name: mail-antwort
description: Eine Anwender-E-Mail (.eml) zum aktiven Repository beantworten — zerlegen, recherchieren, nach einem Halt bei Bedarf Spec-Issue anlegen und mit /epic bis zum Pull Request umsetzen, am Ende ein Antwortentwurf mit markierten Ist- und Soll-Bildern.
disable-model-invocation: true
---

# Mail beantworten

Ein Anwender meldet per Mail einen Fehler, einen Wunsch oder eine Frage zu der Anwendung, deren
Repository diese Sitzung geöffnet hat. Du machst daraus **einen Befund**, bei Bedarf **einen Pull
Request** über `/epic`, und immer **einen Antwortentwurf**, den der Mensch prüft und selbst
abschickt. Du verschickst nie etwas.

Argument des Aufrufs ist der Pfad der `.eml`. Fehlt er, frag danach.

**Ein Halt.** Gefragt wird einmal, in Schritt 4, nach den Regeln „Wie gefragt wird“ des Skills
`epic` (Optionen, markierte Empfehlung, `AskUserQuestion`). Danach läuft alles bis zum Entwurf
durch. Das Vorab-Tor von `/epic` bleibt bestehen; es fragt nur, wenn das Issue Lücken hat — darum
schreibst du es in Schritt 5 so vollständig, dass das Tor leer bleibt.

Skripte liegen neben dieser Datei unter `scripts/`. Python mit `-P` aufrufen (hält das aktuelle Verzeichnis aus dem Importpfad; `-I` würde auch Pillow aus den Benutzerpaketen ausblenden), Pfade als Argumente;
Pillow wird gebraucht.

## 0 — Vorbereiten

- **Adapter lesen:** `.claude/epic.md` des Repositorys (Vertrag: `references/adapter.md` des Skills
  `epic`). Er liefert Forge, API, Token, `issue_form`, `ready_label`, Vokabulardatei, ADR-Pfad und
  `must_read`. Fehlt er, leite Forge und API aus `git remote -v` ab; das Token steht dann als
  `GITEA_TOKEN` in `~/.env`.
- `must_read` und die Vokabulardatei lesen. In Befund, Issue und Mail gelten deren Begriffe.
- **Arbeitsordner** im Scratchpad anlegen: `<scratchpad>/mail-<Betreff-kurz>/`. Alle Zwischenstände
  liegen dort.

## 1 — Mail zerlegen

```bash
python -P scripts/eml_zerlegen.py <mail.eml> <arbeitsordner>/mail
```

Lies `mail.txt` und sieh dir **jedes Bild mit `likely_signature: false`** an, mit dem Read-Werkzeug.
Bei großen Screenshots lies Kopfzeilen, Kennungen und markierte Zeilen genau ab.

Fertig, wenn du in drei Zeilen festhalten kannst:
- **Anliegen** in eigenen Worten, ein Satz.
- **Fundort:** Seite, Datensatz (Kennung aus dem Bild ablesen, etwa eine Anfragenummer), Zeile,
  Feld oder Spalte. Wo das Bild es zeigt, auch die Werte daneben.
- **Absender:** Name, Rolle aus der Signatur, Anrede (Du/Sie), Sprache.

## 2 — Einordnen

| Art | Erkennbar an | Weg |
|---|---|---|
| **Fehler** | Die Anwendung tut nicht, was Code oder Doku zusagen | Issue + `/epic` |
| **Wunsch** | Tut, was sie soll, der Anwender will mehr oder anders | Issue + `/epic`, wenn klein und eindeutig; sonst Issue mit `needs-triage`, kein Lauf |
| **Bedienung** | Funktion existiert, wurde anders benutzt | nur Antwort |
| **Daten** | Code richtig, der Datensatz oder die Stammdaten sind es nicht | Antwort; Stammdaten ändert nur ein Mensch |
| **Schon erledigt** | Behoben in neuerer Version oder offenes Issue/PR vorhanden | Antwort + Kommentar am vorhandenen Issue |

Die Einordnung ist eine Hypothese; Schritt 3 bestätigt oder kippt sie.

**Zuerst prüfen, ob die Mail schon bearbeitet wird:** Issues (offen und geschlossen) nach der
Kennung des Datensatzes und dem Namen des Absenders durchsuchen. Nennt ein Issue diese Mail, ist es
der Fall „Schon erledigt“: Recherche, Issue und Lauf gibt es dann schon. Weiter mit Schritt 4,
ohne eigene Recherche über das Gegenprüfen der Fundstellen des Issues hinaus.

## 3 — Recherche

Vier Spuren, unabhängig voneinander — bei größerem Umfang als `epic-kundschafter` parallel, mit
absoluten Pfaden im Auftrag:

1. **Code:** vom angezeigten Element (Spaltenkopf, Feldname, Übersetzungsschlüssel) zur Stelle, die
   den Wert berechnet oder lädt. Bedingungen suchen, unter denen der Wert leer bleibt, und gegen
   die Werte im Bild prüfen.
2. **Forge:** offene **und** geschlossene Issues und PRs zu den Begriffen der Mail (Listen blättern,
   siehe `references/forge.md` des Skills `epic`). Dubletten und frühere Entscheidungen.
3. **Version:** die Änderungshistorie des Projekts (bei BRIQNET `client/content/patch-notes.json`)
   seit dem Stand des Anwenders. Ein Hinweis „neue Version verfügbar“ im Bild heißt: der Anwender
   lief auf einem alten Stand.
4. **Daten:** Den Fall nachstellen — derselbe Datensatz in der lokalen Datenbank, sonst ein
   gleichartiger. Nur lesend. Ein Diagnosezugang zur Produktion gilt nur, wenn das Projekt ihn
   dokumentiert.

Fertig, wenn **die Ursache mit Fundstelle (`datei:zeile`) belegt und am Fall nachvollzogen** ist,
oder wenn du festhältst, was davon unbelegt bleibt und welche Information fehlt. „Vermutlich“ ohne
Fundstelle ist kein Befund.

## 4 — Halt

Lege in einer Nachricht vor:

- **Befund:** Ursache, Fundstellen, nachgestellter Fall, Einordnung.
- **Weg:** A nur Antwort · B Spec-Issue + `/epic` · C Kommentar an vorhandenem Issue + Antwort ·
  D Wunsch als `needs-triage`-Issue + Antwort ohne Termin.
- **Issue-Entwurf** (bei B/D) vollständig, wie er angelegt würde.
- **Kern der Antwort** in zwei, drei Sätzen.

Dann die Frage nach dem Weg, Empfehlung zuerst. Bei „Wird angepasst“ einarbeiten und erneut
vorlegen; sonst weiter mit dem gewählten Weg.

## 5 — Issue und Lauf (Weg B, D)

- **Issue anlegen** in der Form `issue_form` des Adapters. Für `spec` die sieben Abschnitte, die
  der Skill `epic` in Phase 1 beschreibt; als Vorlage den Body eines jüngeren Spec-Issues des
  Repositorys lesen. Pflichtinhalte:
  - **Herkunft** unter Further Notes: Absender, Datum, Betreff, Kennung des Datensatzes.
  - **Bild** des Anwenders als Anhang am Issue (Gitea: `POST /issues/<n>/assets`, Feld
    `attachment`) und im Body verlinkt.
  - **Fundstellen** aus Schritt 3 unter Implementation Decisions, mit der Begründung des Wegs.
  - **Testing Decisions** mit dem nachgestellten Fall als Prüfung und dem Bildschirmfoto als
    Verifikation, damit `/epic` den Soll-Zustand belegt.
  - Labels: Kategorie (`bug`/`enhancement`) und bei B das `ready_label`; bei D `needs-triage`.
- **Weg B:** den Skill `epic` mit `#<n>` aufrufen und ihm folgen. Die Patch-Note-Pflicht des
  Projekts deckt der Lauf ab. Fertig, wenn der Pull Request offen ist; notiere PR-Nummer, Branch,
  Worktree und die Version aus der Patch-Note.
- **Weg C:** am vorhandenen Issue kommentieren — Herkunft, Bild, was die Mail Neues beiträgt.
  Nennt das Issue die Mail schon, entfällt der Kommentar. **Läuft dazu schon ein `/epic`** (Label
  `status/in-arbeit`, Epic-Branch oder -Worktree vorhanden), startest du keinen zweiten: Die Antwort
  wartet auf dessen Pull Request, das Soll-Bild entsteht in dessen Worktree. Ist der Pull Request
  noch nicht offen, endest du mit Ist-Bild und Textentwurf und sagst, worauf das Soll-Bild wartet.

## 6 — Bilder

Für die Antwort entstehen **Ist** und, wenn Code geändert wurde, **Soll**:

- **Ist:** das Bild des Anwenders, auf den Ausschnitt um den Fundort zugeschnitten, das gemeldete
  Element markiert.
- **Soll:** die Anwendung aus dem Epic-Worktree lokal starten (nach dem Weg des Projekts:
  `run`-Skill, `.claude/launch.json`, README), dieselbe Ansicht mit demselben oder einem
  gleichartigen Datensatz öffnen, Bildschirmfoto im Browser-Pane, dasselbe Element markiert.
  Gelingt das nicht, bleibt es beim Ist-Bild; der Grund kommt in den Abschlussbericht.

```bash
python -P scripts/markieren.py <ein.png> <aus.png> <marken.json>
```

Format der Marken steht im Kopf des Skripts. Koordinaten in Pixeln des Eingabebilds; zum Ablesen
das Bild ansehen, nach dem Markieren das Ergebnis ansehen und nachjustieren, bis die Markierung
das Element trifft.

Fertig, wenn jedes Bild genau das Element markiert, um das es in der Mail geht, und auf
Mailbreite (~800 px) lesbar ist.

## 7 — Antwortentwurf

Schreibe den Text als HTML-Fragment `<arbeitsordner>/antwort.html`, Bilder als
`<img src="<dateiname>" style="max-width:800px">`. Dann:

```bash
python -P scripts/antwort_entwurf.py <mail.eml> <arbeitsordner>/antwort.html <neben-der-mail>/<name>-Antwort.eml <bild> ...
```

Der Entwurf liegt **neben der Original-Mail** und öffnet sich in Outlook als ungesendete Antwort
(gleicher Thread, Original zitiert, Bilder eingebettet).

Der Text:
- **Anrede wie der Absender** (Du/Sie, Vorname), Sprache der Mail.
- **Erster Satz ist das Ergebnis:** Fehler gefunden und behoben / so geht es / liegt an den Daten.
- **Ursache in der Sprache des Anwenders:** Begriffe der Oberfläche und der Vokabulardatei; Datei-,
  Funktions- und Branchnamen bleiben im Issue.
- **Was sich ändert und wann:** „kommt mit Version x.y.z, sobald sie freigegeben ist“ — kein Datum,
  denn Merge und Deploy entscheidet der Mensch. Bis dahin ein Behelf, falls es einen gibt.
- **Bilder** mit je einer Zeile Unterschrift: „Bisher:“ / „Nach der Korrektur:“.
- **Kurz:** höchstens acht Sätze ohne Bildunterschriften. Gruß mit dem Vornamen des Menschen aus
  dem `To` der Original-Mail.

## Abschluss

Berichte in dieser Reihenfolge: Weg und Befund in einem Satz, Pfad des Entwurfs als Link, Issue
und Pull Request als Links, was offen ist (Verifikation, die nicht lief; Soll-Bild fehlt). Biete an,
den Entwurf mit `Invoke-Item` in Outlook zu öffnen.
