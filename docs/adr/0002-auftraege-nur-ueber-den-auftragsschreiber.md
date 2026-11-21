# ADR-0002 — Aufträge entstehen nur über den Auftragsschreiber

**Status:** Entschieden
**Datum:** 2026-11-21

## Kontext
Tickets wurden von Hand oder von Skills mit `gh` geschrieben. Dabei fehlten Pflichtabschnitte
des Adapters (`## Abnahmekriterien`, `## Verifikationsweg`); ein Lauf hätte die Kinder
überspringen müssen. Neben GitHub soll dieselbe Arbeit auf einer Gitea-Instanz laufen.

## Entscheidung
Missionen und Missionsziele legt ausschließlich das Skript `flotte auftrag` an; es prüft den
Entwurf gegen den Adapter des Ziel-Repositorys und spricht GitHub und Gitea über eine Forge-Schicht.

## Begründung
Eine Anweisung im Skill hält das Format nicht verlässlich; ein Programm prüft es jedes Mal gleich,
auch für den Brücken-Chat. Eine gemeinsame Forge-Schicht statt eines Skripts je Forge hält die
Regeln an einer Stelle.

## Konsequenzen
Skills und Chat rufen nie `gh issue create` direkt auf. Der Gitea-Weg wird gegen eine
Wegwerf-Instanz im Docker getestet. Labels bleiben technisch (`epic`, `ready-for-agent`,
`needs-triage`); „Sternzeit-Notiz“ und „Warp frei“ sind nur ihre Namen in der Oberfläche.
