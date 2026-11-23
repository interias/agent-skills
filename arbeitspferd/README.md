# Arbeitspferd

Das zweite Claude-Konto im eigenen Terminalfenster. Dieser Ordner enthält alles, was es auf einem
neuen Rechner braucht. `install.ps1` lässt ihn aus; eingerichtet wird er mit

```powershell
pwsh -File arbeitspferd\einrichten.ps1 -DryRun
pwsh -File arbeitspferd\einrichten.ps1
```

Danach einmal das Profil „Claude Arbeitspferd“ in Windows Terminal öffnen, `claude` starten und
`/login` mit dem zweiten Konto. Was das Skript im Einzelnen tut, steht in seinem Kopfkommentar.
Prüfe danach, dass `skills` und `agents` im Konfigordner Verknüpfungen auf `~/.claude` sind: Das
Skript lässt vorhandene Ordner stehen, und ein eigener Ordner dort veraltet unbemerkt.

## Konten

Jedes Konto hat ein eigenes Windows-Terminal-Profil und eine Desktop-Verknüpfung gleichen Namens
(`wt.exe -w new -p "<Profil>"`). Icon und Tabfarbe unterscheiden die Konten; das Farbschema
„Claude Code“ teilen sie.

| Konto | Ordner | Profil | Farbe | Icon |
|---|---|---|---|---|
| 1 (Hauptkonto) | `~/.claude` | Claude Hauptkonto | grün `#8FB573` | `hauptkonto.ico` |
| 2 | `~/.claude-arbeitspferd` | Claude Arbeitspferd | orange `#D97757` | `arbeitspferd.ico` |
| 3 | `~/.claude-arbeitspferd-3` | Claude Arbeitspferd 3 | blau `#7AA2C8` | `arbeitspferd-3.ico` |

Konto 3 arbeitet nur unter dem Flotten-Treiber
(`flotte/SKILL.md`, „Weiteres Konto zuschalten“).

## Weiteres Konto einrichten

```powershell
pwsh -File arbeitspferd\einrichten.ps1 -Konfig ~\.claude-arbeitspferd-3 -DryRun
pwsh -File arbeitspferd\einrichten.ps1 -Konfig ~\.claude-arbeitspferd-3
pwsh -File arbeitspferd\einrichten.ps1 -Konfig ~\.claude -DryRun     # Profil fürs Hauptkonto
```

- Ein Konto 3 bekommt denselben Aufbau wie Konto 2: Dateien, Junctions, `settings.json`-Vorlage,
  Icon, Profil und Verknüpfung. `additionalDirectories` jedes `~/.claude-arbeitspferd*`-Ordners
  listet danach alle Konfigordner, auch den neuen.
- Für das Hauptkonto legt das Skript nur `start-claude.ps1` und das Icon nach `~/.claude`, dazu
  Profil und Verknüpfung. Seine `CLAUDE.md` und `settings.json` bleiben, wie sie sind. Gestartet
  wird es ohne `CLAUDE_CONFIG_DIR`, wie ein einfaches `claude`.
- Ein zweiter Aufruf ersetzt nur das eigene Profil. Theme und Dateien bleiben, wenn
  sie unverändert sind. Eine vorhandene Verknüpfung wird nicht überschrieben.
- Weitere Ordner `~/.claude-arbeitspferd-<n>` gehen auch, mit `-Profil` und `-Farbe`. Ohne eigenes
  `dateien/arbeitspferd-<n>.ico` nehmen sie das Icon von Konto 2. Ein neues Icon baut
  `dateien/icon-bauen.ps1 -Name arbeitspferd-<n> -Zahl <n> -Farbe '#rrggbb'` unter Windows PowerShell.
- Danach das Profil öffnen, `claude` starten und `/login` mit dem Konto.

`/mission` und `flotte` laufen aus jedem Profil. Die Skills kommen über die Junctions
aus `~/.claude/skills` (beim Hauptkonto direkt). `bun` muss im Benutzer-`PATH` liegen, nicht nur in
einer Sitzung. Der Treiber liegt nach `install.ps1 -Skill flotte` unter `~/.claude/skills/flotte`.

## Dateien

| Datei | Wohin | Zweck |
|---|---|---|
| `dateien/start-arbeitspferd.ps1` | Konfigordner, beim Hauptkonto als `start-claude.ps1` | Startet `claude` mit dem Konto seines Ordners, ohne geerbte Variablen der Hauptsitzung |
| `dateien/auftrag.ps1`, `fortsetzen.ps1` | `~/.claude-arbeitspferd*` | Neues Fenster mit Auftrag, Tabfarbe je Repository; Sitzung in neuem Fenster fortsetzen (nur Konto 2) |
| `dateien/*.ico`, `icon-bauen.ps1` | Konfigordner | Icons der Profile und das Skript, das sie baut |
| `dateien/CLAUDE.md` | `~/.claude-arbeitspferd*` | Importiert die globale `CLAUDE.md` und ergänzt Regeln fürs unbeaufsichtigte Fenster |
| `dateien/settings.json` | `~/.claude-arbeitspferd*` | Vorlage, nur geschrieben, wenn noch keine existiert. `einrichten.ps1` trägt darin alle Konfigordner als `additionalDirectories` ein, damit kein Start an der Vertrauensfrage hängt |
| `themes/claude-farbe.json` | `~/.claude/themes` | Claude-Theme `custom:claude-farbe` |
| `windows-terminal.json` | Windows-Terminal-`settings.json` | Vorlage der Profile und Farbschema „Claude Code“ |

Im Konfigordner liegen `skills`, `agents`, `output-styles`, `plugins` und `themes` als Junctions
auf `~/.claude`, damit alle Konten dieselben Skills sehen. Ein rekursives Löschen eines
`~/.claude-arbeitspferd*`-Ordners folgt diesen Junctions — den Ordner deshalb nie mit `Remove-Item -Recurse`
oder `rm -rf` entfernen.
