# Arbeitspferd

Das zweite Claude-Konto im eigenen Terminalfenster, das der Skill [`leitstand`](leitstand/SKILL.md)
steuert. Dieser Ordner enthält alles, was es auf einem neuen Rechner braucht. `install.ps1` lässt ihn
aus; eingerichtet wird er mit

```powershell
pwsh -File arbeitspferd\einrichten.ps1 -DryRun
pwsh -File arbeitspferd\einrichten.ps1
```

Danach einmal das Profil „Claude Arbeitspferd“ in Windows Terminal öffnen, `claude` starten und
`/login` mit dem zweiten Konto. Was das Skript im Einzelnen tut, steht in seinem Kopfkommentar.

| Datei | Wohin | Zweck |
|---|---|---|
| `dateien/start-arbeitspferd.ps1` | `~/.claude-arbeitspferd` | Startet `claude` mit dem zweiten Konto, ohne geerbte Variablen der Hauptsitzung |
| `dateien/auftrag.ps1`, `fortsetzen.ps1` | `~/.claude-arbeitspferd` | Neues Fenster mit Auftrag, Tabfarbe je Repository; Sitzung in neuem Fenster fortsetzen |
| `dateien/arbeitspferd.ico`, `icon-bauen.ps1` | `~/.claude-arbeitspferd` | Icon des Profils und das Skript, das es baut |
| `dateien/CLAUDE.md` | `~/.claude-arbeitspferd` | Importiert die globale `CLAUDE.md` und ergänzt Regeln fürs unbeaufsichtigte Fenster |
| `dateien/settings.json` | `~/.claude-arbeitspferd` | Vorlage, nur geschrieben, wenn noch keine existiert |
| `themes/claude-farbe.json` | `~/.claude/themes` | Claude-Theme `custom:claude-farbe` |
| `windows-terminal.json` | Windows-Terminal-`settings.json` | Profil „Claude Arbeitspferd“ und Farbschema „Claude Code“ |
| `leitstand/` | `~/.claude/skills/leitstand` | Skill der Hauptsitzung, der das Arbeitspferd steuert |

Was nur für deinen Rechner gilt — Dienste, die keine Sitzung anfassen darf, Programme, die offen
bleiben —, schreibst du nach `~/.claude-arbeitspferd/leitstand/lokal.md`. Die Datei gehört nicht ins
Repository; `start.ps1` hängt sie jedem Auftrag an, und der Leitstand liest sie zu Beginn.

Im Konfigordner liegen `skills`, `agents`, `output-styles`, `plugins` und `themes` als Junctions
auf `~/.claude`, damit beide Konten dieselben Skills sehen. Ein rekursives Löschen von
`~/.claude-arbeitspferd` folgt diesen Junctions — den Ordner deshalb nie mit `Remove-Item -Recurse`
oder `rm -rf` entfernen.
