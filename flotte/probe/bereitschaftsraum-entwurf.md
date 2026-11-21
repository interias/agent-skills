# Mission: Notizen der Probe ordnen

Die Textdateien in `probe/` sollen ein gemeinsames Inhaltsverzeichnis und einheitliche Kopfzeilen
bekommen, damit man sie findet. Entstanden in einer Trockenprobe des Bereitschaftsraums
(erfundenes Anliegen, kein Transkriptinhalt).

# Missionsziel: Inhaltsverzeichnis `probe/INDEX.md` anlegen

## Was
Eine Datei `probe/INDEX.md`, die jede Textdatei in `probe/` mit einem Satz auflistet.

## Abnahmekriterien
- `probe/INDEX.md` existiert.
- Jede Datei `probe/*.md` außer `INDEX.md` steht darin als Link mit einem Satz.

## Verifikationsweg
Datei im Pull Request ansehen und die Links gegen `ls probe/` abgleichen.

## Betroffene Module
- `probe/`

# Missionsziel: Kopfzeile in jeder Probe-Datei vereinheitlichen

## Was
Jede Datei in `probe/` beginnt mit einer Überschrift `# <Titel>` und einer Zeile `Stand: <Datum>`.

## Abnahmekriterien
- Jede Datei `probe/*.md` beginnt mit einer Überschrift und der Zeile `Stand:`.
- `probe/INDEX.md` nennt dieselben Titel wie die Überschriften.

## Verifikationsweg
`head -n 3 probe/*.md` ansehen.

## Betroffene Module
- `probe/`

# Missionsziel: Alte Notizdatei `probe/alt.md` entfernen

## Was
Die Datei `probe/alt.md` wird gelöscht, nachdem ihr Inhalt im Inhaltsverzeichnis aufgegangen ist.
Löschungen stehen zuletzt.

## Abnahmekriterien
- `probe/alt.md` existiert nicht mehr.
- Kein Link in `probe/` verweist auf `probe/alt.md`.

## Verifikationsweg
`grep -r "alt.md" probe/` liefert nichts; Datei fehlt im Pull Request als gelöscht.

## Betroffene Module
- `probe/`
